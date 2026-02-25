import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RETRIES = 5;
const MAX_WAIT_TIME = 45000;
const TOKEN_BUFFER_MS = 120000;
const LOCK_STALE_MS = 90000;
const LOCK_POLL_INTERVAL_MS = 1000;
const LOCK_MAX_POLLS = 6;

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
const RECORDS_PER_INVOCATION = 500;
const FUNCTION_TIMEOUT_BUFFER = 40000;

function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = new Date(header).getTime();
  if (!isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 0;
  }
  return 0;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGuestyAccessTokenCached(
  supabaseAdmin: any,
  accountId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const { data: tokenRow } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .select('*')
    .eq('guesty_account_id', accountId)
    .maybeSingle();

  if (tokenRow) {
    if (tokenRow.oauth_cooldown_until) {
      const cooldownUntil = new Date(tokenRow.oauth_cooldown_until).getTime();
      if (cooldownUntil > Date.now()) {
        const waitMinutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
        throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${waitMinutes} minutes before trying again.`);
      }
    }
    const expiresAt = new Date(tokenRow.expires_at).getTime();
    if (expiresAt > Date.now() + TOKEN_BUFFER_MS) {
      return tokenRow.access_token;
    }
  }

  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS).toISOString();

  const { data: lockResult, error: lockError } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .update({ refresh_in_progress: true, refresh_started_at: now, updated_at: now })
    .eq('guesty_account_id', accountId)
    .or(`refresh_in_progress.eq.false,refresh_started_at.lt.${staleThreshold}`)
    .select();

  const lockAcquired = !lockError && lockResult && lockResult.length > 0;

  if (!lockAcquired && tokenRow) {
    for (let poll = 0; poll < LOCK_MAX_POLLS; poll++) {
      await sleep(LOCK_POLL_INTERVAL_MS);
      const { data: polledToken } = await supabaseAdmin.from('guesty_oauth_tokens').select('*').eq('guesty_account_id', accountId).maybeSingle();
      if (polledToken && !polledToken.refresh_in_progress) {
        const expiresAt = new Date(polledToken.expires_at).getTime();
        if (expiresAt > Date.now() + TOKEN_BUFFER_MS) return polledToken.access_token;
      }
    }
  }

  try {
    const token = await fetchGuestyOAuthToken(clientId, clientSecret);
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    await supabaseAdmin.from('guesty_oauth_tokens').upsert({
      guesty_account_id: accountId, access_token: token, expires_at: expiresAt,
      oauth_cooldown_until: null, refresh_in_progress: false, refresh_started_at: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'guesty_account_id' });
    return token;
  } catch (error: any) {
    if (error.message?.includes('OAUTH_RATE_LIMIT')) {
      const cooldownUntil = new Date(Date.now() + 3 * 60 * 1000).toISOString();
      await supabaseAdmin.from('guesty_oauth_tokens').upsert({
        guesty_account_id: accountId, access_token: tokenRow?.access_token || '', expires_at: tokenRow?.expires_at || new Date().toISOString(),
        oauth_cooldown_until: cooldownUntil, refresh_in_progress: false, refresh_started_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'guesty_account_id' });
    } else {
      await supabaseAdmin.from('guesty_oauth_tokens').update({ refresh_in_progress: false, refresh_started_at: null }).eq('guesty_account_id', accountId);
    }
    throw error;
  }
}

async function fetchGuestyOAuthToken(clientId: string, clientSecret: string): Promise<string> {
  const start = Date.now();
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const tokenResponse = await fetch('https://open-api.guesty.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'open-api' }),
    });
    if (tokenResponse.status === 429) {
      const retryAfterMs = parseRetryAfter(tokenResponse.headers.get('retry-after'));
      const waitTime = Math.max(Math.min(2000 * Math.pow(2, attempt - 1), 30000), retryAfterMs || 0);
      if (Date.now() - start + waitTime > MAX_WAIT_TIME) {
        throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${Math.max(3, Math.ceil(retryAfterMs / 60000))} minutes.`);
      }
      await sleep(waitTime);
      continue;
    }
    if (!tokenResponse.ok) throw new Error(`Failed to get access token: ${tokenResponse.status}`);
    const { access_token } = await tokenResponse.json();
    return access_token;
  }
  throw new Error('OAUTH_RATE_LIMIT:Unable to authenticate after multiple attempts. Please wait 3 minutes.');
}

async function fetchReservationSubTotal(apiToken: string, reservationId: string): Promise<number | null> {
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 10000));
    }

    const response = await fetch(
      `https://open-api.guesty.com/v1/reservations/${reservationId}?fields=money.subTotal`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const rateLimitSecond = response.headers.get('X-ratelimit-remaining-second');
    const rateLimitMinute = response.headers.get('X-ratelimit-remaining-minute');
    if (rateLimitSecond || rateLimitMinute) {
      console.log(`Rate limits - Second: ${rateLimitSecond}, Minute: ${rateLimitMinute}`);
    }

    if (response.status === 429) {
      if (attempt < 3) {
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : 0;
        const backoffMs = Math.min(2000 * Math.pow(2, attempt), 30000);
        const waitTime = Math.max(backoffMs, retryAfterMs);
        if (waitTime > MAX_WAIT_TIME) {
          console.log(`Rate limit wait ${waitTime}ms exceeds max, skipping reservation`);
          return null;
        }
        console.log(`Rate limited, waiting ${waitTime}ms (attempt ${attempt + 1}/4)...`);
        await sleep(waitTime);
        continue;
      }
      console.log('Rate limit exceeded after retries, skipping reservation');
      return null;
    }

    if (response.status === 404 || response.status === 410) {
      await response.text();
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Guesty API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data?.money?.subTotal ?? null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Auth check: allow service-role self-invocations or authenticated users
  const serviceRoleHeader = req.headers.get('x-service-role');
  if (!serviceRoleHeader) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const body = await req.json();
    const { guestyAccountId, jobId: existingJobId } = body;
    const checkOutMonths = body.checkOutMonths || body.checkInMonths;

    if (!guestyAccountId) {
      return new Response(JSON.stringify({ error: 'guestyAccountId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!checkOutMonths || !Array.isArray(checkOutMonths) || checkOutMonths.length === 0) {
      return new Response(JSON.stringify({ error: 'checkOutMonths is required (array of "YYYY-MM" strings)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get account credentials
    const { data: account, error: accountError } = await supabaseAdmin
      .from('guesty_accounts')
      .select('id, client_id, client_secret')
      .eq('id', guestyAccountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    const apiToken = await getGuestyAccessTokenCached(
      supabaseAdmin, account.id, account.client_id, account.client_secret
    );

    // Build date ranges from checkInMonths
    // Each month string "YYYY-MM" becomes a range: first day to last day
    const dateFilters: { start: string; end: string }[] = checkOutMonths.map((m: string) => {
      const [year, month] = m.split('-').map(Number);
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end };
    });

    // Find the overall min start and max end for a single query
    const overallStart = dateFilters.reduce((min, d) => d.start < min ? d.start : min, dateFilters[0].start);
    const overallEnd = dateFilters.reduce((max, d) => d.end > max ? d.end : max, dateFilters[0].end);

    console.log(`Backfilling sub_total for check-out months: ${checkOutMonths.join(', ')}`);
    console.log(`Date range: ${overallStart} to ${overallEnd}`);

    // Fetch reservations missing sub_total within the date range
    const { data: missingReservations, error: queryError } = await supabaseAdmin
      .from('reservations')
      .select('id, check_out')
      .eq('guesty_account_id', guestyAccountId)
      .is('sub_total', null)
      .gte('check_out', overallStart)
      .lte('check_out', overallEnd)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .limit(RECORDS_PER_INVOCATION);

    if (queryError) throw queryError;

    // Further filter to only include reservations whose check_in falls in the requested months
    const requestedMonths = new Set(checkOutMonths);
    const filteredReservations = missingReservations?.filter(r => {
      if (!r.check_out) return false;
      const checkOutMonth = r.check_out.substring(0, 7); // "YYYY-MM"
      return requestedMonths.has(checkOutMonth);
    }) || [];

    const totalMissing = filteredReservations.length;
    console.log(`Found ${totalMissing} reservations missing sub_total in requested months`);

    if (totalMissing === 0) {
      if (existingJobId) {
        await supabaseAdmin.from('sync_jobs').update({
          status: 'completed',
          progress_message: 'All reservations in selected months have sub_total data',
          completed_at: new Date().toISOString(),
        }).eq('id', existingJobId);
      }
      return new Response(JSON.stringify({ message: 'No reservations missing sub_total', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create or reuse sync job
    let jobId = existingJobId;
    if (!jobId) {
      // Get total count for progress
      const { count: totalCount } = await supabaseAdmin
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('guesty_account_id', guestyAccountId)
        .is('sub_total', null)
        .gte('check_out', overallStart)
        .lte('check_out', overallEnd)
        .in('status', ['confirmed', 'checked_in', 'checked_out']);

      const { data: newJob, error: jobError } = await supabaseAdmin
        .from('sync_jobs')
        .insert({
          guesty_account_id: guestyAccountId,
          sync_type: 'backfill_subtotals',
          status: 'running',
          progress_message: `Starting sub_total backfill for ${totalCount} reservations...`,
          total_items: totalCount,
          items_synced: 0,
        })
        .select('id')
        .single();

      if (jobError) throw jobError;
      jobId = newJob.id;
    }

    const startTime = Date.now();
    let processed = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < filteredReservations.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > FUNCTION_TIMEOUT_BUFFER) {
        console.log(`Approaching timeout after processing ${processed} records, will self-invoke`);
        break;
      }

      // Check cancellation
      const { data: jobCheck } = await supabaseAdmin
        .from('sync_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (jobCheck?.status === 'failed') {
        console.log('Job was cancelled');
        return new Response(JSON.stringify({ message: 'Job cancelled', processed, updated }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const batch = filteredReservations.slice(i, i + BATCH_SIZE);

      for (let j = 0; j < batch.length; j++) {
        const reservation = batch[j];
        if (j > 0) await sleep(200);
        try {
          const subTotal = await fetchReservationSubTotal(apiToken, reservation.id);

          if (subTotal !== null) {
            const { error: updateError } = await supabaseAdmin
              .from('reservations')
              .update({ sub_total: subTotal })
              .eq('id', reservation.id);

            if (updateError) {
              console.error(`Failed to update ${reservation.id}:`, updateError);
              errors++;
            } else {
              updated++;
            }
          } else {
            // Set to 0 if not found
            await supabaseAdmin
              .from('reservations')
              .update({ sub_total: 0 })
              .eq('id', reservation.id);
            updated++;
          }
        } catch (err: any) {
          console.error(`Error fetching sub_total for ${reservation.id}:`, err.message);
          errors++;
        }
        processed++;
      }

      // Update progress
      const { data: currentProgress } = await supabaseAdmin
        .from('sync_jobs')
        .select('items_synced')
        .eq('id', jobId)
        .single();
      const newItemsSynced = (currentProgress?.items_synced || 0) + batch.length;
      await supabaseAdmin.from('sync_jobs').update({
        items_synced: newItemsSynced,
        progress_message: `Updated ${newItemsSynced} reservations (${errors} errors)...`,
      }).eq('id', jobId);

      if (i + BATCH_SIZE < filteredReservations.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    // Check if there are more to process
    const { count: remainingCount } = await supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('guesty_account_id', guestyAccountId)
      .is('sub_total', null)
      .gte('check_out', overallStart)
      .lte('check_out', overallEnd)
      .in('status', ['confirmed', 'checked_in', 'checked_out']);

    if (remainingCount && remainingCount > 0) {
      console.log(`${remainingCount} reservations remaining, self-invoking...`);

      const functionUrl = `${supabaseUrl}/functions/v1/backfill-reservation-subtotals`;
      fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'x-service-role': 'true',
        },
        body: JSON.stringify({ guestyAccountId, checkOutMonths, jobId }),
      }).catch(err => console.error('Self-invoke error:', err));

      return new Response(JSON.stringify({
        message: 'Batch complete, continuing...',
        processed,
        updated,
        errors,
        remaining: remainingCount,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // All done
    await supabaseAdmin.from('sync_jobs').update({
      status: errors > 0 ? 'completed_with_errors' : 'completed',
      progress_message: `Completed. Updated ${updated} reservations${errors > 0 ? ` (${errors} errors)` : ''}`,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    return new Response(JSON.stringify({
      message: 'Sub_total backfill complete',
      processed,
      updated,
      errors,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

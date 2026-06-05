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

const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 500;
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

async function fetchReservationPage(
  apiToken: string,
  checkOutStart: string,
  checkOutEnd: string,
  skip: number
): Promise<{ results: Array<{ _id: string; money?: { fareAccommodationAdjusted?: number; hostPayout?: number; totalPaid?: number; ownerRevenue?: number; totalTaxes?: number; subTotalPrice?: number } }>; count: number }> {
  const filters = JSON.stringify([
    { field: 'checkOut', operator: '$gte', value: checkOutStart },
    { field: 'checkOut', operator: '$lte', value: checkOutEnd },
  ]);

  const params = new URLSearchParams({
    filters,
    fields: '_id money.fareAccommodationAdjusted money.hostPayout money.totalPaid money.ownerRevenue money.totalTaxes money.subTotalPrice',
    limit: String(PAGE_SIZE),
    skip: String(skip),
    sort: 'checkOut',
  });

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 15000));
    }

    const response = await fetch(
      `https://open-api.guesty.com/v1/reservations?${params.toString()}`,
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
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
        const backoffMs = Math.min(2000 * Math.pow(2, attempt), 30000);
        const waitTime = Math.max(backoffMs, retryAfterMs);
        if (waitTime > MAX_WAIT_TIME) {
          throw new Error('Rate limit wait too long, aborting page fetch');
        }
        console.log(`Rate limited on list endpoint, waiting ${waitTime}ms (attempt ${attempt + 1}/4)...`);
        await sleep(waitTime);
        continue;
      }
      throw new Error('Rate limit exceeded after retries on list endpoint');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Guesty list API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return { results: data.results || [], count: data.count || 0 };
  }

  throw new Error('Failed to fetch reservation page after retries');
}

const IDS_PER_REQUEST = 100;

async function fetchReservationsByIds(
  apiToken: string,
  ids: string[]
): Promise<Array<{ _id: string; money?: { subTotalPrice?: number; fareAccommodationAdjusted?: number; fareAccommodation?: number } }>> {
  if (ids.length === 0) return [];
  const filters = JSON.stringify([{ field: '_id', operator: '$in', value: ids }]);
  const params = new URLSearchParams({
    filters,
    fields: '_id money.subTotalPrice money.fareAccommodationAdjusted money.fareAccommodation',
    limit: String(ids.length),
    skip: '0',
  });

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 15000));

    const response = await fetch(
      `https://open-api.guesty.com/v1/reservations?${params.toString()}`,
      { headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' } }
    );

    if (response.status === 429) {
      if (attempt < 3) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
        const waitTime = Math.max(Math.min(2000 * Math.pow(2, attempt), 30000), retryAfterMs);
        if (waitTime > MAX_WAIT_TIME) throw new Error('Rate limit wait too long, aborting id-batch fetch');
        await sleep(waitTime);
        continue;
      }
      throw new Error('Rate limit exceeded after retries on id-batch endpoint');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Guesty id-batch API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.results || [];
  }
  throw new Error('Failed to fetch reservations by ids after retries');
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
    const { guestyAccountId, jobId: existingJobId, skipOffset, onlyMissing: onlyMissingRaw } = body;
    const checkOutMonths = body.checkOutMonths || body.checkInMonths;
    const onlyMissing = onlyMissingRaw === true;

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

    // Get account
    const { data: account, error: accountError } = await supabaseAdmin
      .from('guesty_accounts')
      .select('id')
      .eq('id', guestyAccountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    const { data: creds, error: credsError } = await supabaseAdmin
      .from('guesty_account_credentials')
      .select('client_id, client_secret')
      .eq('guesty_account_id', guestyAccountId)
      .single();

    if (credsError || !creds) {
      throw new Error('Guesty account credentials not found');
    }

    const apiToken = await getGuestyAccessTokenCached(
      supabaseAdmin, account.id, creds.client_id, creds.client_secret
    );

    // Build date range from checkOutMonths
    const dateFilters: { start: string; end: string }[] = checkOutMonths.map((m: string) => {
      const [year, month] = m.split('-').map(Number);
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { start, end };
    });

    const overallStart = dateFilters.reduce((min, d) => d.start < min ? d.start : min, dateFilters[0].start);
    const overallEnd = dateFilters.reduce((max, d) => d.end > max ? d.end : max, dateFilters[0].end);

    console.log(`Backfilling sub_total for check-out months: ${checkOutMonths.join(', ')} (onlyMissing=${onlyMissing})`);
    console.log(`Date range: ${overallStart} to ${overallEnd}`);

    // Preload missing-id set when onlyMissing is enabled, so we only touch reservations
    // that still lack sub_total. Uses batched fetching to bypass the 1000-row limit.
    let missingIds: Set<string> | null = null;
    if (onlyMissing) {
      missingIds = new Set<string>();
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabaseAdmin
          .from('reservations')
          .select('id')
          .eq('guesty_account_id', guestyAccountId)
          .is('sub_total', null)
          .in('status', ['confirmed', 'checked_in', 'checked_out'])
          .gte('check_out', overallStart)
          .lte('check_out', overallEnd)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) missingIds.add(r.id);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      console.log(`onlyMissing: ${missingIds.size} reservations in DB need sub_total`);
      if (missingIds.size === 0 && !existingJobId) {
        // Nothing to do — record a completed job for visibility and exit.
        const { data: noopJob } = await supabaseAdmin
          .from('sync_jobs')
          .insert({
            guesty_account_id: guestyAccountId,
            sync_type: 'backfill_subtotals',
            status: 'completed',
            progress_message: 'No reservations missing sub_total in selected months.',
            total_items: 0,
            items_synced: 0,
            completed_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        return new Response(JSON.stringify({
          message: 'No reservations missing sub_total in selected months',
          updated: 0, skipped: 0, pagesProcessed: 0, totalFromGuesty: 0, jobId: noopJob?.id,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // ====== FAST PATH: onlyMissing — fetch the specific reservation ids from Guesty
    // in 100-id chunks instead of scanning every reservation in the date range. ======
    if (onlyMissing) {
      const allIds = Array.from(missingIds!);
      const startIdx = skipOffset || 0;
      const totalTarget = allIds.length;

      let jobId = existingJobId;
      if (!jobId) {
        const { data: newJob, error: jobError } = await supabaseAdmin
          .from('sync_jobs')
          .insert({
            guesty_account_id: guestyAccountId,
            sync_type: 'backfill_subtotals',
            status: 'running',
            progress_message: `Starting targeted sub_total backfill (${totalTarget} reservations)...`,
            total_items: totalTarget,
            items_synced: startIdx,
          })
          .select('id')
          .single();
        if (jobError) throw jobError;
        jobId = newJob.id;
      }

      const startTime = Date.now();
      let updated = 0;
      let skipped = 0;
      let batchesProcessed = 0;
      let cursor = startIdx;

      while (cursor < totalTarget) {
        if (Date.now() - startTime > FUNCTION_TIMEOUT_BUFFER) {
          console.log(`Approaching timeout after ${batchesProcessed} batches (${cursor}/${totalTarget}), will self-invoke`);
          break;
        }

        const { data: jobCheck } = await supabaseAdmin
          .from('sync_jobs').select('status').eq('id', jobId).single();
        if (jobCheck?.status === 'failed') {
          return new Response(JSON.stringify({ message: 'Job cancelled', updated, skipped }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const chunk = allIds.slice(cursor, cursor + IDS_PER_REQUEST);
        const results = await fetchReservationsByIds(apiToken, chunk);

        const returnedIds = new Set(results.map((r) => r._id));
        for (const res of results) {
          // Prefer Guesty's authoritative subTotalPrice, but fall back to fareAccommodationAdjusted
          // (or fareAccommodation) so cancelled/manual/legacy reservations stop being re-skipped
          // on every backfill run.
          const subTotal =
            res.money?.subTotalPrice ??
            res.money?.fareAccommodationAdjusted ??
            res.money?.fareAccommodation ??
            null;
          if (subTotal != null) {
            const { error: updateError } = await supabaseAdmin
              .from('reservations').update({ sub_total: subTotal }).eq('id', res._id);
            if (updateError) console.error(`Failed to update ${res._id}:`, updateError);
            else updated++;
          } else {
            skipped++;
          }
        }
        // Ids requested but not returned by Guesty (deleted/inaccessible) — backfill from
        // the local fare_accommodation_adjusted so they're no longer flagged as missing.
        const missingFromGuesty = chunk.filter((id) => !returnedIds.has(id));
        if (missingFromGuesty.length > 0) {
          const { data: localRows } = await supabaseAdmin
            .from('reservations')
            .select('id, fare_accommodation_adjusted')
            .in('id', missingFromGuesty);
          for (const row of localRows ?? []) {
            if (row.fare_accommodation_adjusted != null) {
              const { error: updErr } = await supabaseAdmin
                .from('reservations')
                .update({ sub_total: row.fare_accommodation_adjusted })
                .eq('id', row.id);
              if (!updErr) updated++;
              else skipped++;
            } else {
              skipped++;
            }
          }
        }

        cursor += chunk.length;
        batchesProcessed++;

        await supabaseAdmin.from('sync_jobs').update({
          items_synced: cursor,
          progress_message: `Updated ${updated} reservations (batch ${batchesProcessed}, ${skipped} skipped)...`,
        }).eq('id', jobId);

        await sleep(PAGE_DELAY_MS);
      }

      if (cursor < totalTarget) {
        const functionUrl = `${supabaseUrl}/functions/v1/backfill-reservation-subtotals`;
        fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
            'x-service-role': 'true',
          },
          body: JSON.stringify({ guestyAccountId, checkOutMonths, jobId, skipOffset: cursor, onlyMissing: true }),
        }).catch((err) => console.error('Self-invoke error:', err));

        return new Response(JSON.stringify({
          message: 'Batch complete, continuing...',
          updated, skipped, batchesProcessed, cursor, totalTarget,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      await supabaseAdmin.from('sync_jobs').update({
        status: 'completed',
        progress_message: `Completed. Updated ${updated} reservations (${skipped} skipped: no subTotalPrice or not returned by Guesty).`,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);

      return new Response(JSON.stringify({
        message: 'Targeted sub_total backfill complete',
        updated, skipped, batchesProcessed, totalTarget,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }



    // First page fetch to get total count from Guesty
    let currentSkip = skipOffset || 0;
    const firstPage = await fetchReservationPage(apiToken, overallStart, overallEnd, currentSkip);
    const totalFromGuesty = firstPage.count;

    console.log(`Guesty reports ${totalFromGuesty} total reservations in date range, starting at skip=${currentSkip}`);

    // Create or reuse sync job
    let jobId = existingJobId;
    if (!jobId) {
      const { data: newJob, error: jobError } = await supabaseAdmin
        .from('sync_jobs')
        .insert({
          guesty_account_id: guestyAccountId,
          sync_type: 'backfill_subtotals',
          status: 'running',
          progress_message: onlyMissing
            ? `Starting sub_total backfill (only-missing mode: ${missingIds!.size} target rows; scanning ${totalFromGuesty} from Guesty)...`
            : `Starting sub_total backfill (${totalFromGuesty} reservations from Guesty)...`,
          total_items: totalFromGuesty,
          items_synced: currentSkip,
        })
        .select('id')
        .single();

      if (jobError) throw jobError;
      jobId = newJob.id;
    }

    const startTime = Date.now();
    let updated = 0;
    let skipped = 0;
    let pagesProcessed = 0;

    // Process first page
    const processPage = async (results: Array<{ _id: string; money?: { subTotalPrice?: number } }>) => {
      const updates: { id: string; sub_total: number }[] = [];
      for (const res of results) {
        // In onlyMissing mode, skip reservations that already have sub_total in DB.
        if (missingIds && !missingIds.has(res._id)) {
          skipped++;
          continue;
        }
        const subTotal = res.money?.subTotalPrice;
        if (subTotal != null && subTotal !== undefined) {
          updates.push({ id: res._id, sub_total: subTotal });
        } else {
          skipped++;
        }
      }

      // Batch update DB
      for (const upd of updates) {
        const { error: updateError } = await supabaseAdmin
          .from('reservations')
          .update({ sub_total: upd.sub_total })
          .eq('id', upd.id);

        if (updateError) {
          console.error(`Failed to update ${upd.id}:`, updateError);
        } else {
          updated++;
        }
      }
    };


    if (firstPage.results.length > 0) {
      const sample = firstPage.results[0];
      console.log(`Sample reservation: _id=${sample._id}, money=${JSON.stringify(sample.money)}`);
    }

    await processPage(firstPage.results);
    currentSkip += firstPage.results.length;
    pagesProcessed++;

    // Update progress
    await supabaseAdmin.from('sync_jobs').update({
      items_synced: currentSkip,
      progress_message: `Updated ${updated} reservations (page ${pagesProcessed}, ${skipped} skipped)...`,
    }).eq('id', jobId);

    // Continue fetching pages until done or timeout approaching
    while (currentSkip < totalFromGuesty) {
      if (Date.now() - startTime > FUNCTION_TIMEOUT_BUFFER) {
        console.log(`Approaching timeout after ${pagesProcessed} pages (${currentSkip}/${totalFromGuesty}), will self-invoke`);
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
        return new Response(JSON.stringify({ message: 'Job cancelled', updated, skipped }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await sleep(PAGE_DELAY_MS);

      const page = await fetchReservationPage(apiToken, overallStart, overallEnd, currentSkip);
      if (page.results.length === 0) break;

      await processPage(page.results);
      currentSkip += page.results.length;
      pagesProcessed++;

      // Update progress
      await supabaseAdmin.from('sync_jobs').update({
        items_synced: currentSkip,
        progress_message: `Updated ${updated} reservations (page ${pagesProcessed}, ${skipped} skipped)...`,
      }).eq('id', jobId);
    }

    // If there are more pages, self-invoke
    if (currentSkip < totalFromGuesty) {
      console.log(`${totalFromGuesty - currentSkip} reservations remaining, self-invoking at skip=${currentSkip}...`);

      const functionUrl = `${supabaseUrl}/functions/v1/backfill-reservation-subtotals`;
      fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'x-service-role': 'true',
        },
        body: JSON.stringify({ guestyAccountId, checkOutMonths, jobId, skipOffset: currentSkip, onlyMissing }),
      }).catch(err => console.error('Self-invoke error:', err));

      return new Response(JSON.stringify({
        message: 'Batch complete, continuing...',
        updated,
        skipped,
        pagesProcessed,
        currentSkip,
        totalFromGuesty,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // All done
    await supabaseAdmin.from('sync_jobs').update({
      status: 'completed',
      progress_message: `Completed. Updated ${updated} reservations (${skipped} had no subTotalPrice data).`,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    return new Response(JSON.stringify({
      message: 'Sub_total backfill complete',
      updated,
      skipped,
      pagesProcessed,
      totalFromGuesty,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

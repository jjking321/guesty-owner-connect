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

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fetchGuestyOAuthToken(clientId: string, clientSecret: string): Promise<string> {
  const start = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tokenResponse = await fetch('https://open-api.guesty.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'open-api',
        }),
      });

      if (tokenResponse.status === 429) {
        const retryAfterMs = parseRetryAfter(tokenResponse.headers.get('retry-after'));
        const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        const waitTime = Math.max(backoff, retryAfterMs || 0);

        if (Date.now() - start + waitTime > MAX_WAIT_TIME) {
          const estimatedWaitMinutes = Math.max(3, Math.ceil(retryAfterMs / 60000));
          throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${estimatedWaitMinutes} minutes before trying again.`);
        }

        await sleep(waitTime);
        continue;
      }

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Failed to get access token: ${tokenResponse.status} - ${errorText}`);
      }

      const { access_token } = await tokenResponse.json();
      return access_token;
    } catch (error: any) {
      if (error.message?.includes('OAUTH_RATE_LIMIT')) throw error;
      if (attempt === MAX_RETRIES) throw error;
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
    }
  }

  throw new Error("OAUTH_RATE_LIMIT:Unable to authenticate with Guesty after multiple attempts. Please wait 3 minutes.");
}

async function getGuestyAccessTokenCached(
  supabaseAdmin: any,
  accountId: string,
  clientId: string,
  clientSecret: string,
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
      const { data: polled } = await supabaseAdmin
        .from('guesty_oauth_tokens')
        .select('access_token, expires_at, refresh_in_progress, oauth_cooldown_until')
        .eq('guesty_account_id', accountId)
        .maybeSingle();

      if (polled && !polled.refresh_in_progress) {
        const expiresAt = new Date(polled.expires_at).getTime();
        if (expiresAt > Date.now() + TOKEN_BUFFER_MS) return polled.access_token;
      }
    }
  }

  try {
    const token = await fetchGuestyOAuthToken(clientId, clientSecret);
    await supabaseAdmin.from('guesty_oauth_tokens').upsert({
      guesty_account_id: accountId,
      access_token: token,
      expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
      oauth_cooldown_until: null,
      refresh_in_progress: false,
      refresh_started_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guesty_account_id' });
    return token;
  } catch (error: any) {
    if (error.message?.includes('OAUTH_RATE_LIMIT')) {
      await supabaseAdmin.from('guesty_oauth_tokens').upsert({
        guesty_account_id: accountId,
        access_token: tokenRow?.access_token || '',
        expires_at: tokenRow?.expires_at || new Date().toISOString(),
        oauth_cooldown_until: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        refresh_in_progress: false,
        refresh_started_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'guesty_account_id' });
    } else {
      await supabaseAdmin
        .from('guesty_oauth_tokens')
        .update({ refresh_in_progress: false, refresh_started_at: null, updated_at: new Date().toISOString() })
        .eq('guesty_account_id', accountId);
    }
    throw error;
  }
}

async function fetchGuestyListings(apiToken: string, skip: number, limit: number) {
  const MAX_DATA_RETRIES = 5;
  const start = Date.now();

  for (let attempt = 1; attempt <= MAX_DATA_RETRIES; attempt++) {
    try {
      const url = new URL('https://open-api.guesty.com/v1/listings');
      url.searchParams.append('limit', String(limit));
      url.searchParams.append('skip', String(skip));

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      });

      const rls = {
        sec: parseInt(response.headers.get('x-ratelimit-remaining-second') || '999'),
        min: parseInt(response.headers.get('x-ratelimit-remaining-minute') || '999'),
        hr: parseInt(response.headers.get('x-ratelimit-remaining-hour') || '999'),
      };
      console.log(`Guesty rate limits remaining - s:${rls.sec} m:${rls.min} h:${rls.hr}`);

      if (response.ok) return await response.json();

      const status = response.status;
      const text = await response.text();
      console.warn(`Guesty listings error (${status}) attempt ${attempt}: ${text}`);

      if ([429, 502, 503, 504].includes(status)) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        const waitMs = Math.max(backoff, retryAfterMs || 0);
        if (Date.now() - start + waitMs > MAX_WAIT_TIME) {
          throw new Error('Guesty API rate limit reached. Please try again in a moment.');
        }
        await sleep(waitMs);
        continue;
      }

      throw new Error(`Guesty API error: ${status} - ${text}`);
    } catch (err: any) {
      if (attempt >= MAX_DATA_RETRIES || Date.now() - start > MAX_WAIT_TIME) {
        throw new Error(err?.message || 'Guesty listings request failed');
      }
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
    }
  }

  throw new Error('Guesty listings request failed after multiple attempts');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body?.accountId;
    if (!accountId || typeof accountId !== 'string') {
      return new Response(JSON.stringify({ error: 'accountId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: account, error: accountError } = await admin
      .from('guesty_accounts')
      .select('organization_id')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ error: 'Account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller identity + organization membership
    const authHeader = req.headers.get('Authorization') || '';
    const isServiceCall = req.headers.get('x-service-role') === 'true';

    if (!isServiceCall) {
      if (!authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Not authenticated' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Not authenticated' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: isMember } = await admin.rpc('is_organization_member', {
        _organization_id: account.organization_id,
        _user_id: userData.user.id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: 'Not authorized for this account' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { data: creds, error: credsError } = await admin
      .from('guesty_account_credentials')
      .select('client_id, client_secret')
      .eq('guesty_account_id', accountId)
      .single();

    if (credsError || !creds) {
      return new Response(JSON.stringify({ error: 'Guesty credentials not found for this account' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await getGuestyAccessTokenCached(admin, accountId, creds.client_id, creds.client_secret);

    const limit = 100;
    let skip = 0;
    let updated = 0;
    let withAmenities = 0;
    let total: number | undefined;

    while (true) {
      const data = await fetchGuestyListings(token, skip, limit);
      const listings = data?.results || [];
      total = data?.count ?? total;

      if (listings.length === 0) break;

      const rows = listings.map((l: any) => ({
        id: l._id,
        amenities: Array.isArray(l.amenities) ? l.amenities : [],
        bathrooms: typeof l.bathrooms === 'number' ? l.bathrooms : null,
        amenities_synced_at: new Date().toISOString(),
      }));

      for (const row of rows) {
        if (row.amenities.length > 0) withAmenities++;
        const { error: updateError } = await admin
          .from('listings')
          .update({
            amenities: row.amenities,
            bathrooms: row.bathrooms,
            amenities_synced_at: row.amenities_synced_at,
          })
          .eq('id', row.id);
        if (!updateError) updated++;
      }

      skip += limit;
      if (listings.length < limit) break;
      await sleep(350);
    }

    console.log(`Amenities backfill complete: ${updated} listings updated, ${withAmenities} with amenities`);

    return new Response(
      JSON.stringify({ success: true, updated, with_amenities: withAmenities, total }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('backfill-listing-amenities error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

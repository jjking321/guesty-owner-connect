import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RETRIES = 5;
const MAX_WAIT_TIME = 45000; // 45 seconds to prevent edge function timeout
const TOKEN_BUFFER_MS = 120000; // 2 minutes buffer before token expiry
const LOCK_STALE_MS = 90000; // 90 seconds before considering a lock stale
const LOCK_POLL_INTERVAL_MS = 1000; // 1 second between lock polls
const LOCK_MAX_POLLS = 6; // Maximum polls waiting for lock

interface GuestyOwner {
  _id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  listings?: string[];
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function getGuestyAccessTokenCached(
  supabaseAdmin: any,
  accountId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  // Step 1: Check for existing valid token or cooldown
  const { data: tokenRow, error: readError } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .select('*')
    .eq('guesty_account_id', accountId)
    .maybeSingle();

  if (readError) {
    console.error('Error reading token cache:', readError);
  }

  if (tokenRow) {
    // Check if in cooldown
    if (tokenRow.oauth_cooldown_until) {
      const cooldownUntil = new Date(tokenRow.oauth_cooldown_until).getTime();
      if (cooldownUntil > Date.now()) {
        const waitMinutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
        throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${waitMinutes} minutes before trying again.`);
      }
    }

    // Check if token is still valid (with buffer)
    const expiresAt = new Date(tokenRow.expires_at).getTime();
    if (expiresAt > Date.now() + TOKEN_BUFFER_MS) {
      console.log('token_cache_hit: Using cached access token');
      return tokenRow.access_token;
    }
  }

  console.log('token_cache_miss_refreshing: Token expired or not found, refreshing...');

  // Step 2: Try to acquire refresh lock
  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS).toISOString();

  // Atomic lock acquisition: only succeed if no lock or lock is stale
  const { data: lockResult, error: lockError } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .update({
      refresh_in_progress: true,
      refresh_started_at: now,
      updated_at: now,
    })
    .eq('guesty_account_id', accountId)
    .or(`refresh_in_progress.eq.false,refresh_started_at.lt.${staleThreshold}`)
    .select();

  const lockAcquired = !lockError && lockResult && lockResult.length > 0;

  if (!lockAcquired && tokenRow) {
    // Another process is refreshing, wait and poll
    console.log('token_refresh_lock_wait: Another process is refreshing, waiting...');
    
    for (let poll = 0; poll < LOCK_MAX_POLLS; poll++) {
      await sleep(LOCK_POLL_INTERVAL_MS);
      
      const { data: polledToken } = await supabaseAdmin
        .from('guesty_oauth_tokens')
        .select('access_token, expires_at, refresh_in_progress, oauth_cooldown_until')
        .eq('guesty_account_id', accountId)
        .maybeSingle();

      if (polledToken) {
        // Check if cooldown was set
        if (polledToken.oauth_cooldown_until) {
          const cooldownUntil = new Date(polledToken.oauth_cooldown_until).getTime();
          if (cooldownUntil > Date.now()) {
            const waitMinutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
            throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${waitMinutes} minutes before trying again.`);
          }
        }

        // Check if token was refreshed
        if (!polledToken.refresh_in_progress) {
          const expiresAt = new Date(polledToken.expires_at).getTime();
          if (expiresAt > Date.now() + TOKEN_BUFFER_MS) {
            console.log('token_cache_hit_after_wait: Got token after waiting for refresh');
            return polledToken.access_token;
          }
        }
      }
    }

    // If we're here, try to acquire lock again (previous holder may have failed)
    console.log('token_refresh_lock_retry: Retrying lock acquisition after wait');
  }

  console.log('token_refresh_lock_acquired: Acquired lock, fetching new token');

  // Step 3: Fetch new token from Guesty
  try {
    const token = await fetchGuestyOAuthToken(clientId, clientSecret);
    
    // Calculate expiry (Guesty tokens typically last 1 hour, use 55 minutes to be safe)
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    
    // Upsert the new token
    const { error: upsertError } = await supabaseAdmin
      .from('guesty_oauth_tokens')
      .upsert({
        guesty_account_id: accountId,
        access_token: token,
        expires_at: expiresAt,
        oauth_cooldown_until: null,
        refresh_in_progress: false,
        refresh_started_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'guesty_account_id' });

    if (upsertError) {
      console.error('Error saving token to cache:', upsertError);
    }

    console.log('token_refresh_success: New token cached');
    return token;
  } catch (error: any) {
    // If OAuth 429, persist cooldown
    if (error.message?.includes('OAUTH_RATE_LIMIT')) {
      const cooldownMinutes = 3; // Default 3 minute cooldown
      const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000).toISOString();
      
      await supabaseAdmin
        .from('guesty_oauth_tokens')
        .upsert({
          guesty_account_id: accountId,
          access_token: tokenRow?.access_token || '',
          expires_at: tokenRow?.expires_at || new Date().toISOString(),
          oauth_cooldown_until: cooldownUntil,
          refresh_in_progress: false,
          refresh_started_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'guesty_account_id' });
    } else {
      // Clear lock on other errors
      await supabaseAdmin
        .from('guesty_oauth_tokens')
        .update({
          refresh_in_progress: false,
          refresh_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('guesty_account_id', accountId);
    }
    
    throw error;
  }
}

async function fetchGuestyOAuthToken(clientId: string, clientSecret: string): Promise<string> {
  const start = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Token fetch attempt ${attempt}/${MAX_RETRIES}`);
      
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

        console.log(`Rate limited on token request. Waiting ${waitTime}ms before retry...`);
        await sleep(waitTime);
        continue;
      }

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Failed to get access token: ${tokenResponse.status} - ${errorText}`);
      }

      const { access_token } = await tokenResponse.json();
      console.log('Successfully obtained access token');
      return access_token;
    } catch (error: any) {
      if (error.message?.includes('OAUTH_RATE_LIMIT')) {
        throw error;
      }
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      console.log(`Error on attempt ${attempt}, retrying...`, error.message);
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
    }
  }
  
  throw new Error('OAUTH_RATE_LIMIT:Unable to authenticate with Guesty after multiple attempts. Please wait 3 minutes.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey
  );

  // Auth: service-role (nightly-sync) or admin/super_admin user
  const authBearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const isServiceRole = authBearer.length > 0 && authBearer === serviceRoleKey;
  if (!isServiceRole) {
    if (!authBearer) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser(authBearer);
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: roleRow } = await supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', userData.user.id)
      .in('role', ['admin', 'super_admin'])
      .limit(1)
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  try {
    const { accountId } = await req.json();
    console.log(`Starting owner sync for account ${accountId}`);

    // Get Guesty account credentials
    const { data: creds, error: credsError } = await supabase
      .from('guesty_account_credentials')
      .select('client_id, client_secret')
      .eq('guesty_account_id', accountId)
      .single();

    if (credsError || !creds) {
      throw new Error('Guesty account credentials not found');
    }

    // Get access token using cached token manager
    console.log('Getting access token (with caching)...');
    const access_token = await getGuestyAccessTokenCached(
      supabase,
      accountId,
      creds.client_id,
      creds.client_secret
    );

    // Fetch owners from Guesty with retry logic
    console.log('Fetching owners from Guesty...');
    let ownersResponse: Response | undefined;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        ownersResponse = await fetch('https://open-api.guesty.com/v1/owners', {
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
        });

        if (ownersResponse.status === 429) {
          const retryAfterMs = parseRetryAfter(ownersResponse.headers.get('retry-after'));
          const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
          const waitTime = Math.max(backoff, retryAfterMs || 0);

          if (waitTime > MAX_WAIT_TIME) {
            throw new Error(`Rate limit wait time (${waitTime}ms) exceeds maximum allowed time. Please try again later.`);
          }

          console.log(`Rate limited on owners request. Waiting ${waitTime}ms before retry...`);
          await sleep(waitTime);
          continue;
        }

        if (!ownersResponse.ok) {
          throw new Error(`Failed to fetch owners: ${ownersResponse.statusText}`);
        }

        break;
      } catch (error: any) {
        if (attempt === MAX_RETRIES) {
          throw error;
        }
        console.log(`Error fetching owners on attempt ${attempt}, retrying...`, error.message);
      }
    }

    if (!ownersResponse) {
      throw new Error('Failed to fetch owners after all retries');
    }

    const guestyOwners: GuestyOwner[] = await ownersResponse.json();
    console.log(`Fetched ${guestyOwners.length} owners from Guesty`);

    if (guestyOwners.length === 0) {
      return new Response(
        JSON.stringify({ success: true, ownersCount: 0, listingsUpdated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Transform and upsert owners
    const owners = guestyOwners.map(owner => ({
      id: owner._id,
      guesty_account_id: accountId,
      first_name: owner.firstName || null,
      last_name: owner.lastName || null,
      full_name: owner.fullName || null,
      email: owner.email || null,
      phone: owner.phone || null,
      listing_ids: owner.listings || [],
    }));

    console.log(`Upserting ${owners.length} owners...`);
    const { error: upsertError } = await supabase
      .from('owners')
      .upsert(owners, { onConflict: 'id' });

    if (upsertError) {
      throw new Error(`Failed to upsert owners: ${upsertError.message}`);
    }

    console.log('Owners upserted successfully');

    // Update listings with owner_id
    let listingsUpdated = 0;
    for (const owner of guestyOwners) {
      if (owner.listings && owner.listings.length > 0) {
        const { error: updateError } = await supabase
          .from('listings')
          .update({ owner_id: owner._id })
          .in('id', owner.listings)
          .eq('guesty_account_id', accountId);

        if (updateError) {
          console.error(`Error updating listings for owner ${owner._id}:`, updateError);
        } else {
          listingsUpdated += owner.listings.length;
        }
      }
    }

    console.log(`Updated ${listingsUpdated} listings with owner_id`);

    // Update last_owners_sync timestamp
    await supabase
      .from('guesty_accounts')
      .update({ last_owners_sync: new Date().toISOString() })
      .eq('id', accountId);

    console.log('Owner sync completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        ownersCount: guestyOwners.length,
        listingsUpdated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Owner sync error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

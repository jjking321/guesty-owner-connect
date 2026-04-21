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

function delay(ms: number) {
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
  const { data: tokenRow, error: readError } = await supabaseAdmin
    .from('guesty_oauth_tokens')
    .select('*')
    .eq('guesty_account_id', accountId)
    .maybeSingle();

  if (readError) {
    console.error('Error reading token cache:', readError);
  }

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
      console.log('token_cache_hit: Using cached access token');
      return tokenRow.access_token;
    }
  }

  console.log('token_cache_miss_refreshing: Token expired or not found, refreshing...');

  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - LOCK_STALE_MS).toISOString();

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
    console.log('token_refresh_lock_wait: Another process is refreshing, waiting...');
    
    for (let poll = 0; poll < LOCK_MAX_POLLS; poll++) {
      await delay(LOCK_POLL_INTERVAL_MS);
      
      const { data: polledToken } = await supabaseAdmin
        .from('guesty_oauth_tokens')
        .select('access_token, expires_at, refresh_in_progress, oauth_cooldown_until')
        .eq('guesty_account_id', accountId)
        .maybeSingle();

      if (polledToken) {
        if (polledToken.oauth_cooldown_until) {
          const cooldownUntil = new Date(polledToken.oauth_cooldown_until).getTime();
          if (cooldownUntil > Date.now()) {
            const waitMinutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
            throw new Error(`OAUTH_RATE_LIMIT:Guesty's authentication service is rate-limited. Please wait ${waitMinutes} minutes before trying again.`);
          }
        }

        if (!polledToken.refresh_in_progress) {
          const expiresAt = new Date(polledToken.expires_at).getTime();
          if (expiresAt > Date.now() + TOKEN_BUFFER_MS) {
            console.log('token_cache_hit_after_wait: Got token after waiting for refresh');
            return polledToken.access_token;
          }
        }
      }
    }

    console.log('token_refresh_lock_retry: Retrying lock acquisition after wait');
  }

  console.log('token_refresh_lock_acquired: Acquired lock, fetching new token');

  try {
    const token = await fetchGuestyOAuthToken(clientId, clientSecret);
    const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    
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
    if (error.message?.includes('OAUTH_RATE_LIMIT')) {
      const cooldownMinutes = 3;
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
        await delay(waitTime);
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
      await delay(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
    }
  }
  
  throw new Error('OAUTH_RATE_LIMIT:Unable to authenticate with Guesty after multiple attempts. Please wait 3 minutes.');
}

async function fetchWithRetry(
  url: string,
  accessToken: string,
  description: string
): Promise<any> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`Fetching ${description}: ${url}`);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        const backoffMs = Math.max(2000 * Math.pow(2, attempt), retryAfterMs || 0);
        console.log(`Rate limited (429), retrying after ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await delay(backoffMs);
        continue;
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(`Guesty API error: ${response.status} ${response.statusText} - ${bodyText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error);
      
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = 2000 * Math.pow(2, attempt);
        await delay(backoffMs);
      } else {
        throw error;
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reviewId, reservationId } = await req.json();
    
    if (!reviewId) {
      throw new Error('reviewId is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Fetching conversation for review: ${reviewId}, reservation: ${reservationId}`);

    // Fetch review
    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .select('id, listing_id, reservation_id, guesty_account_id')
      .eq('id', reviewId)
      .single();

    if (reviewError || !review) {
      throw new Error(`Review not found: ${reviewError?.message || 'No review with this ID'}`);
    }

    const targetReservationId = reservationId || review.reservation_id;
    if (!targetReservationId) {
      // No reservation linked - update review and return empty
      await supabase
        .from('reviews')
        .update({
          dispute_message_history: [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);

      return new Response(JSON.stringify({ 
        success: true, 
        messages: [],
        message: 'No reservation linked to this review'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Guesty account credentials
    const { data: creds, error: credsError } = await supabase
      .from('guesty_account_credentials')
      .select('client_id, client_secret')
      .eq('guesty_account_id', review.guesty_account_id)
      .single();

    if (credsError || !creds) {
      throw new Error(`Guesty account credentials not found: ${credsError?.message}`);
    }

    // Get access token
    const accessToken = await getGuestyAccessTokenCached(
      supabase,
      review.guesty_account_id,
      creds.client_id,
      creds.client_secret
    );

    // Step 1: Find conversation for this reservation
    // Guesty API requires a filters parameter with JSON-encoded filter array
    const filters = JSON.stringify([{
      field: 'reservation._id',
      operator: '$eq',
      value: targetReservationId
    }]);
    const conversationsUrl = `https://open-api.guesty.com/v1/communication/conversations?filters=${encodeURIComponent(filters)}&limit=1`;
    const conversationsData = await fetchWithRetry(conversationsUrl, accessToken, 'conversations');

    const conversations = conversationsData?.data?.conversations || [];
    console.log(`Found ${conversations.length} conversations for reservation`);

    if (conversations.length === 0) {
      // No conversation found
      await supabase
        .from('reviews')
        .update({
          dispute_message_history: [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);

      return new Response(JSON.stringify({ 
        success: true, 
        messages: [],
        message: 'No conversation found for this reservation'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Fetch messages for the conversation
    const conversationId = conversations[0]._id || conversations[0].id;
    const postsUrl = `https://open-api.guesty.com/v1/communication/conversations/${conversationId}/posts?limit=100`;
    const postsData = await fetchWithRetry(postsUrl, accessToken, 'messages');

    const posts = postsData?.data?.posts || [];
    console.log(`Found ${posts.length} messages`);

    // Parse and format messages
    const messages = posts.map((post: any) => {
      const isGuest = post.sender?.type === 'guest' || post.sentBy === 'guest';
      const text = post.body || post.message || post.content || '';
      
      return {
        id: post._id || post.id,
        timestamp: post.createdAt || post.sentAt || new Date().toISOString(),
        sender: isGuest ? 'guest' : 'host',
        senderName: post.sender?.name || post.sender?.fullName || (isGuest ? 'Guest' : 'Host'),
        content: text,
        source: post.source || 'unknown',
      };
    }).filter((m: any) => m.content.trim().length > 0)
      .sort((a: any, b: any) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

    // Update review with messages
    await supabase
      .from('reviews')
      .update({
        dispute_message_history: messages,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reviewId);

    console.log(`Saved ${messages.length} messages to review`);

    return new Response(JSON.stringify({ 
      success: true, 
      messages,
      conversationId,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in fetch-dispute-conversation:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGuestyAccessToken(clientId: string, clientSecret: string, retries = 5): Promise<string> {
  let lastError: Error | null = null;
  const MAX_WAIT_TIME = 45000; // 45 seconds max wait (edge functions timeout at 60s)
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffDelay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.log(`Token retry attempt ${attempt}/${retries}, waiting ${backoffDelay}ms...`);
        await sleep(backoffDelay);
      } else {
        console.log('Exchanging client credentials for access token...');
      }
      
      const response = await fetch('https://open-api.guesty.com/oauth2/token', {
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
        }).toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        
        if (response.status === 429 && attempt < retries) {
          const retryAfter = response.headers.get('Retry-After');
          let waitTime: number;
          
          if (retryAfter) {
            const retryAfterNum = parseInt(retryAfter);
            if (!isNaN(retryAfterNum)) {
              waitTime = retryAfterNum * 1000;
              
              if (waitTime > MAX_WAIT_TIME) {
                const hoursToWait = Math.round(waitTime / 3600000);
                console.error(`Rate limit requires waiting ${retryAfterNum}s (~${hoursToWait}h). Too long - failing.`);
                throw new Error(`Guesty API rate limit: Please try again in ${hoursToWait} hour(s).`);
              }
              
              console.log(`Token endpoint rate limited. Retry-After: ${retryAfterNum}s`);
            } else {
              const retryDate = new Date(retryAfter);
              waitTime = retryDate.getTime() - Date.now();
              
              if (waitTime > MAX_WAIT_TIME) {
                const hoursToWait = Math.round(waitTime / 3600000);
                throw new Error(`Guesty API rate limit: Please try again in ${hoursToWait} hour(s).`);
              }
            }
          } else {
            waitTime = Math.min(2000 * Math.pow(2, attempt), 30000);
          }
          
          console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
          lastError = new Error(`Authentication failed: ${response.status} - ${error}`);
          await sleep(Math.max(waitTime, 0));
          continue;
        }
        
        throw new Error(`Authentication failed: ${response.status} - ${error}`);
      }

      const data = await response.json();
      console.log('Successfully obtained access token');
      return data.access_token;
      
    } catch (error) {
      if (attempt === retries) {
        throw lastError || error;
      }
      lastError = error as Error;
    }
  }
  
  throw lastError || new Error('Failed to obtain access token from Guesty');
}

async function fetchCalendarData(
  apiToken: string, 
  listingId: string, 
  startDate: string, 
  endDate: string,
  retries = 3
): Promise<any> {
  const url = new URL('https://open-api.guesty.com/v1/availability-pricing/api/calendar/listings');
  url.searchParams.set('listingIds', listingId);
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffDelay = Math.min(500 * Math.pow(2, attempt), 5000);
        console.log(`Calendar fetch retry ${attempt}/${retries}, waiting ${backoffDelay}ms...`);
        await sleep(backoffDelay);
      }

      console.log(`Fetching calendar data from ${startDate} to ${endDate}...`);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
        },
      });

      // Log rate limit headers
      const rateLimitSec = response.headers.get('X-ratelimit-remaining-second');
      const rateLimitMin = response.headers.get('X-ratelimit-remaining-minute');
      const rateLimitHr = response.headers.get('X-ratelimit-remaining-hour');
      console.log(`Rate limits - sec: ${rateLimitSec}, min: ${rateLimitMin}, hr: ${rateLimitHr}`);

      if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 429 && attempt < retries) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
          console.log(`Rate limited (429), waiting ${waitTime}ms...`);
          await sleep(waitTime);
          continue;
        }
        
        throw new Error(`Guesty API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log(`Successfully fetched calendar data`);
      return data;
      
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.error(`Calendar fetch attempt ${attempt} failed:`, error);
    }
  }
  
  throw new Error('Failed to fetch calendar data after retries');
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId } = await req.json();
    
    if (!listingId) {
      return new Response(
        JSON.stringify({ error: 'listingId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting calendar sync for listing: ${listingId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the listing to find its guesty_account_id
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('guesty_account_id')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      console.error('Listing not found:', listingError);
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Guesty credentials
    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('client_id, client_secret')
      .eq('id', listing.guesty_account_id)
      .single();

    if (accountError || !account) {
      console.error('Guesty account not found:', accountError);
      return new Response(
        JSON.stringify({ error: 'Guesty account not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get access token with retry logic
    const accessToken = await getGuestyAccessToken(account.client_id, account.client_secret);

    // Calculate date range (today + 365 days)
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 365);
    
    const startDateStr = today.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Fetch calendar data
    const calendarData = await fetchCalendarData(accessToken, listingId, startDateStr, endDateStr);

    // Process and upsert calendar data
    const calendarRecords: any[] = [];
    const syncedAt = new Date().toISOString();

    if (calendarData.data && calendarData.data[listingId] && calendarData.data[listingId].days) {
      const days = calendarData.data[listingId].days;
      
      for (const [dateStr, dayData] of Object.entries(days)) {
        const day = dayData as any;
        
        calendarRecords.push({
          listing_id: listingId,
          date: dateStr,
          price: day.price || null,
          currency: day.currency || 'USD',
          min_nights: day.minNights || null,
          status: day.status || null,
          is_available: day.status === 'available',
          cta: day.cta || false,
          ctd: day.ctd || false,
          block_reason: day.status === 'booked' ? 'reservation' : (day.status === 'unavailable' ? 'blocked' : null),
          synced_from_guesty_at: syncedAt,
        });
      }
    }

    console.log(`Processing ${calendarRecords.length} calendar days...`);

    // Upsert in batches of 100
    const batchSize = 100;
    let upsertedCount = 0;
    
    for (let i = 0; i < calendarRecords.length; i += batchSize) {
      const batch = calendarRecords.slice(i, i + batchSize);
      
      const { error: upsertError } = await supabase
        .from('capacity_calendar')
        .upsert(batch, { 
          onConflict: 'listing_id,date',
          ignoreDuplicates: false 
        });
      
      if (upsertError) {
        console.error('Upsert error:', upsertError);
        throw upsertError;
      }
      
      upsertedCount += batch.length;
      console.log(`Upserted ${upsertedCount}/${calendarRecords.length} calendar days`);
      
      // Small delay between batches for rate limiting
      if (i + batchSize < calendarRecords.length) {
        await sleep(100);
      }
    }

    console.log(`Calendar sync complete. ${upsertedCount} days updated.`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Synced ${upsertedCount} calendar days`,
        daysUpdated: upsertedCount,
        dateRange: { start: startDateStr, end: endDateStr }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Calendar sync error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to sync calendar';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

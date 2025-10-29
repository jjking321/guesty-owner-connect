import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RETRIES = 5;
const MAX_WAIT_TIME = 45000; // 45 seconds to prevent edge function timeout

interface GuestyOwner {
  _id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  listings?: string[];
}

async function getGuestyAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Token fetch attempt ${attempt}/${MAX_RETRIES}`);
      
      const tokenResponse = await fetch('https://open-api.guesty.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'open-api',
        }),
      });

      if (tokenResponse.status === 429) {
        const retryAfter = tokenResponse.headers.get('retry-after');
        let waitTime = 0;
        
        if (retryAfter) {
          // Check if it's a number (seconds) or a date
          if (/^\d+$/.test(retryAfter)) {
            waitTime = parseInt(retryAfter) * 1000;
          } else {
            const retryDate = new Date(retryAfter);
            waitTime = retryDate.getTime() - Date.now();
          }
        } else {
          // Exponential backoff: 2s, 4s, 8s, 16s, 30s
          waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        }

        if (waitTime > MAX_WAIT_TIME) {
          throw new Error(`Rate limit wait time (${waitTime}ms) exceeds maximum allowed time. Please try again later.`);
        }

        console.log(`Rate limited on token request. Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (!tokenResponse.ok) {
        throw new Error(`Failed to get access token: ${tokenResponse.statusText}`);
      }

      const { access_token } = await tokenResponse.json();
      console.log('Successfully obtained access token');
      return access_token;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      console.log(`Error on attempt ${attempt}, retrying...`, error);
    }
  }
  
  throw new Error('Failed to get access token after all retries');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { accountId } = await req.json();
    console.log(`Starting owner sync for account ${accountId}`);

    // Get Guesty account credentials
    const { data: account, error: accountError } = await supabase
      .from('guesty_accounts')
      .select('client_id, client_secret')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      throw new Error('Guesty account not found');
    }

    // Exchange credentials for access token with retry logic
    console.log('Exchanging client credentials for access token...');
    const access_token = await getGuestyAccessToken(
      account.client_id,
      account.client_secret
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
          const retryAfter = ownersResponse.headers.get('retry-after');
          let waitTime = 0;
          
          if (retryAfter) {
            if (/^\d+$/.test(retryAfter)) {
              waitTime = parseInt(retryAfter) * 1000;
            } else {
              const retryDate = new Date(retryAfter);
              waitTime = retryDate.getTime() - Date.now();
            }
          } else {
            waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
          }

          if (waitTime > MAX_WAIT_TIME) {
            throw new Error(`Rate limit wait time (${waitTime}ms) exceeds maximum allowed time. Please try again later.`);
          }

          console.log(`Rate limited on owners request. Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (!ownersResponse.ok) {
          throw new Error(`Failed to fetch owners: ${ownersResponse.statusText}`);
        }

        break;
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          throw error;
        }
        console.log(`Error fetching owners on attempt ${attempt}, retrying...`, error);
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
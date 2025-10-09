import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GuestyOwner {
  _id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  listings?: string[];
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

    // Exchange credentials for access token
    console.log('Exchanging client credentials for access token...');
    const tokenResponse = await fetch('https://open-api.guesty.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: account.client_id,
        client_secret: account.client_secret,
        scope: 'open-api',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Failed to get access token: ${tokenResponse.statusText}`);
    }

    const { access_token } = await tokenResponse.json();
    console.log('Successfully obtained access token');

    // Fetch owners from Guesty
    console.log('Fetching owners from Guesty...');
    const ownersResponse = await fetch('https://open-api.guesty.com/v1/owners', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!ownersResponse.ok) {
      throw new Error(`Failed to fetch owners: ${ownersResponse.statusText}`);
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
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const airroiApiKey = Deno.env.get('AIRROI_API_KEY');

    if (!airroiApiKey) {
      throw new Error('AIRROI_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { template_id, listing_id } = await req.json();

    if (!template_id || !listing_id) {
      throw new Error('template_id and listing_id are required');
    }

    console.log(`Applying template ${template_id} to listing ${listing_id}`);

    // Fetch the template
    const { data: template, error: templateError } = await supabase
      .from('compset_templates')
      .select('*')
      .eq('id', template_id)
      .single();

    if (templateError) throw templateError;
    if (!template) throw new Error('Template not found');

    const airroiListingIds = template.airroi_listing_ids as string[];
    console.log(`Template has ${airroiListingIds.length} comparable(s)`);

    if (airroiListingIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, applied: 0, message: 'Template has no comparables' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch each listing from Air ROI API
    const AIRROI_API_URL = 'https://api.airroi.com/v1/listings';
    const appliedComparables = [];

    for (const airroiId of airroiListingIds) {
      try {
        console.log(`Fetching listing ${airroiId} from Air ROI`);
        
        const response = await fetch(`${AIRROI_API_URL}/${airroiId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${airroiApiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          console.error(`Failed to fetch listing ${airroiId}: ${response.status}`);
          continue;
        }

        const listingData = await response.json();
        console.log(`Successfully fetched listing ${airroiId}`);

        // Map the response to our database schema
        const comparable = {
          listing_id: listing_id,
          airroi_listing_id: String(airroiId),
          listing_name: listingData.listing_name || null,
          listing_type: listingData.listing_type || null,
          room_type: listingData.room_type || null,
          cover_photo_url: listingData.cover_photo_url || null,
          host_name: listingData.host_name || null,
          superhost: listingData.superhost || false,
          location_info: listingData.location || null,
          property_details: {
            guests: listingData.guests,
            bedrooms: listingData.bedrooms,
            beds: listingData.beds,
            baths: listingData.baths,
            amenities: listingData.amenities || [],
          },
          pricing_info: {
            currency: listingData.currency,
            cleaning_fee: listingData.cleaning_fee,
            extra_guest_fee: listingData.extra_guest_fee,
          },
          ratings: {
            num_reviews: listingData.num_reviews,
            rating_overall: listingData.rating_overall,
            rating_accuracy: listingData.rating_accuracy,
            rating_checkin: listingData.rating_checkin,
            rating_cleanliness: listingData.rating_cleanliness,
            rating_communication: listingData.rating_communication,
            rating_location: listingData.rating_location,
            rating_value: listingData.rating_value,
          },
          booking_settings: {
            min_nights: listingData.min_nights,
            max_nights: listingData.max_nights,
            instant_book: listingData.instant_book,
          },
          performance_metrics: {
            ttm_revenue: listingData.ttm_revenue,
            ttm_occupancy: listingData.ttm_occupancy,
            ttm_adr: listingData.ttm_adr,
            ttm_revpar: listingData.ttm_revpar,
            ttm_days_available: listingData.ttm_days_available,
            ttm_days_reserved: listingData.ttm_days_reserved,
            ttm_days_blocked: listingData.ttm_days_blocked,
          },
          is_selected: true,
          selected_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
        };

        appliedComparables.push(comparable);
      } catch (err) {
        console.error(`Error fetching listing ${airroiId}:`, err);
      }

      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`Prepared ${appliedComparables.length} comparables for upsert`);

    // Upsert the comparables
    if (appliedComparables.length > 0) {
      const { error: upsertError } = await supabase
        .from('property_comparables')
        .upsert(appliedComparables, {
          onConflict: 'listing_id,airroi_listing_id',
        });

      if (upsertError) throw upsertError;
    }

    console.log(`Successfully applied ${appliedComparables.length} comparables`);

    return new Response(
      JSON.stringify({
        success: true,
        applied: appliedComparables.length,
        total: airroiListingIds.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error applying template:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

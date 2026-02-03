import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ScrapeResult {
  rating: number | null;
  reviewCount: number | null;
  error?: string;
}

/**
 * Extract rating data from Airbnb page HTML using multiple strategies
 */
function extractRatingFromHtml(html: string): ScrapeResult {
  // Strategy 1: Look for overallRating in embedded JSON state
  const overallRatingMatch = html.match(/"overallRating"\s*:\s*(\d+\.?\d*)/);
  const reviewCountMatch = html.match(/"reviewCount"\s*:\s*(\d+)/);

  if (overallRatingMatch && reviewCountMatch) {
    return {
      rating: parseFloat(overallRatingMatch[1]),
      reviewCount: parseInt(reviewCountMatch[1], 10),
    };
  }

  // Strategy 2: Look for rating patterns in different formats
  const ratingPatterns = [
    /"rating"\s*:\s*(\d+\.?\d*)/,
    /"starRating"\s*:\s*(\d+\.?\d*)/,
    /"guestSatisfactionOverall"\s*:\s*(\d+\.?\d*)/,
  ];

  const countPatterns = [
    /"reviewCount"\s*:\s*(\d+)/,
    /"numberOfReviews"\s*:\s*(\d+)/,
    /"reviewsCount"\s*:\s*(\d+)/,
  ];

  let rating: number | null = null;
  let reviewCount: number | null = null;

  for (const pattern of ratingPatterns) {
    const match = html.match(pattern);
    if (match) {
      rating = parseFloat(match[1]);
      break;
    }
  }

  for (const pattern of countPatterns) {
    const match = html.match(pattern);
    if (match) {
      reviewCount = parseInt(match[1], 10);
      break;
    }
  }

  if (rating !== null && reviewCount !== null) {
    return { rating, reviewCount };
  }

  // Strategy 3: Look for JSON-LD structured data
  const jsonLdMatch = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  );
  if (jsonLdMatch) {
    for (const script of jsonLdMatch) {
      try {
        const jsonContent = script
          .replace(/<script type="application\/ld\+json">/, "")
          .replace(/<\/script>/, "");
        const data = JSON.parse(jsonContent);

        if (data.aggregateRating) {
          return {
            rating: parseFloat(data.aggregateRating.ratingValue),
            reviewCount: parseInt(data.aggregateRating.reviewCount, 10),
          };
        }
      } catch {
        // Continue to next script tag
      }
    }
  }

  // Strategy 4: Look for meta tags
  const metaRatingMatch = html.match(
    /content="(\d+\.?\d*)\s*out of 5(?:.*?(\d+)\s*reviews)?"/i
  );
  if (metaRatingMatch) {
    return {
      rating: parseFloat(metaRatingMatch[1]),
      reviewCount: metaRatingMatch[2] ? parseInt(metaRatingMatch[2], 10) : null,
    };
  }

  // Strategy 5: Look for aria-label patterns
  const ariaMatch = html.match(
    /aria-label="[^"]*?(\d+\.?\d*)\s*(?:out of 5|stars?)[^"]*?(\d+)\s*reviews?/i
  );
  if (ariaMatch) {
    return {
      rating: parseFloat(ariaMatch[1]),
      reviewCount: parseInt(ariaMatch[2], 10),
    };
  }

  return {
    rating: null,
    reviewCount: null,
    error: "Could not extract rating data from page",
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { listingId } = await req.json();

    if (!listingId) {
      return new Response(
        JSON.stringify({ error: "listingId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the listing to find the Airbnb listing ID
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("airbnb_listing_id")
      .eq("id", listingId)
      .single();

    if (listingError) {
      return new Response(
        JSON.stringify({ error: `Failed to find listing: ${listingError.message}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!listing.airbnb_listing_id) {
      // Update the listing with error
      await supabase
        .from("listings")
        .update({
          live_rating_scrape_error: "No Airbnb listing ID found",
          live_rating_scraped_at: new Date().toISOString(),
        })
        .eq("id", listingId);

      return new Response(
        JSON.stringify({ error: "No Airbnb listing ID found for this property" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Construct the Airbnb URL
    const airbnbUrl = `https://www.airbnb.com/rooms/${listing.airbnb_listing_id}`;

    console.log(`Fetching Airbnb page: ${airbnbUrl}`);

    // Fetch the Airbnb page with browser-like headers
    const response = await fetch(airbnbUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (!response.ok) {
      const errorMsg = `Failed to fetch Airbnb page: ${response.status} ${response.statusText}`;
      console.error(errorMsg);

      await supabase
        .from("listings")
        .update({
          live_rating_scrape_error: errorMsg,
          live_rating_scraped_at: new Date().toISOString(),
        })
        .eq("id", listingId);

      return new Response(
        JSON.stringify({ error: errorMsg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const html = await response.text();
    console.log(`Received HTML of length: ${html.length}`);

    // Extract rating data
    const result = extractRatingFromHtml(html);

    if (result.error || result.rating === null) {
      const errorMsg = result.error || "Failed to extract rating from page";
      console.error(errorMsg);

      await supabase
        .from("listings")
        .update({
          live_rating_scrape_error: errorMsg,
          live_rating_scraped_at: new Date().toISOString(),
        })
        .eq("id", listingId);

      return new Response(
        JSON.stringify({ 
          error: errorMsg,
          success: false,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Extracted rating: ${result.rating}, count: ${result.reviewCount}`);

    // Update the listing with the scraped data
    const { error: updateError } = await supabase
      .from("listings")
      .update({
        live_airbnb_rating: result.rating,
        live_airbnb_review_count: result.reviewCount,
        live_rating_scraped_at: new Date().toISOString(),
        live_rating_scrape_error: null,
      })
      .eq("id", listingId);

    if (updateError) {
      console.error(`Failed to update listing: ${updateError.message}`);
      return new Response(
        JSON.stringify({ error: `Failed to update listing: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        rating: result.rating,
        reviewCount: result.reviewCount,
        scrapedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: `Unexpected error: ${errorMessage}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

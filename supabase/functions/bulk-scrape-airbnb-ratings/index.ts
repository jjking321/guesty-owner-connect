import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Constants for batch processing
const BATCH_SIZE = 15; // Process 15 listings per invocation (~45s with 3s delay)
const DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds between requests
const SKIP_IF_SCRAPED_WITHIN_HOURS = 24;

interface ScrapeResult {
  rating: number | null;
  reviewCount: number | null;
  error?: string;
}

/**
 * Extract rating data from Airbnb page HTML using multiple strategies
 * (Reused from scrape-airbnb-rating function)
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

/**
 * Fetch Airbnb page with browser-like headers
 */
async function fetchAirbnbPage(airbnbListingId: string): Promise<{ html: string | null; error: string | null }> {
  const airbnbUrl = `https://www.airbnb.com/rooms/${airbnbListingId}`;
  
  try {
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
      return { html: null, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();
    return { html, error: null };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { html: null, error: errorMessage };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check for service-role bypass (for automated nightly sync)
    const isServiceRole = req.headers.get("x-service-role") === "true";
    const authHeader = req.headers.get("Authorization");

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let organizationId: string;
    let guestyAccountId: string;
    let guestyAccounts: { id: string }[];

    if (isServiceRole) {
      // Service-role auth: get organization from first active guesty account
      console.log("Using service-role authentication for automated run");
      
      const { data: account, error: accountError } = await supabaseAdmin
        .from("guesty_accounts")
        .select("organization_id, id")
        .eq("automated_sync_enabled", true)
        .limit(1)
        .maybeSingle();

      if (accountError || !account) {
        console.error("No account with automation enabled:", accountError);
        return new Response(
          JSON.stringify({ error: "No account with automation enabled" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      organizationId = account.organization_id;
      guestyAccountId = account.id;

      // Get all guesty accounts for this organization
      const { data: allAccounts, error: allAccountsError } = await supabaseAdmin
        .from("guesty_accounts")
        .select("id")
        .eq("organization_id", organizationId);

      if (allAccountsError || !allAccounts || allAccounts.length === 0) {
        return new Response(
          JSON.stringify({ error: "No Guesty accounts found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      guestyAccounts = allAccounts;
    } else {
      // Standard user auth
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authorization header required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });

      // Verify user and get organization
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get user's organization
      const { data: membership, error: membershipError } = await supabaseAuth
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      if (membershipError || !membership) {
        return new Response(
          JSON.stringify({ error: "No organization found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      organizationId = membership.organization_id;

      // Get guesty accounts for this organization
      const { data: accounts, error: accountsError } = await supabaseAdmin
        .from("guesty_accounts")
        .select("id")
        .eq("organization_id", organizationId)
        .limit(1);

      if (accountsError || !accounts || accounts.length === 0) {
        return new Response(
          JSON.stringify({ error: "No Guesty account found for organization" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      guestyAccountId = accounts[0].id;
      guestyAccounts = accounts;
    }

    // Check for existing running job or create new one
    let jobId: string;
    let startOffset = 0;

    const { data: existingJob } = await supabaseAdmin
      .from("sync_jobs")
      .select("*")
      .eq("guesty_account_id", guestyAccountId)
      .eq("sync_type", "airbnb_ratings")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingJob) {
      // Resume from existing job
      jobId = existingJob.id;
      startOffset = existingJob.last_synced_offset || 0;
      console.log(`Resuming existing job ${jobId} from offset ${startOffset}`);
    } else {
      // Create new sync job
      const { data: newJob, error: jobError } = await supabaseAdmin
        .from("sync_jobs")
        .insert({
          guesty_account_id: guestyAccountId,
          sync_type: "airbnb_ratings",
          status: "running",
          progress_message: "Starting Airbnb ratings scrape...",
          items_synced: 0,
          last_synced_offset: 0,
        })
        .select()
        .single();

      if (jobError || !newJob) {
        throw new Error(`Failed to create sync job: ${jobError?.message}`);
      }

      jobId = newJob.id;
      console.log(`Created new job ${jobId}`);
    }

    // Query all listings with airbnb_listing_id for this organization
    // Skip those scraped within the last 24 hours
    const skipIfScrapedAfter = new Date(Date.now() - SKIP_IF_SCRAPED_WITHIN_HOURS * 60 * 60 * 1000).toISOString();

    const { data: listings, error: listingsError } = await supabaseAdmin
      .from("listings")
      .select("id, nickname, airbnb_listing_id, live_rating_scraped_at")
      .in("guesty_account_id", guestyAccounts.map(a => a.id))
      .not("airbnb_listing_id", "is", null)
      .eq("archived", false)
      .eq("is_listed", true)
      .order("id");

    if (listingsError) {
      throw new Error(`Failed to fetch listings: ${listingsError.message}`);
    }

    // Filter out recently scraped listings
    const listingsToScrape = (listings || []).filter(l => {
      if (!l.live_rating_scraped_at) return true;
      return new Date(l.live_rating_scraped_at) < new Date(skipIfScrapedAfter);
    });

    const totalListings = listingsToScrape.length;
    console.log(`Found ${totalListings} listings to scrape (after filtering recently scraped)`);

    // Update job with total count
    await supabaseAdmin
      .from("sync_jobs")
      .update({
        total_items: totalListings,
        progress_message: `Found ${totalListings} listings to scrape`,
      })
      .eq("id", jobId);

    if (totalListings === 0) {
      await supabaseAdmin
        .from("sync_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          progress_message: "All listings already scraped within the last 24 hours",
        })
        .eq("id", jobId);

      return new Response(
        JSON.stringify({ success: true, message: "No listings to scrape" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    // Process listings starting from offset
    for (let i = startOffset; i < totalListings; i++) {
      // Check if job was cancelled
      const { data: currentJob } = await supabaseAdmin
        .from("sync_jobs")
        .select("status")
        .eq("id", jobId)
        .single();

      if (currentJob?.status === "failed") {
        console.log("Job was cancelled, stopping");
        return new Response(
          JSON.stringify({ success: false, message: "Job cancelled" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const listing = listingsToScrape[i];
      const listingName = listing.nickname || listing.id;

      console.log(`Processing ${i + 1}/${totalListings}: ${listingName}`);

      // Update progress
      await supabaseAdmin
        .from("sync_jobs")
        .update({
          items_synced: i,
          last_synced_offset: i,
          progress_message: `Processing: ${listingName}`,
        })
        .eq("id", jobId);

      // Fetch and scrape
      const { html, error: fetchError } = await fetchAirbnbPage(listing.airbnb_listing_id);

      if (fetchError || !html) {
        console.error(`Failed to fetch ${listingName}: ${fetchError}`);
        await supabaseAdmin
          .from("listings")
          .update({
            live_rating_scrape_error: fetchError || "Failed to fetch page",
            live_rating_scraped_at: new Date().toISOString(),
          })
          .eq("id", listing.id);
        failed++;
      } else {
        const result = extractRatingFromHtml(html);
        
        if (result.error || result.rating === null) {
          console.error(`Failed to extract rating for ${listingName}: ${result.error}`);
          await supabaseAdmin
            .from("listings")
            .update({
              live_rating_scrape_error: result.error || "Failed to extract rating",
              live_rating_scraped_at: new Date().toISOString(),
            })
            .eq("id", listing.id);
          failed++;
        } else {
          console.log(`Extracted rating ${result.rating} (${result.reviewCount} reviews) for ${listingName}`);
          await supabaseAdmin
            .from("listings")
            .update({
              live_airbnb_rating: result.rating,
              live_airbnb_review_count: result.reviewCount,
              live_rating_scraped_at: new Date().toISOString(),
              live_rating_scrape_error: null,
            })
            .eq("id", listing.id);
          succeeded++;
        }
      }

      processed++;

      // Check if we've processed enough for this batch (leave buffer before 60s timeout)
      if (processed >= BATCH_SIZE && i < totalListings - 1) {
        const nextOffset = i + 1;
        console.log(`Batch complete. Processed ${processed}. Self-invoking from offset ${nextOffset}`);

        // Update job with current progress
        await supabaseAdmin
          .from("sync_jobs")
          .update({
            items_synced: nextOffset,
            last_synced_offset: nextOffset,
            progress_message: `Processed ${nextOffset}/${totalListings}. Continuing...`,
          })
          .eq("id", jobId);

        // Self-invoke to continue - use appropriate auth header
        const selfInvokeHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        
        if (isServiceRole) {
          selfInvokeHeaders["x-service-role"] = "true";
        } else if (authHeader) {
          selfInvokeHeaders["Authorization"] = authHeader;
        }

        try {
          const invokeResponse = await fetch(
            `${supabaseUrl}/functions/v1/bulk-scrape-airbnb-ratings`,
            {
              method: "POST",
              headers: selfInvokeHeaders,
              body: JSON.stringify({}),
            }
          );

          if (!invokeResponse.ok) {
            console.error(`Self-invocation failed: ${invokeResponse.status}`);
          }
        } catch (invokeError) {
          console.error("Self-invocation error:", invokeError);
        }

        // Return immediately to hand off to next invocation
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: `Batch complete. Processed ${processed}. Continuing in next invocation.`,
            processed,
            succeeded,
            failed,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Delay between requests to avoid rate limiting
      if (i < totalListings - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
      }
    }

    // All done - mark job complete
    const finalStatus = failed > 0 ? "completed_with_errors" : "completed";
    await supabaseAdmin
      .from("sync_jobs")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        items_synced: totalListings,
        progress_message: `Completed: ${succeeded} succeeded, ${failed} failed`,
      })
      .eq("id", jobId);

    console.log(`Scraping complete: ${succeeded} succeeded, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Scraping complete",
        total: totalListings,
        succeeded,
        failed,
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

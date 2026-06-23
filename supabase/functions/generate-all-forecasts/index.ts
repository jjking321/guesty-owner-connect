import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth: accept service-role bearer (internal invocations) or a valid user JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isServiceRole = bearer.length > 0 && bearer === supabaseKey;

    let userId: string | undefined;
    if (!isServiceRole) {
      if (!bearer) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
      if (userError || !userData?.user?.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      userId = userData.user.id;
    }

    console.log('Starting background forecast generation for all properties...');

    // Get all active listings (exclude archived, only listed properties)
    const { data: listings, error: listingsError } = await supabase
      .from('listings')
      .select('id, nickname')
      .eq('is_listed', true)
      .eq('archived', false);

    if (listingsError) throw listingsError;

    const totalProperties = listings?.length || 0;
    const totalForecasts = totalProperties * 2;
    console.log(`Found ${totalProperties} active properties - processing in background`);

    // Create progress tracking record
    const { data: progressRecord, error: progressError } = await supabase
      .from('forecast_generation_progress')
      .insert({
        total_forecasts: totalForecasts,
        completed_forecasts: 0,
        failed_forecasts: 0,
        status: 'running',
        created_by: userId
      })
      .select()
      .single();

    if (progressError) {
      console.error('Error creating progress record:', progressError);
    }

    const progressId = progressRecord?.id;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Detect Supabase Functions rate-limit errors and extract retryAfterMs.
    const getRateLimitWaitMs = (err: any): number | null => {
      if (!err) return null;
      const ctx = err.context ?? err.cause ?? err;
      const name = ctx?.name || err?.name;
      const retryAfterMs = ctx?.retryAfterMs ?? err?.retryAfterMs;
      if (name === 'RateLimitError' || typeof retryAfterMs === 'number') {
        return Math.min(Math.max(retryAfterMs ?? 2000, 500), 30000);
      }
      const msg = String(err?.message ?? '');
      if (/rate limit/i.test(msg)) return 5000;
      return null;
    };

    type ForecastOutcome = 'success' | 'rate_limited' | 'error';

    const invokeForecast = async (
      listing: { id: string; nickname: string | null },
      year: number,
    ): Promise<ForecastOutcome> => {
      const MAX_ATTEMPTS = 5;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const { data, error } = await supabase.functions.invoke('forecast-revenue', {
            body: { listingId: listing.id, year, simulations: 10000 },
          });
          if (error) {
            const waitMs = getRateLimitWaitMs(error);
            if (waitMs != null && attempt < MAX_ATTEMPTS) {
              const jitter = Math.floor(Math.random() * 500);
              console.warn(`⏳ rate-limited ${year} ${listing.nickname} attempt ${attempt}, waiting ${waitMs + jitter}ms`);
              await sleep(waitMs + jitter);
              continue;
            }
            if (waitMs != null) {
              console.error(`✗ rate-limited (gave up) ${year} ${listing.nickname}`);
              return 'rate_limited';
            }
            console.error(`✗ ${year} for ${listing.nickname}:`, error);
            return 'error';
          }
          console.log(`✓ ${year} ${listing.nickname}: $${data?.totalForecast?.p50?.toFixed(0) || 0}`);
          return 'success';
        } catch (err: any) {
          const waitMs = getRateLimitWaitMs(err);
          if (waitMs != null && attempt < MAX_ATTEMPTS) {
            const jitter = Math.floor(Math.random() * 500);
            console.warn(`⏳ rate-limited (thrown) ${year} ${listing.nickname} attempt ${attempt}, waiting ${waitMs + jitter}ms`);
            await sleep(waitMs + jitter);
            continue;
          }
          if (waitMs != null) return 'rate_limited';
          console.error(`✗ thrown ${year} for ${listing.nickname}:`, err);
          return 'error';
        }
      }
      return 'rate_limited';
    };

    // Start background task
    const backgroundTask = async () => {
      const currentYear = new Date().getFullYear();
      const nextYear = currentYear + 1;
      // Throttle: small concurrency + inter-call spacing keeps us under the
      // Supabase per-function invocation rate limit even on large accounts.
      const CONCURRENCY = 5;
      const INTER_CALL_DELAY_MS = 200;
      let successCount = 0;
      let rateLimitedCount = 0;
      let errorCount = 0;

      const jobs: { listing: { id: string; nickname: string | null }; year: number }[] = [];
      for (const l of listings || []) {
        jobs.push({ listing: l, year: currentYear });
        jobs.push({ listing: l, year: nextYear });
      }

      let nextIndex = 0;
      const worker = async () => {
        while (true) {
          const idx = nextIndex++;
          if (idx >= jobs.length) return;
          const job = jobs[idx];
          const outcome = await invokeForecast(job.listing, job.year);
          if (outcome === 'success') successCount++;
          else if (outcome === 'rate_limited') rateLimitedCount++;
          else errorCount++;

          if (progressId && idx % 10 === 0) {
            await supabase
              .from('forecast_generation_progress')
              .update({
                completed_forecasts: successCount,
                failed_forecasts: rateLimitedCount + errorCount,
              })
              .eq('id', progressId);
          }
          await sleep(INTER_CALL_DELAY_MS);
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

      console.log(
        `Forecast generation complete: ${successCount} success, ${rateLimitedCount} rate-limited, ${errorCount} errors (of ${jobs.length})`,
      );

      if (progressId) {
        await supabase
          .from('forecast_generation_progress')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            completed_forecasts: successCount,
            failed_forecasts: rateLimitedCount + errorCount,
          })
          .eq('id', progressId);
      }
    };

    // Run in background using EdgeRuntime.waitUntil
    // @ts-ignore - EdgeRuntime is available in Deno edge runtime
    EdgeRuntime.waitUntil(backgroundTask());

    // Return immediate response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Forecast generation started in background',
        progress_id: progressId,
        total_properties: totalProperties,
        total_forecasts: totalForecasts,
        estimated_duration_minutes: Math.ceil(totalProperties / 10 * 2)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in generate-all-forecasts:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

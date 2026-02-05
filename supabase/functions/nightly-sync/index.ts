import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
}

interface AccountSyncResult {
  account: string;
  accountId: string;
  syncs: {
    listings?: SyncResult;
    reservations?: SyncResult;
    owners?: SyncResult;
    calendar?: SyncResult;
  };
  error?: string;
  lastAutomatedSyncUpdated: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForProgressCompletion(
  supabase: any,
  progressId: string,
  label: string,
  timeoutMs: number = 1800000 // 30 minute default
): Promise<SyncResult> {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  console.log(`[${label}] Waiting for completion (timeout: ${timeoutMs / 1000}s)...`);

  while (Date.now() - startTime < timeoutMs) {
    const { data: progress, error } = await supabase
      .from('forecast_generation_progress')
      .select('status, completed_forecasts, failed_forecasts, total_forecasts')
      .eq('id', progressId)
      .single();

    if (error) {
      console.error(`[${label}] Error polling progress:`, error);
      await sleep(pollInterval);
      continue;
    }

    if (progress?.status === 'completed') {
      console.log(`[${label}] Completed: ${progress.completed_forecasts} success, ${progress.failed_forecasts} failed`);
      return { success: true };
    }

    if (progress?.status === 'failed') {
      return { success: false, error: `${label} failed` };
    }

    console.log(`[${label}] Progress: ${progress?.completed_forecasts || 0}/${progress?.total_forecasts || 0}`);
    await sleep(pollInterval);
  }

  return { success: false, error: `${label} timed out` };
}

async function waitForSyncCompletion(
  supabase: any,
  accountId: string,
  syncType: string,
  timeoutMs: number = 600000 // 10 minute default timeout
): Promise<SyncResult> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  let lastJobId: string | null = null;

  console.log(`[${syncType}] Waiting for sync completion (timeout: ${timeoutMs / 1000}s)...`);

  // First, wait a moment for the job to be created
  await sleep(2000);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { data: jobs, error } = await supabase
        .from('sync_jobs')
        .select('id, status, error_message, progress_message, items_synced')
        .eq('guesty_account_id', accountId)
        .eq('sync_type', syncType)
        .order('started_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error(`[${syncType}] Error polling sync_jobs:`, error);
        await sleep(pollInterval);
        continue;
      }

      if (jobs && jobs.length > 0) {
        const job = jobs[0];
        
        // Track if this is a new job
        if (lastJobId === null) {
          lastJobId = job.id;
        } else if (job.id !== lastJobId) {
          // A new job was created, reset tracking
          lastJobId = job.id;
        }

        if (job.status === 'completed') {
          console.log(`[${syncType}] Sync completed successfully. Items synced: ${job.items_synced || 'N/A'}`);
          return { success: true };
        }

        if (job.status === 'failed') {
          console.error(`[${syncType}] Sync failed: ${job.error_message}`);
          return { success: false, error: job.error_message || 'Sync failed' };
        }

        // Still running
        console.log(`[${syncType}] Still running... ${job.progress_message || ''} (${job.items_synced || 0} items)`);
      } else {
        console.log(`[${syncType}] No sync job found yet, waiting...`);
      }

      await sleep(pollInterval);
    } catch (pollError: any) {
      console.error(`[${syncType}] Poll error:`, pollError.message);
      await sleep(pollInterval);
    }
  }

  console.error(`[${syncType}] Sync timed out after ${timeoutMs / 1000}s`);
  return { success: false, error: `Sync timed out after ${timeoutMs / 1000} seconds` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('=== Nightly Sync Started ===');
  console.log(`Start time: ${new Date().toISOString()}`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Use a dedicated invoker client for service-role/batch calls.
    // IMPORTANT: passing `headers` to functions.invoke can override defaults (apikey/authorization).
    const supabaseInvoke = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { 'x-service-role': 'true' } } }
    );

    // Get all accounts with automated sync enabled
    const { data: accounts, error: accountsError } = await supabase
      .from('guesty_accounts')
      .select('id, account_name, airbnb_scrape_enabled, forecast_generation_enabled, probability_calculation_enabled, actionables_generation_enabled')
      .eq('automated_sync_enabled', true);

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError);
      throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.log('No accounts with automated sync enabled');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No accounts with automated sync enabled',
          results: [] 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${accounts.length} account(s) with automated sync enabled`);

    const results: AccountSyncResult[] = [];

    for (const account of accounts) {
      console.log(`\n--- Processing account: ${account.account_name} (${account.id}) ---`);
      
      const accountResult: AccountSyncResult = {
        account: account.account_name,
        accountId: account.id,
        syncs: {},
        lastAutomatedSyncUpdated: false,
      };

      try {
        // 1. Sync Properties (listings)
        console.log(`[${account.account_name}] Starting listings sync...`);
        const { error: listingsInvokeError } = await supabase.functions.invoke('sync-guesty-data', {
          body: { accountId: account.id, syncType: 'listings' }
        });

        if (listingsInvokeError) {
          console.error(`[${account.account_name}] Failed to invoke listings sync:`, listingsInvokeError);
          accountResult.syncs.listings = { success: false, error: listingsInvokeError.message };
        } else {
          accountResult.syncs.listings = await waitForSyncCompletion(
            supabase, 
            account.id, 
            'listings',
            600000 // 10 min timeout
          );
        }

        // 2. Sync Reservations (incremental - new reservations)
        console.log(`[${account.account_name}] Starting new reservations sync...`);
        const { error: reservationsInvokeError } = await supabase.functions.invoke('sync-new-reservations', {
          body: { accountId: account.id }
        });

        if (reservationsInvokeError) {
          console.error(`[${account.account_name}] Failed to invoke reservations sync:`, reservationsInvokeError);
          accountResult.syncs.reservations = { success: false, error: reservationsInvokeError.message };
        } else {
          accountResult.syncs.reservations = await waitForSyncCompletion(
            supabase,
            account.id,
            'new_reservations',
            600000 // 10 min timeout
          );
        }

        // 3. Sync Owners
        console.log(`[${account.account_name}] Starting owners sync...`);
        const { error: ownersInvokeError } = await supabase.functions.invoke('sync-owners', {
          body: { accountId: account.id }
        });

        if (ownersInvokeError) {
          console.error(`[${account.account_name}] Failed to invoke owners sync:`, ownersInvokeError);
          accountResult.syncs.owners = { success: false, error: ownersInvokeError.message };
        } else {
          // Owners sync doesn't use sync_jobs table, it returns directly
          // Wait a short time to let it complete
          await sleep(10000); // 10 seconds should be plenty for owners
          accountResult.syncs.owners = { success: true };
          console.log(`[${account.account_name}] Owners sync completed`);
        }

        // 4. Sync Calendar (this is the longest one)
        console.log(`[${account.account_name}] Starting calendar sync...`);
        const { error: calendarInvokeError } = await supabaseInvoke.functions.invoke('sync-bulk-calendar', {
          body: { guestyAccountId: account.id }
        });

        if (calendarInvokeError) {
          console.error(`[${account.account_name}] Failed to invoke calendar sync:`, calendarInvokeError);
          accountResult.syncs.calendar = { success: false, error: calendarInvokeError.message };
        } else {
          accountResult.syncs.calendar = await waitForSyncCompletion(
            supabase,
            account.id,
            'capacity_calendar',
            900000 // 15 min timeout for calendar (it's the longest)
          );
        }

        // Update last_automated_sync timestamp
        const { error: updateError } = await supabase
          .from('guesty_accounts')
          .update({ last_automated_sync: new Date().toISOString() })
          .eq('id', account.id);

        if (updateError) {
          console.error(`[${account.account_name}] Failed to update last_automated_sync:`, updateError);
        } else {
          accountResult.lastAutomatedSyncUpdated = true;
          console.log(`[${account.account_name}] Updated last_automated_sync timestamp`);
        }

      } catch (accountError: any) {
        console.error(`[${account.account_name}] Error processing account:`, accountError);
        accountResult.error = accountError.message;
      }

      results.push(accountResult);

      // Wait between accounts to avoid any rate limit overlap
      if (accounts.indexOf(account) < accounts.length - 1) {
        console.log('Waiting 30 seconds before next account...');
        await sleep(30000);
      }
    }

    // 5. Scrape Airbnb Ratings (runs once for entire org, not per account)
    // Only run if at least one account has airbnb_scrape_enabled
    const airbnbScrapeEnabled = accounts.some(a => a.airbnb_scrape_enabled !== false);
    let airbnbScrapeResult: SyncResult | null = null;
    const firstAccountId = accounts[0]?.id;

    if (firstAccountId && airbnbScrapeEnabled) {
      console.log(`\n--- Scraping Airbnb Ratings ---`);
      const { error: airbnbInvokeError } = await supabaseInvoke.functions.invoke(
        'bulk-scrape-airbnb-ratings',
        {
          body: {},
        }
      );

      if (airbnbInvokeError) {
        console.error('Failed to invoke Airbnb ratings scrape:', airbnbInvokeError);
        airbnbScrapeResult = { success: false, error: airbnbInvokeError.message };
      } else {
        // Poll for completion with 20 min timeout (225 listings * 3s = ~11 min)
        airbnbScrapeResult = await waitForSyncCompletion(
          supabase,
          firstAccountId,
          'airbnb_ratings',
          1200000 // 20 minutes
        );
      }
    } else if (!airbnbScrapeEnabled) {
      console.log(`\n--- Skipping Airbnb Ratings (disabled) ---`);
      airbnbScrapeResult = { success: true, skipped: true };
    }

    // 6. Calculate All Booking Probabilities (runs once for entire org)
    // Only run if at least one account has probability_calculation_enabled
    const probabilityEnabled = accounts.some(a => a.probability_calculation_enabled !== false);
    let probabilityResult: SyncResult | null = null;

    if (probabilityEnabled) {
      console.log(`\n--- Calculating Booking Probabilities ---`);
      const { data: probResponse, error: probInvokeError } = await supabaseInvoke.functions.invoke(
        'calculate-all-probabilities',
        {
          body: {},
        }
      );

      if (probInvokeError) {
        console.error('Failed to invoke probability calculation:', probInvokeError);
        probabilityResult = { success: false, error: probInvokeError.message };
      } else if (probResponse?.progress_id) {
        // Poll for completion with 20 min timeout
        probabilityResult = await waitForProgressCompletion(
          supabase,
          probResponse.progress_id,
          'probabilities',
          1200000 // 20 minutes
        );
      }
    } else {
      console.log(`\n--- Skipping Probability Calculation (disabled) ---`);
      probabilityResult = { success: true, skipped: true };
    }

    // 7. Regenerate All Forecasts (runs once for entire org)
    // Only run if at least one account has forecast_generation_enabled
    const forecastEnabled = accounts.some(a => a.forecast_generation_enabled !== false);
    let forecastResult: SyncResult | null = null;

    if (forecastEnabled) {
      console.log(`\n--- Regenerating Forecasts ---`);
      const { data: forecastResponse, error: forecastInvokeError } = await supabaseInvoke.functions.invoke(
        'generate-all-forecasts',
        {
          body: {},
        }
      );

      if (forecastInvokeError) {
        console.error('Failed to invoke forecast generation:', forecastInvokeError);
        forecastResult = { success: false, error: forecastInvokeError.message };
      } else if (forecastResponse?.progress_id) {
        // Poll for completion with 30 min timeout
        forecastResult = await waitForProgressCompletion(
          supabase,
          forecastResponse.progress_id,
          'forecasts',
          1800000 // 30 minutes
        );
      }
    } else {
      console.log(`\n--- Skipping Forecast Regeneration (disabled) ---`);
      forecastResult = { success: true, skipped: true };
    }

    // 8. Generate Actionables
    const actionablesEnabled = accounts.some(a => a.actionables_generation_enabled !== false);
    let actionablesResult: SyncResult | null = null;

    if (actionablesEnabled) {
      console.log(`\n--- Generating Actionables ---`);
      const { error: actionablesInvokeError } = await supabaseInvoke.functions.invoke(
        'generate-actionables',
        {
          body: {},
        }
      );

      if (actionablesInvokeError) {
        console.error('Failed to invoke actionables generation:', actionablesInvokeError);
        actionablesResult = { success: false, error: actionablesInvokeError.message };
      } else {
        actionablesResult = { success: true };
        console.log('Actionables generation completed');
      }
    } else {
      console.log(`\n--- Skipping Actionables Generation (disabled) ---`);
      actionablesResult = { success: true, skipped: true };
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n=== Nightly Sync Completed ===`);
    console.log(`Total duration: ${duration} seconds`);
    console.log(`Accounts processed: ${results.length}`);
    if (airbnbScrapeResult) {
      console.log(`Airbnb ratings scrape: ${airbnbScrapeResult.success ? 'completed' : 'failed'}${airbnbScrapeResult.skipped ? ' (skipped)' : ''}`);
    }
    if (probabilityResult) {
      console.log(`Probability calculation: ${probabilityResult.success ? 'completed' : 'failed'}${probabilityResult.skipped ? ' (skipped)' : ''}`);
    }
    if (forecastResult) {
      console.log(`Forecast generation: ${forecastResult.success ? 'completed' : 'failed'}${forecastResult.skipped ? ' (skipped)' : ''}`);
    }
    if (actionablesResult) {
      console.log(`Actionables generation: ${actionablesResult.success ? 'completed' : 'failed'}${actionablesResult.skipped ? ' (skipped)' : ''}`);
    }

    // Summary
    const successfulAccounts = results.filter(r => !r.error).length;
    const failedAccounts = results.filter(r => r.error).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Nightly sync completed for ${successfulAccounts} account(s)`,
        duration: `${duration}s`,
        successfulAccounts,
        failedAccounts,
        results,
        airbnbRatingsScrape: airbnbScrapeResult,
        probabilityCalculation: probabilityResult,
        forecastGeneration: forecastResult,
        actionablesGeneration: actionablesResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Nightly sync error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        duration: `${Math.round((Date.now() - startTime) / 1000)}s`
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

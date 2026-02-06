import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Pipeline steps in order
type PipelineStep = 
  | 'INIT'
  | 'ACCOUNT_SYNCS'
  | 'AIRBNB_RATINGS'
  | 'PROBABILITIES'
  | 'FORECASTS'
  | 'ACTIONABLES'
  | 'COMPLETED';

// Per-account sync phases
type AccountSyncPhase = 'listings' | 'reservations' | 'owners' | 'calendar' | 'done';

interface AccountState {
  currentPhase: AccountSyncPhase;
  phasesCompleted: AccountSyncPhase[];
  error?: string;
}

interface NightlySyncRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  current_step: PipelineStep;
  status: 'running' | 'completed' | 'failed';
  account_ids: string[];
  account_states: Record<string, AccountState>;
  step_results: Record<string, any>;
  error_message: string | null;
  invocation_count: number;
}

interface Account {
  id: string;
  account_name: string;
  airbnb_scrape_enabled: boolean | null;
  forecast_generation_enabled: boolean | null;
  probability_calculation_enabled: boolean | null;
  actionables_generation_enabled: boolean | null;
}

const MAX_INVOCATIONS = 200;
const MAX_RUN_TIME_MS = 2 * 60 * 60 * 1000; // 2 hours
const SELF_INVOKE_DELAY_MS = 15000; // 15 seconds between self-invocations

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if a sync job is complete for an account/sync_type
async function isSyncComplete(
  supabase: any,
  accountId: string,
  syncType: string
): Promise<{ complete: boolean; success: boolean; error?: string }> {
  const { data: jobs, error } = await supabase
    .from('sync_jobs')
    .select('status, error_message')
    .eq('guesty_account_id', accountId)
    .eq('sync_type', syncType)
    .order('started_at', { ascending: false })
    .limit(1);

  if (error || !jobs || jobs.length === 0) {
    return { complete: false, success: false };
  }

  const job = jobs[0];
  if (job.status === 'completed') {
    return { complete: true, success: true };
  }
  if (job.status === 'failed') {
    return { complete: true, success: false, error: job.error_message };
  }
  return { complete: false, success: false };
}

// Check if a progress-based task is complete
async function isProgressComplete(
  supabase: any,
  progressId: string
): Promise<{ complete: boolean; success: boolean; error?: string }> {
  const { data: progress, error } = await supabase
    .from('forecast_generation_progress')
    .select('status, error_message')
    .eq('id', progressId)
    .single();

  if (error || !progress) {
    return { complete: false, success: false };
  }

  if (progress.status === 'completed') {
    return { complete: true, success: true };
  }
  if (progress.status === 'failed') {
    return { complete: true, success: false, error: progress.error_message };
  }
  return { complete: false, success: false };
}

// Get next sync phase for an account
function getNextPhase(currentPhase: AccountSyncPhase): AccountSyncPhase {
  const order: AccountSyncPhase[] = ['listings', 'reservations', 'owners', 'calendar', 'done'];
  const currentIndex = order.indexOf(currentPhase);
  return order[Math.min(currentIndex + 1, order.length - 1)];
}

// Map phase to sync_type used in sync_jobs table
function getSyncType(phase: AccountSyncPhase): string {
  switch (phase) {
    case 'listings': return 'listings';
    case 'reservations': return 'new_reservations';
    case 'owners': return 'owners';
    case 'calendar': return 'capacity_calendar';
    default: return phase;
  }
}

// Check if an error message indicates a rate limit issue
function isRateLimitError(message: string | null): boolean {
  if (!message) return false;
  const patterns = [
    'rate limit',
    'rate_limit',
    'RATE_LIMIT',
    '429',
    'too many requests',
    'OAUTH_RATE_LIMIT',
    'Retry-After',
    'exceeded rate',
  ];
  return patterns.some(p => message.toLowerCase().includes(p.toLowerCase()));
}

// Handle verification mode - check if previous run completed and retry if needed
async function handleVerification(
  supabase: any,
  supabaseInvoke: any
): Promise<Response> {
  console.log('=== Nightly Sync: VERIFICATION MODE ===');
  
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  
  // Find the most recent run from the last 3 hours
  const { data: recentRuns, error: fetchError } = await supabase
    .from('nightly_sync_runs')
    .select('*')
    .gte('started_at', threeHoursAgo)
    .order('started_at', { ascending: false })
    .limit(1);
    
  if (fetchError) {
    console.error('Failed to fetch recent runs:', fetchError);
    return new Response(
      JSON.stringify({ success: false, error: fetchError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // No run found in the last 3 hours - start a new sync
  if (!recentRuns || recentRuns.length === 0) {
    console.log('No run found in last 3 hours - starting new sync');
    await supabaseInvoke.functions.invoke('nightly-sync', { body: {} });
    return new Response(
      JSON.stringify({ 
        success: true, 
        action: 'started_new_sync',
        reason: 'no_run_found' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  const run = recentRuns[0];
  console.log(`Found run ${run.id} with status: ${run.status}`);
  
  // Run still in progress - do nothing
  if (run.status === 'running') {
    console.log('Run still in progress - no action needed');
    return new Response(
      JSON.stringify({ 
        success: true, 
        action: 'none',
        reason: 'run_still_running',
        run_id: run.id 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Run completed successfully - log and exit
  if (run.status === 'completed') {
    console.log('Run completed successfully - no action needed');
    return new Response(
      JSON.stringify({ 
        success: true, 
        action: 'none',
        reason: 'run_completed_successfully',
        run_id: run.id 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Run failed - check if we should retry
  if (run.status === 'failed') {
    // Check retry count (max 2 retries)
    const retryCount = run.retry_count || 0;
    if (retryCount >= 2) {
      console.log(`Run failed but already retried ${retryCount} times - not retrying`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          action: 'none',
          reason: 'max_retries_exceeded',
          run_id: run.id,
          retry_count: retryCount 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Check if it's a rate limit error
    if (isRateLimitError(run.error_message)) {
      console.log('Run failed due to rate limit - not retrying');
      console.log('Error message:', run.error_message);
      return new Response(
        JSON.stringify({ 
          success: true, 
          action: 'none',
          reason: 'rate_limit_error',
          run_id: run.id,
          error_message: run.error_message 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Not a rate limit error - start a retry
    console.log(`Run failed with non-rate-limit error - starting retry #${retryCount + 1}`);
    console.log('Original error:', run.error_message);
    
    // Create a new run marked as a retry
    const { data: newRun, error: createError } = await supabase
      .from('nightly_sync_runs')
      .insert({
        current_step: 'INIT',
        status: 'running',
        account_ids: [],
        account_states: {},
        step_results: { retry_of_run: run.id, retry_reason: run.error_message },
        invocation_count: 0,
        retry_count: retryCount + 1,
        retry_of: run.id,
      })
      .select()
      .single();
      
    if (createError) {
      console.error('Failed to create retry run:', createError);
      return new Response(
        JSON.stringify({ success: false, error: createError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Start the retry by invoking without run_id (will pick up the new run and initialize it properly)
    // But first, mark the new run so we can delete it and let the normal flow create one
    await supabase.from('nightly_sync_runs').delete().eq('id', newRun.id);
    
    // Now invoke without run_id - it will create a proper run
    // We'll update the retry tracking after
    const { data: invokeResult } = await supabaseInvoke.functions.invoke('nightly-sync', { body: {} });
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        action: 'started_retry',
        reason: 'failed_non_rate_limit',
        original_run_id: run.id,
        retry_number: retryCount + 1,
        original_error: run.error_message 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Unknown status
  console.log(`Unknown run status: ${run.status}`);
  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'none',
      reason: 'unknown_status',
      run_id: run.id,
      status: run.status 
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Invoker client with service-role marker for self-invocation
  const supabaseInvoke = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { global: { headers: { 'x-service-role': 'true' } } }
  );

  try {
    const body = await req.json().catch(() => ({}));
    
    // Handle verification mode
    if (body.verify) {
      return await handleVerification(supabase, supabaseInvoke);
    }
    
    const runId: string | undefined = body.run_id;

    let run: NightlySyncRun;

    if (!runId) {
      // === INIT: Start a new run ===
      console.log('=== Nightly Sync: Starting new run ===');

      // Check for any already running syncs (prevent duplicates)
      const { data: existingRuns } = await supabase
        .from('nightly_sync_runs')
        .select('id, started_at')
        .eq('status', 'running')
        .gte('started_at', new Date(Date.now() - MAX_RUN_TIME_MS).toISOString());

      if (existingRuns && existingRuns.length > 0) {
        console.log('Another nightly sync is already running:', existingRuns[0].id);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Another nightly sync is already running',
            existing_run_id: existingRuns[0].id 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch accounts with automated sync enabled
      const { data: accounts, error: accountsError } = await supabase
        .from('guesty_accounts')
        .select('id, account_name, airbnb_scrape_enabled, forecast_generation_enabled, probability_calculation_enabled, actionables_generation_enabled')
        .eq('automated_sync_enabled', true);

      if (accountsError) {
        throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
      }

      if (!accounts || accounts.length === 0) {
        console.log('No accounts with automated sync enabled');
        return new Response(
          JSON.stringify({ success: true, message: 'No accounts with automated sync enabled' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Initialize account states
      const accountStates: Record<string, AccountState> = {};
      for (const account of accounts) {
        accountStates[account.id] = {
          currentPhase: 'listings',
          phasesCompleted: [],
        };
      }

      // Create run record
      const { data: newRun, error: createError } = await supabase
        .from('nightly_sync_runs')
        .insert({
          current_step: 'ACCOUNT_SYNCS',
          status: 'running',
          account_ids: accounts.map(a => a.id),
          account_states: accountStates,
          step_results: { accounts: accounts.map(a => ({ id: a.id, name: a.account_name })) },
          invocation_count: 1,
        })
        .select()
        .single();

      if (createError || !newRun) {
        throw new Error(`Failed to create run record: ${createError?.message}`);
      }

      run = newRun as NightlySyncRun;
      console.log(`Created run ${run.id} with ${accounts.length} accounts`);

      // Fire off initial listings sync for ALL accounts in parallel
      console.log('Firing off listings sync for all accounts in parallel...');
      const syncPromises = accounts.map(account => 
        supabaseInvoke.functions.invoke('sync-guesty-data', {
          body: { accountId: account.id, syncType: 'listings' }
        }).catch(err => {
          console.error(`Failed to invoke listings sync for ${account.account_name}:`, err);
          return { error: err };
        })
      );
      await Promise.all(syncPromises);

      // Self-invoke to check progress
      console.log('Self-invoking to check progress...');
      await sleep(SELF_INVOKE_DELAY_MS);
      await supabaseInvoke.functions.invoke('nightly-sync', {
        body: { run_id: run.id }
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Nightly sync started',
          run_id: run.id 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // === CONTINUATION: Process existing run ===
      console.log(`=== Nightly Sync: Continuing run ${runId} ===`);

      const { data: existingRun, error: fetchError } = await supabase
        .from('nightly_sync_runs')
        .select('*')
        .eq('id', runId)
        .single();

      if (fetchError || !existingRun) {
        throw new Error(`Failed to fetch run ${runId}: ${fetchError?.message}`);
      }

      run = existingRun as NightlySyncRun;

      // Safety checks
      if (run.status !== 'running') {
        console.log(`Run ${runId} is not running (status: ${run.status}), exiting`);
        return new Response(
          JSON.stringify({ success: true, message: 'Run already completed', status: run.status }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (run.invocation_count >= MAX_INVOCATIONS) {
        console.error(`Run ${runId} exceeded max invocations (${MAX_INVOCATIONS})`);
        await supabase.from('nightly_sync_runs').update({
          status: 'failed',
          error_message: `Exceeded maximum invocations (${MAX_INVOCATIONS})`,
          completed_at: new Date().toISOString(),
        }).eq('id', runId);
        return new Response(
          JSON.stringify({ success: false, error: 'Exceeded max invocations' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const runStartTime = new Date(run.started_at).getTime();
      if (Date.now() - runStartTime > MAX_RUN_TIME_MS) {
        console.error(`Run ${runId} exceeded max run time (2 hours)`);
        await supabase.from('nightly_sync_runs').update({
          status: 'failed',
          error_message: 'Exceeded maximum run time (2 hours)',
          completed_at: new Date().toISOString(),
        }).eq('id', runId);
        return new Response(
          JSON.stringify({ success: false, error: 'Exceeded max run time' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Increment invocation count
      await supabase.from('nightly_sync_runs').update({
        invocation_count: run.invocation_count + 1,
      }).eq('id', runId);

      console.log(`Current step: ${run.current_step}, invocation: ${run.invocation_count + 1}`);

      // Process based on current step
      switch (run.current_step) {
        case 'ACCOUNT_SYNCS':
          await processAccountSyncs(supabase, supabaseInvoke, run);
          break;
        case 'AIRBNB_RATINGS':
          await processAirbnbRatings(supabase, supabaseInvoke, run);
          break;
        case 'PROBABILITIES':
          await processProbabilities(supabase, supabaseInvoke, run);
          break;
        case 'FORECASTS':
          await processForecasts(supabase, supabaseInvoke, run);
          break;
        case 'ACTIONABLES':
          await processActionables(supabase, supabaseInvoke, run);
          break;
        case 'COMPLETED':
          await completeRun(supabase, run);
          break;
      }

      return new Response(
        JSON.stringify({ success: true, run_id: runId, step: run.current_step }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('Nightly sync error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// === STEP PROCESSORS ===

async function processAccountSyncs(
  supabase: any,
  supabaseInvoke: any,
  run: NightlySyncRun
): Promise<void> {
  console.log('Processing ACCOUNT_SYNCS step...');

  const accountStates = { ...run.account_states };
  let allDone = true;
  let anyProgress = false;

  // Check each account's current phase
  for (const accountId of run.account_ids) {
    const state = accountStates[accountId];
    if (!state || state.currentPhase === 'done') continue;

    allDone = false;
    const syncType = getSyncType(state.currentPhase);
    
    // Special handling for owners sync (doesn't use sync_jobs table)
    if (state.currentPhase === 'owners') {
      // Owners sync completes quickly, just move to next phase
      console.log(`[${accountId}] Owners sync assumed complete, moving to calendar`);
      state.phasesCompleted.push('owners');
      state.currentPhase = 'calendar';
      anyProgress = true;

      // Fire off calendar sync
      console.log(`[${accountId}] Firing calendar sync...`);
      await supabaseInvoke.functions.invoke('sync-bulk-calendar', {
        body: { guestyAccountId: accountId }
      }).catch((err: any) => console.error(`Failed to invoke calendar sync:`, err));
      continue;
    }

    const result = await isSyncComplete(supabase, accountId, syncType);
    
    if (result.complete) {
      if (result.success) {
        console.log(`[${accountId}] ${state.currentPhase} completed successfully`);
        state.phasesCompleted.push(state.currentPhase);
        state.currentPhase = getNextPhase(state.currentPhase);
        anyProgress = true;

        // Fire off next phase if not done
        if (state.currentPhase !== 'done') {
          console.log(`[${accountId}] Firing ${state.currentPhase} sync...`);
          if (state.currentPhase === 'reservations') {
            await supabaseInvoke.functions.invoke('sync-new-reservations', {
              body: { accountId }
            }).catch((err: any) => console.error(`Failed to invoke reservations sync:`, err));
          } else if (state.currentPhase === 'owners') {
            await supabaseInvoke.functions.invoke('sync-owners', {
              body: { accountId }
            }).catch((err: any) => console.error(`Failed to invoke owners sync:`, err));
          } else if (state.currentPhase === 'calendar') {
            await supabaseInvoke.functions.invoke('sync-bulk-calendar', {
              body: { guestyAccountId: accountId }
            }).catch((err: any) => console.error(`Failed to invoke calendar sync:`, err));
          }
        }
      } else {
        console.error(`[${accountId}] ${state.currentPhase} failed: ${result.error}`);
        state.error = result.error;
        // Skip to done on failure
        state.currentPhase = 'done';
        anyProgress = true;
      }
    } else {
      console.log(`[${accountId}] ${state.currentPhase} still running...`);
    }
  }

  // Update run state
  if (anyProgress) {
    await supabase.from('nightly_sync_runs').update({
      account_states: accountStates,
    }).eq('id', run.id);
  }

  // Check if all accounts are done
  const accountsDone = run.account_ids.every(id => accountStates[id]?.currentPhase === 'done');

  if (accountsDone) {
    console.log('All account syncs complete, transitioning to AIRBNB_RATINGS');

    // Update last_automated_sync for all accounts
    for (const accountId of run.account_ids) {
      await supabase.from('guesty_accounts').update({
        last_automated_sync: new Date().toISOString(),
      }).eq('id', accountId);
    }

    await supabase.from('nightly_sync_runs').update({
      current_step: 'AIRBNB_RATINGS',
      account_states: accountStates,
    }).eq('id', run.id);

    // Fire off Airbnb ratings scrape
    const accounts = run.step_results.accounts as Account[];
    const airbnbEnabled = accounts?.some(a => a.airbnb_scrape_enabled !== false);
    
    if (airbnbEnabled) {
      console.log('Firing Airbnb ratings scrape...');
      await supabaseInvoke.functions.invoke('bulk-scrape-airbnb-ratings', {
        body: {}
      }).catch((err: any) => console.error('Failed to invoke Airbnb scrape:', err));
    }
  }

  // Self-invoke to continue
  console.log('Self-invoking to continue...');
  await sleep(SELF_INVOKE_DELAY_MS);
  await supabaseInvoke.functions.invoke('nightly-sync', {
    body: { run_id: run.id }
  });
}

async function processAirbnbRatings(
  supabase: any,
  supabaseInvoke: any,
  run: NightlySyncRun
): Promise<void> {
  console.log('Processing AIRBNB_RATINGS step...');

  const accounts = run.step_results.accounts as Account[];
  const airbnbEnabled = accounts?.some(a => a.airbnb_scrape_enabled !== false);

  if (!airbnbEnabled) {
    console.log('Airbnb scraping disabled, skipping to PROBABILITIES');
    await supabase.from('nightly_sync_runs').update({
      current_step: 'PROBABILITIES',
      step_results: { ...run.step_results, airbnb_ratings: { skipped: true } },
    }).eq('id', run.id);
  } else {
    // Check if scrape is complete
    const firstAccountId = run.account_ids[0];
    const result = await isSyncComplete(supabase, firstAccountId, 'airbnb_ratings');

    if (result.complete) {
      console.log(`Airbnb ratings scrape complete (success: ${result.success})`);
      await supabase.from('nightly_sync_runs').update({
        current_step: 'PROBABILITIES',
        step_results: { ...run.step_results, airbnb_ratings: { success: result.success, error: result.error } },
      }).eq('id', run.id);
    } else {
      console.log('Airbnb ratings still running...');
    }
  }

  // Fire off probabilities if transitioning
  const { data: updatedRun } = await supabase.from('nightly_sync_runs').select('current_step').eq('id', run.id).single();
  if (updatedRun?.current_step === 'PROBABILITIES') {
    const probEnabled = accounts?.some(a => a.probability_calculation_enabled !== false);
    if (probEnabled) {
      console.log('Firing probability calculation...');
      const { data: probResponse } = await supabaseInvoke.functions.invoke('calculate-all-probabilities', {
        body: {}
      }).catch((err: any) => {
        console.error('Failed to invoke probability calculation:', err);
        return { data: null };
      });

      if (probResponse?.progress_id) {
        await supabase.from('nightly_sync_runs').update({
          step_results: { ...run.step_results, probability_progress_id: probResponse.progress_id },
        }).eq('id', run.id);
      }
    }
  }

  // Self-invoke to continue
  console.log('Self-invoking to continue...');
  await sleep(SELF_INVOKE_DELAY_MS);
  await supabaseInvoke.functions.invoke('nightly-sync', {
    body: { run_id: run.id }
  });
}

async function processProbabilities(
  supabase: any,
  supabaseInvoke: any,
  run: NightlySyncRun
): Promise<void> {
  console.log('Processing PROBABILITIES step...');

  const accounts = run.step_results.accounts as Account[];
  const probEnabled = accounts?.some(a => a.probability_calculation_enabled !== false);

  if (!probEnabled) {
    console.log('Probability calculation disabled, skipping to FORECASTS');
    await supabase.from('nightly_sync_runs').update({
      current_step: 'FORECASTS',
      step_results: { ...run.step_results, probabilities: { skipped: true } },
    }).eq('id', run.id);
  } else {
    const progressId = run.step_results.probability_progress_id;
    if (progressId) {
      const result = await isProgressComplete(supabase, progressId);
      if (result.complete) {
        console.log(`Probability calculation complete (success: ${result.success})`);
        await supabase.from('nightly_sync_runs').update({
          current_step: 'FORECASTS',
          step_results: { ...run.step_results, probabilities: { success: result.success, error: result.error } },
        }).eq('id', run.id);
      } else {
        console.log('Probability calculation still running...');
      }
    } else {
      // No progress ID, might have failed to start
      console.log('No probability progress ID, moving to FORECASTS');
      await supabase.from('nightly_sync_runs').update({
        current_step: 'FORECASTS',
        step_results: { ...run.step_results, probabilities: { skipped: true, reason: 'no_progress_id' } },
      }).eq('id', run.id);
    }
  }

  // Fire off forecasts if transitioning
  const { data: updatedRun } = await supabase.from('nightly_sync_runs').select('current_step').eq('id', run.id).single();
  if (updatedRun?.current_step === 'FORECASTS') {
    const forecastEnabled = accounts?.some(a => a.forecast_generation_enabled !== false);
    if (forecastEnabled) {
      console.log('Firing forecast generation...');
      const { data: forecastResponse } = await supabaseInvoke.functions.invoke('generate-all-forecasts', {
        body: {}
      }).catch((err: any) => {
        console.error('Failed to invoke forecast generation:', err);
        return { data: null };
      });

      if (forecastResponse?.progress_id) {
        await supabase.from('nightly_sync_runs').update({
          step_results: { ...run.step_results, forecast_progress_id: forecastResponse.progress_id },
        }).eq('id', run.id);
      }
    }
  }

  // Self-invoke to continue
  console.log('Self-invoking to continue...');
  await sleep(SELF_INVOKE_DELAY_MS);
  await supabaseInvoke.functions.invoke('nightly-sync', {
    body: { run_id: run.id }
  });
}

async function processForecasts(
  supabase: any,
  supabaseInvoke: any,
  run: NightlySyncRun
): Promise<void> {
  console.log('Processing FORECASTS step...');

  const accounts = run.step_results.accounts as Account[];
  const forecastEnabled = accounts?.some(a => a.forecast_generation_enabled !== false);

  if (!forecastEnabled) {
    console.log('Forecast generation disabled, skipping to ACTIONABLES');
    await supabase.from('nightly_sync_runs').update({
      current_step: 'ACTIONABLES',
      step_results: { ...run.step_results, forecasts: { skipped: true } },
    }).eq('id', run.id);
  } else {
    const progressId = run.step_results.forecast_progress_id;
    if (progressId) {
      const result = await isProgressComplete(supabase, progressId);
      if (result.complete) {
        console.log(`Forecast generation complete (success: ${result.success})`);
        await supabase.from('nightly_sync_runs').update({
          current_step: 'ACTIONABLES',
          step_results: { ...run.step_results, forecasts: { success: result.success, error: result.error } },
        }).eq('id', run.id);
      } else {
        console.log('Forecast generation still running...');
      }
    } else {
      console.log('No forecast progress ID, moving to ACTIONABLES');
      await supabase.from('nightly_sync_runs').update({
        current_step: 'ACTIONABLES',
        step_results: { ...run.step_results, forecasts: { skipped: true, reason: 'no_progress_id' } },
      }).eq('id', run.id);
    }
  }

  // Fire off actionables if transitioning
  const { data: updatedRun } = await supabase.from('nightly_sync_runs').select('current_step').eq('id', run.id).single();
  if (updatedRun?.current_step === 'ACTIONABLES') {
    const actionablesEnabled = accounts?.some(a => a.actionables_generation_enabled !== false);
    if (actionablesEnabled) {
      console.log('Firing actionables generation...');
      await supabaseInvoke.functions.invoke('generate-actionables', {
        body: {}
      }).catch((err: any) => console.error('Failed to invoke actionables generation:', err));
    }
  }

  // Self-invoke to continue
  console.log('Self-invoking to continue...');
  await sleep(SELF_INVOKE_DELAY_MS);
  await supabaseInvoke.functions.invoke('nightly-sync', {
    body: { run_id: run.id }
  });
}

async function processActionables(
  supabase: any,
  supabaseInvoke: any,
  run: NightlySyncRun
): Promise<void> {
  console.log('Processing ACTIONABLES step...');

  const accounts = run.step_results.accounts as Account[];
  const actionablesEnabled = accounts?.some(a => a.actionables_generation_enabled !== false);

  if (!actionablesEnabled) {
    console.log('Actionables generation disabled, moving to COMPLETED');
  } else {
    // Actionables is a quick operation, assume complete after one invocation
    console.log('Actionables generation assumed complete');
  }

  await supabase.from('nightly_sync_runs').update({
    current_step: 'COMPLETED',
    step_results: { ...run.step_results, actionables: { success: true } },
  }).eq('id', run.id);

  // Self-invoke to finalize
  console.log('Self-invoking to finalize...');
  await sleep(1000);
  await supabaseInvoke.functions.invoke('nightly-sync', {
    body: { run_id: run.id }
  });
}

async function completeRun(
  supabase: any,
  run: NightlySyncRun
): Promise<void> {
  console.log('=== Nightly Sync: Completing run ===');

  const duration = Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000);
  
  await supabase.from('nightly_sync_runs').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    step_results: {
      ...run.step_results,
      summary: {
        duration_seconds: duration,
        accounts_processed: run.account_ids.length,
        completed_at: new Date().toISOString(),
      }
    },
  }).eq('id', run.id);

  console.log(`Run ${run.id} completed in ${duration} seconds`);
  console.log(`Accounts processed: ${run.account_ids.length}`);
  console.log('Step results:', JSON.stringify(run.step_results, null, 2));
}

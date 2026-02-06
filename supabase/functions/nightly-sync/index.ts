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
  status: 'running' | 'completed' | 'completed_with_errors' | 'failed';
  account_ids: string[];
  account_states: Record<string, AccountState>;
  step_results: Record<string, any>;
  error_message: string | null;
  invocation_count: number;
  retry_count?: number;
  retry_of?: string;
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

// Log timing for a step (start or end)
async function logStepTiming(
  supabase: any,
  runId: string,
  stepName: string,
  action: 'start' | 'end',
  additionalData?: Record<string, any>
): Promise<void> {
  try {
    const { data: run } = await supabase
      .from('nightly_sync_runs')
      .select('step_results')
      .eq('id', runId)
      .single();

    const stepResults = run?.step_results || {};
    const stepData = stepResults[stepName] || {};
    
    if (action === 'start') {
      stepData.started_at = new Date().toISOString();
      console.log(`[TIMING] ${stepName} started at ${stepData.started_at}`);
    } else {
      stepData.completed_at = new Date().toISOString();
      if (stepData.started_at) {
        stepData.duration_seconds = Math.round(
          (Date.now() - new Date(stepData.started_at).getTime()) / 1000
        );
        console.log(`[TIMING] ${stepName} completed in ${stepData.duration_seconds}s`);
      }
    }

    // Merge any additional data
    if (additionalData) {
      Object.assign(stepData, additionalData);
    }

    await supabase.from('nightly_sync_runs').update({
      step_results: { ...stepResults, [stepName]: stepData }
    }).eq('id', runId);
  } catch (err) {
    console.error(`Failed to log step timing for ${stepName}:`, err);
  }
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

// Check step_results for any partial failures
function hasPartialFailures(stepResults: Record<string, any>): string[] {
  const failures: string[] = [];
  for (const [step, result] of Object.entries(stepResults)) {
    if (step === 'accounts' || step === 'summary') continue; // Skip metadata
    if (result && typeof result === 'object') {
      if (result.success === false) {
        failures.push(`${step}: ${result.error || 'failed'}`);
      }
      if (result.error && result.success !== true) {
        failures.push(`${step}: ${result.error}`);
      }
    }
  }
  return failures;
}

// Handle verification mode - check if previous run completed and retry if needed
async function handleVerification(
  supabase: any,
  supabaseInvoke: any
): Promise<Response> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         NIGHTLY SYNC VERIFICATION MODE - 5:30 AM UTC         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  
  // Find the most recent run from the last 3 hours
  const { data: recentRuns, error: fetchError } = await supabase
    .from('nightly_sync_runs')
    .select('*')
    .gte('started_at', threeHoursAgo)
    .order('started_at', { ascending: false })
    .limit(1);
    
  if (fetchError) {
    console.error('❌ Failed to fetch recent runs:', fetchError);
    return new Response(
      JSON.stringify({ success: false, error: fetchError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // No run found in the last 3 hours - start a new sync
  if (!recentRuns || recentRuns.length === 0) {
    console.log('⚠️  No run found in last 3 hours - starting new sync');
    console.log('   This could mean the 3 AM cron job failed to trigger.');
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
  
  const run = recentRuns[0] as NightlySyncRun;
  
  // Print detailed verification report
  console.log('=== VERIFICATION REPORT ===');
  console.log(`Run ID: ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Started: ${run.started_at}`);
  console.log(`Current Step: ${run.current_step}`);
  console.log(`Invocations: ${run.invocation_count}/${MAX_INVOCATIONS}`);
  console.log(`Retry Count: ${run.retry_count || 0}`);
  if (run.retry_of) console.log(`Retry Of: ${run.retry_of}`);
  console.log('');
  console.log('Account States:');
  console.log(JSON.stringify(run.account_states, null, 2));
  console.log('');
  console.log('Step Results:');
  console.log(JSON.stringify(run.step_results, null, 2));
  console.log('');
  
  // Run still in progress - do nothing
  if (run.status === 'running') {
    const runningFor = Math.round((Date.now() - new Date(run.started_at).getTime()) / 60000);
    console.log(`ℹ️  Run still in progress (running for ${runningFor} minutes)`);
    console.log('   No action needed - letting it complete.');
    return new Response(
      JSON.stringify({ 
        success: true, 
        action: 'none',
        reason: 'run_still_running',
        run_id: run.id,
        running_for_minutes: runningFor
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Run completed - check for partial failures
  if (run.status === 'completed' || run.status === 'completed_with_errors') {
    const partialFailures = hasPartialFailures(run.step_results || {});
    
    if (partialFailures.length > 0) {
      console.log('⚠️  Run completed but with partial failures:');
      partialFailures.forEach(f => console.log(`   - ${f}`));
      console.log('');
      console.log('   Manual review may be needed for failed steps.');
    } else {
      console.log('✅ Run completed successfully - no action needed');
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        action: 'none',
        reason: run.status === 'completed_with_errors' ? 'completed_with_errors' : 'run_completed_successfully',
        run_id: run.id,
        partial_failures: partialFailures
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Run failed - check if we should retry
  if (run.status === 'failed') {
    const retryCount = run.retry_count || 0;
    
    console.log('❌ Run FAILED');
    console.log(`   Error: ${run.error_message}`);
    console.log(`   Retry count: ${retryCount}/2`);
    console.log('');
    
    if (retryCount >= 2) {
      console.log('=== NOT RETRYING: MAX RETRIES EXCEEDED ===');
      console.log(`The sync has already been retried ${retryCount} times.`);
      console.log('Manual intervention is required to investigate the failure.');
      console.log('');
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
      console.log('=== NOT RETRYING: RATE LIMIT ===');
      console.log('The Guesty API returned rate limit errors.');
      console.log('This is typically a temporary issue that resolves within a few hours.');
      console.log('Manual intervention may be needed if this persists.');
      console.log('Consider checking: https://app.guesty.com for API status');
      console.log('');
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
    console.log('=== STARTING RETRY ===');
    console.log(`Initiating retry #${retryCount + 1} for failed run ${run.id}`);
    console.log('');
    
    // Invoke with retry context - the new run will pick up retry tracking
    await supabaseInvoke.functions.invoke('nightly-sync', { 
      body: { 
        retry_of_run_id: run.id, 
        retry_number: retryCount + 1 
      } 
    });
    
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
  console.log(`⚠️  Unknown run status: ${run.status}`);
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
    const retryOfRunId: string | undefined = body.retry_of_run_id;
    const retryNumber: number | undefined = body.retry_number;

    let run: NightlySyncRun;

    if (!runId) {
      // === INIT: Start a new run ===
      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║             NIGHTLY SYNC: STARTING NEW RUN                   ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log(`Timestamp: ${new Date().toISOString()}`);
      if (retryOfRunId) {
        console.log(`This is RETRY #${retryNumber} of run ${retryOfRunId}`);
      }
      console.log('');

      // Check for any already running syncs (prevent duplicates)
      const { data: existingRuns } = await supabase
        .from('nightly_sync_runs')
        .select('id, started_at')
        .eq('status', 'running')
        .gte('started_at', new Date(Date.now() - MAX_RUN_TIME_MS).toISOString());

      if (existingRuns && existingRuns.length > 0) {
        console.log('⚠️  Another nightly sync is already running:', existingRuns[0].id);
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
        console.log('ℹ️  No accounts with automated sync enabled');
        return new Response(
          JSON.stringify({ success: true, message: 'No accounts with automated sync enabled' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Found ${accounts.length} account(s) with automated sync enabled:`);
      accounts.forEach(a => console.log(`  - ${a.account_name} (${a.id})`));
      console.log('');

      // Initialize account states
      const accountStates: Record<string, AccountState> = {};
      for (const account of accounts) {
        accountStates[account.id] = {
          currentPhase: 'listings',
          phasesCompleted: [],
        };
      }

      // Create run record with retry tracking if applicable
      const runData: any = {
        current_step: 'ACCOUNT_SYNCS',
        status: 'running',
        account_ids: accounts.map(a => a.id),
        account_states: accountStates,
        step_results: { 
          accounts: accounts.map(a => ({ id: a.id, name: a.account_name })),
          account_syncs: { started_at: new Date().toISOString() }
        },
        invocation_count: 1,
      };

      // Add retry tracking if this is a retry
      if (retryOfRunId && retryNumber) {
        runData.retry_of = retryOfRunId;
        runData.retry_count = retryNumber;
        runData.step_results.retry_context = {
          retry_of: retryOfRunId,
          retry_number: retryNumber,
          started_at: new Date().toISOString()
        };
      }

      const { data: newRun, error: createError } = await supabase
        .from('nightly_sync_runs')
        .insert(runData)
        .select()
        .single();

      if (createError || !newRun) {
        throw new Error(`Failed to create run record: ${createError?.message}`);
      }

      run = newRun as NightlySyncRun;
      console.log(`✓ Created run ${run.id}`);
      console.log('');

      // Fire off initial listings sync for ALL accounts in parallel
      console.log('Firing listings sync for all accounts in parallel...');
      const syncPromises = accounts.map(account => 
        supabaseInvoke.functions.invoke('sync-guesty-data', {
          body: { accountId: account.id, syncType: 'listings' }
        }).then(() => {
          console.log(`  ✓ Listings sync started for ${account.account_name}`);
        }).catch(err => {
          console.error(`  ✗ Failed to invoke listings sync for ${account.account_name}:`, err.message);
          return { error: err };
        })
      );
      await Promise.all(syncPromises);

      // Self-invoke to check progress
      console.log('');
      console.log(`Waiting ${SELF_INVOKE_DELAY_MS/1000}s before checking progress...`);
      await sleep(SELF_INVOKE_DELAY_MS);
      await supabaseInvoke.functions.invoke('nightly-sync', {
        body: { run_id: run.id }
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Nightly sync started',
          run_id: run.id,
          accounts_count: accounts.length,
          is_retry: !!retryOfRunId
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // === CONTINUATION: Process existing run ===
      const { data: existingRun, error: fetchError } = await supabase
        .from('nightly_sync_runs')
        .select('*')
        .eq('id', runId)
        .single();

      if (fetchError || !existingRun) {
        throw new Error(`Failed to fetch run ${runId}: ${fetchError?.message}`);
      }

      run = existingRun as NightlySyncRun;
      
      console.log(`=== Nightly Sync: Continuing run ${runId} ===`);
      console.log(`Step: ${run.current_step} | Invocation: ${run.invocation_count + 1}/${MAX_INVOCATIONS}`);

      // Safety checks
      if (run.status !== 'running') {
        console.log(`Run ${runId} is not running (status: ${run.status}), exiting`);
        return new Response(
          JSON.stringify({ success: true, message: 'Run already completed', status: run.status }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (run.invocation_count >= MAX_INVOCATIONS) {
        console.error(`❌ Run ${runId} exceeded max invocations (${MAX_INVOCATIONS})`);
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
        console.error(`❌ Run ${runId} exceeded max run time (2 hours)`);
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
    console.error('❌ Nightly sync error:', error);
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
  const accounts = (run.step_results.accounts || []) as Account[];
  let allDone = true;
  let anyProgress = false;

  // Check each account's current phase
  for (const accountId of run.account_ids) {
    const state = accountStates[accountId];
    const accountInfo = accounts.find(a => a.id === accountId);
    const accountName = accountInfo?.name || accountId.substring(0, 8);
    
    if (!state || state.currentPhase === 'done') continue;

    allDone = false;
    const syncType = getSyncType(state.currentPhase);
    
    // Special handling for owners sync (doesn't use sync_jobs table)
    if (state.currentPhase === 'owners') {
      console.log(`[${accountName}] Owners sync assumed complete, moving to calendar`);
      state.phasesCompleted.push('owners');
      state.currentPhase = 'calendar';
      anyProgress = true;

      // Fire off calendar sync
      console.log(`[${accountName}] Firing calendar sync...`);
      await supabaseInvoke.functions.invoke('sync-bulk-calendar', {
        body: { guestyAccountId: accountId }
      }).catch((err: any) => console.error(`[${accountName}] Failed to invoke calendar sync:`, err.message));
      continue;
    }

    const result = await isSyncComplete(supabase, accountId, syncType);
    
    if (result.complete) {
      if (result.success) {
        console.log(`[${accountName}] ✓ ${state.currentPhase} completed successfully`);
        state.phasesCompleted.push(state.currentPhase);
        state.currentPhase = getNextPhase(state.currentPhase);
        anyProgress = true;

        // Fire off next phase if not done
        if (state.currentPhase !== 'done') {
          console.log(`[${accountName}] Firing ${state.currentPhase} sync...`);
          if (state.currentPhase === 'reservations') {
            await supabaseInvoke.functions.invoke('sync-new-reservations', {
              body: { accountId }
            }).catch((err: any) => console.error(`[${accountName}] Failed to invoke reservations sync:`, err.message));
          } else if (state.currentPhase === 'owners') {
            await supabaseInvoke.functions.invoke('sync-owners', {
              body: { accountId }
            }).catch((err: any) => console.error(`[${accountName}] Failed to invoke owners sync:`, err.message));
          } else if (state.currentPhase === 'calendar') {
            await supabaseInvoke.functions.invoke('sync-bulk-calendar', {
              body: { guestyAccountId: accountId }
            }).catch((err: any) => console.error(`[${accountName}] Failed to invoke calendar sync:`, err.message));
          }
        }
      } else {
        console.error(`[${accountName}] ✗ ${state.currentPhase} failed: ${result.error}`);
        state.error = result.error;
        // Skip to done on failure
        state.currentPhase = 'done';
        anyProgress = true;
      }
    } else {
      console.log(`[${accountName}] ${state.currentPhase} still running...`);
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
    console.log('');
    console.log('All account syncs complete, building summary...');

    // Build account summary for step_results
    const accountSummary: Record<string, any> = {};
    let successfulAccounts = 0;
    let failedAccounts = 0;

    for (const accountId of run.account_ids) {
      const state = accountStates[accountId];
      const accountInfo = accounts.find(a => a.id === accountId);
      const isSuccess = !state?.error && state?.phasesCompleted?.includes('calendar');
      
      accountSummary[accountId] = {
        name: accountInfo?.name || accountId,
        phases_completed: state?.phasesCompleted || [],
        success: isSuccess,
        error: state?.error
      };

      if (isSuccess) successfulAccounts++;
      else failedAccounts++;
    }

    console.log(`Account sync summary: ${successfulAccounts} successful, ${failedAccounts} failed`);

    // Log step timing end and update step_results
    await logStepTiming(supabase, run.id, 'account_syncs', 'end', {
      success: failedAccounts === 0,
      summary: {
        total_accounts: run.account_ids.length,
        successful: successfulAccounts,
        failed: failedAccounts,
        accounts: accountSummary
      }
    });

    // Update last_automated_sync for all accounts
    for (const accountId of run.account_ids) {
      await supabase.from('guesty_accounts').update({
        last_automated_sync: new Date().toISOString(),
      }).eq('id', accountId);
    }

    console.log('Transitioning to AIRBNB_RATINGS');
    await supabase.from('nightly_sync_runs').update({
      current_step: 'AIRBNB_RATINGS',
      account_states: accountStates,
    }).eq('id', run.id);

    // Fire off Airbnb ratings scrape
    const airbnbEnabled = accounts?.some(a => a.airbnb_scrape_enabled !== false);
    
    if (airbnbEnabled) {
      console.log('Firing Airbnb ratings scrape...');
      await logStepTiming(supabase, run.id, 'airbnb_ratings', 'start');
      await supabaseInvoke.functions.invoke('bulk-scrape-airbnb-ratings', {
        body: {}
      }).catch((err: any) => console.error('Failed to invoke Airbnb scrape:', err.message));
    }
  }

  // Self-invoke to continue
  console.log(`Waiting ${SELF_INVOKE_DELAY_MS/1000}s before next check...`);
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
    await logStepTiming(supabase, run.id, 'airbnb_ratings', 'end', { skipped: true, reason: 'disabled' });
    await supabase.from('nightly_sync_runs').update({
      current_step: 'PROBABILITIES',
    }).eq('id', run.id);
  } else {
    // Check if scrape is complete
    const firstAccountId = run.account_ids[0];
    const result = await isSyncComplete(supabase, firstAccountId, 'airbnb_ratings');

    if (result.complete) {
      console.log(`✓ Airbnb ratings scrape complete (success: ${result.success})`);
      await logStepTiming(supabase, run.id, 'airbnb_ratings', 'end', { 
        success: result.success, 
        error: result.error 
      });
      await supabase.from('nightly_sync_runs').update({
        current_step: 'PROBABILITIES',
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
      await logStepTiming(supabase, run.id, 'probabilities', 'start');
      const { data: probResponse } = await supabaseInvoke.functions.invoke('calculate-all-probabilities', {
        body: {}
      }).catch((err: any) => {
        console.error('Failed to invoke probability calculation:', err.message);
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
  console.log(`Waiting ${SELF_INVOKE_DELAY_MS/1000}s before next check...`);
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
    await logStepTiming(supabase, run.id, 'probabilities', 'end', { skipped: true, reason: 'disabled' });
    await supabase.from('nightly_sync_runs').update({
      current_step: 'FORECASTS',
    }).eq('id', run.id);
  } else {
    const progressId = run.step_results.probability_progress_id;
    if (progressId) {
      const result = await isProgressComplete(supabase, progressId);
      if (result.complete) {
        console.log(`✓ Probability calculation complete (success: ${result.success})`);
        await logStepTiming(supabase, run.id, 'probabilities', 'end', {
          success: result.success,
          error: result.error
        });
        await supabase.from('nightly_sync_runs').update({
          current_step: 'FORECASTS',
        }).eq('id', run.id);
      } else {
        console.log('Probability calculation still running...');
      }
    } else {
      // No progress ID, might have failed to start
      console.log('No probability progress ID, moving to FORECASTS');
      await logStepTiming(supabase, run.id, 'probabilities', 'end', { 
        skipped: true, 
        reason: 'no_progress_id' 
      });
      await supabase.from('nightly_sync_runs').update({
        current_step: 'FORECASTS',
      }).eq('id', run.id);
    }
  }

  // Fire off forecasts if transitioning
  const { data: updatedRun } = await supabase.from('nightly_sync_runs').select('current_step').eq('id', run.id).single();
  if (updatedRun?.current_step === 'FORECASTS') {
    const forecastEnabled = accounts?.some(a => a.forecast_generation_enabled !== false);
    if (forecastEnabled) {
      console.log('Firing forecast generation...');
      await logStepTiming(supabase, run.id, 'forecasts', 'start');
      const { data: forecastResponse } = await supabaseInvoke.functions.invoke('generate-all-forecasts', {
        body: {}
      }).catch((err: any) => {
        console.error('Failed to invoke forecast generation:', err.message);
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
  console.log(`Waiting ${SELF_INVOKE_DELAY_MS/1000}s before next check...`);
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
    await logStepTiming(supabase, run.id, 'forecasts', 'end', { skipped: true, reason: 'disabled' });
    await supabase.from('nightly_sync_runs').update({
      current_step: 'ACTIONABLES',
    }).eq('id', run.id);
  } else {
    const progressId = run.step_results.forecast_progress_id;
    if (progressId) {
      const result = await isProgressComplete(supabase, progressId);
      if (result.complete) {
        console.log(`✓ Forecast generation complete (success: ${result.success})`);
        await logStepTiming(supabase, run.id, 'forecasts', 'end', {
          success: result.success,
          error: result.error
        });
        await supabase.from('nightly_sync_runs').update({
          current_step: 'ACTIONABLES',
        }).eq('id', run.id);
      } else {
        console.log('Forecast generation still running...');
      }
    } else {
      console.log('No forecast progress ID, moving to ACTIONABLES');
      await logStepTiming(supabase, run.id, 'forecasts', 'end', { 
        skipped: true, 
        reason: 'no_progress_id' 
      });
      await supabase.from('nightly_sync_runs').update({
        current_step: 'ACTIONABLES',
      }).eq('id', run.id);
    }
  }

  // Fire off actionables if transitioning
  const { data: updatedRun } = await supabase.from('nightly_sync_runs').select('current_step').eq('id', run.id).single();
  if (updatedRun?.current_step === 'ACTIONABLES') {
    const actionablesEnabled = accounts?.some(a => a.actionables_generation_enabled !== false);
    if (actionablesEnabled) {
      console.log('Firing actionables generation...');
      await logStepTiming(supabase, run.id, 'actionables', 'start');
      await supabaseInvoke.functions.invoke('generate-actionables', {
        body: {}
      }).catch((err: any) => console.error('Failed to invoke actionables generation:', err.message));
    }
  }

  // Self-invoke to continue
  console.log(`Waiting ${SELF_INVOKE_DELAY_MS/1000}s before next check...`);
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
    console.log('Actionables generation disabled');
    await logStepTiming(supabase, run.id, 'actionables', 'end', { skipped: true, reason: 'disabled' });
  } else {
    // Actionables is a quick operation, assume complete after one invocation
    console.log('✓ Actionables generation assumed complete');
    await logStepTiming(supabase, run.id, 'actionables', 'end', { success: true });
  }

  await supabase.from('nightly_sync_runs').update({
    current_step: 'COMPLETED',
  }).eq('id', run.id);

  // Self-invoke to finalize
  console.log('Moving to COMPLETED...');
  await sleep(1000);
  await supabaseInvoke.functions.invoke('nightly-sync', {
    body: { run_id: run.id }
  });
}

async function completeRun(
  supabase: any,
  run: NightlySyncRun
): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║             NIGHTLY SYNC: COMPLETING RUN                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Refetch to get latest step_results
  const { data: latestRun } = await supabase
    .from('nightly_sync_runs')
    .select('*')
    .eq('id', run.id)
    .single();

  const stepResults = latestRun?.step_results || run.step_results;
  const accountStates = latestRun?.account_states || run.account_states;

  const duration = Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000);
  const durationMinutes = Math.round(duration / 60);
  
  // Build account summary
  const accountSummary: Record<string, any> = {};
  let successfulAccounts = 0;
  let failedAccounts = 0;
  const accounts = stepResults.accounts as Account[] || [];

  for (const accountId of run.account_ids) {
    const state = accountStates[accountId];
    const accountInfo = accounts.find(a => a.id === accountId);
    const isSuccess = state?.currentPhase === 'done' && !state?.error;
    
    accountSummary[accountId] = {
      name: accountInfo?.name || accountId,
      phases_completed: state?.phasesCompleted || [],
      final_phase: state?.currentPhase,
      success: isSuccess,
      error: state?.error
    };

    if (isSuccess) successfulAccounts++;
    else failedAccounts++;
  }

  // Check for partial failures in steps
  const partialFailures = hasPartialFailures(stepResults);

  // Determine final status
  const hasErrors = failedAccounts > 0 || partialFailures.length > 0;
  const finalStatus = hasErrors ? 'completed_with_errors' : 'completed';

  // Print completion summary
  console.log('=== NIGHTLY SYNC COMPLETE ===');
  console.log(`Run ID: ${run.id}`);
  console.log(`Status: ${finalStatus}`);
  console.log(`Duration: ${duration} seconds (${durationMinutes} minutes)`);
  console.log(`Accounts: ${successfulAccounts} successful, ${failedAccounts} failed`);
  console.log(`Invocations used: ${run.invocation_count}/${MAX_INVOCATIONS}`);
  if (run.retry_of) {
    console.log(`This was retry #${run.retry_count} of run ${run.retry_of}`);
  }
  console.log('');
  
  if (partialFailures.length > 0) {
    console.log('Partial failures detected:');
    partialFailures.forEach(f => console.log(`  - ${f}`));
    console.log('');
  }

  console.log('Account details:');
  console.log(JSON.stringify(accountSummary, null, 2));
  console.log('');
  console.log('Step results:');
  console.log(JSON.stringify(stepResults, null, 2));

  // Save final summary
  await supabase.from('nightly_sync_runs').update({
    status: finalStatus,
    completed_at: new Date().toISOString(),
    step_results: {
      ...stepResults,
      summary: {
        duration_seconds: duration,
        duration_minutes: durationMinutes,
        accounts_total: run.account_ids.length,
        accounts_successful: successfulAccounts,
        accounts_failed: failedAccounts,
        invocations_used: run.invocation_count,
        completed_at: new Date().toISOString(),
        account_details: accountSummary,
        partial_failures: partialFailures.length > 0 ? partialFailures : undefined,
        is_retry: !!run.retry_of,
        retry_of: run.retry_of,
        retry_number: run.retry_count
      }
    },
  }).eq('id', run.id);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
}

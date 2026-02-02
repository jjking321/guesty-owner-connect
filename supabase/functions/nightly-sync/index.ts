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

    // Get all accounts with automated sync enabled
    const { data: accounts, error: accountsError } = await supabase
      .from('guesty_accounts')
      .select('id, account_name')
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
        const { error: calendarInvokeError } = await supabase.functions.invoke('sync-bulk-calendar', {
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

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n=== Nightly Sync Completed ===`);
    console.log(`Total duration: ${duration} seconds`);
    console.log(`Accounts processed: ${results.length}`);

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



# Automated Nightly Guesty Sync

## Overview

Set up automatic overnight synchronization of Guesty data so your dashboard stays up-to-date without any manual clicking. The system will run every night at 3:00 AM UTC and sync the following data types **sequentially** (each waits for the previous to complete):

1. **Properties (listings)** - New and updated property information
2. **Reservations** - Incremental booking data  
3. **Owners** - Owner-listing associations
4. **Calendar** - Pricing and availability for the next 365 days

## Verified Infrastructure

The cron functionality is **already working** in this project:

| Component | Status |
|-----------|--------|
| `pg_cron` extension | Enabled (v1.6.4) |
| `pg_net` extension | Enabled (used by existing cron job) |
| Existing cron job | `weekly-revenue-forecasts` runs Mondays at 2 AM |
| Sync functions | All have `verify_jwt = false` already set |
| Token caching | Implemented with `guesty_oauth_tokens` table |

## Sync Order and Timing

To prevent concurrent API calls and respect Guesty's rate limits, syncs run **sequentially** by polling for completion:

```text
3:00 AM UTC - Start
   |
For each Guesty account:
   +-- Sync Properties → poll sync_jobs until status = completed/failed
   +-- Sync Reservations → poll sync_jobs until status = completed/failed
   +-- Sync Owners → poll sync_jobs until status = completed/failed
   +-- Sync Calendar → poll sync_jobs until status = completed/failed
   |
~4:00-5:00 AM - Complete (varies by data volume)
```

## Implementation Steps

### Step 1: Add Tracking Columns to Database

Add two new columns to `guesty_accounts`:

```sql
ALTER TABLE guesty_accounts
ADD COLUMN IF NOT EXISTS last_automated_sync TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS automated_sync_enabled BOOLEAN DEFAULT true;
```

### Step 2: Create the Orchestrator Edge Function

Create `supabase/functions/nightly-sync/index.ts`:

**Key features:**
- Fetches all accounts with `automated_sync_enabled = true`
- For each account, invokes sync functions and polls `sync_jobs` table until completion
- Uses 10-minute timeout per sync type (configurable)
- Updates `last_automated_sync` on success
- Logs detailed results for monitoring

**Polling logic:**
```typescript
async function waitForSyncCompletion(supabase, syncType, accountId, timeoutMs = 600000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const { data: jobs } = await supabase
      .from('sync_jobs')
      .select('status, error_message')
      .eq('guesty_account_id', accountId)
      .eq('sync_type', syncType)
      .order('started_at', { ascending: false })
      .limit(1);
    
    if (jobs?.[0]?.status === 'completed') return { success: true };
    if (jobs?.[0]?.status === 'failed') return { success: false, error: jobs[0].error_message };
    
    await sleep(5000); // Poll every 5 seconds
  }
  return { success: false, error: 'Sync timed out' };
}
```

**Sync sequence:**
```typescript
// 1. Properties
await supabase.functions.invoke('sync-guesty-data', {
  body: { accountId: account.id, syncType: 'listings' }
});
await waitForSyncCompletion(supabase, 'listings', account.id);

// 2. Reservations (incremental)
await supabase.functions.invoke('sync-new-reservations', {
  body: { accountId: account.id }
});
await waitForSyncCompletion(supabase, 'new_reservations', account.id);

// 3. Owners
await supabase.functions.invoke('sync-owners', {
  body: { accountId: account.id }
});
await waitForSyncCompletion(supabase, 'owners', account.id, 120000); // 2 min timeout

// 4. Calendar
await supabase.functions.invoke('sync-bulk-calendar', {
  body: { guestyAccountId: account.id }
});
await waitForSyncCompletion(supabase, 'capacity_calendar', account.id, 900000); // 15 min timeout
```

### Step 3: Update Config

Add to `supabase/config.toml`:
```toml
[functions.nightly-sync]
verify_jwt = false
```

### Step 4: Create the Cron Job

Run this SQL in the database (via Cloud View):

```sql
SELECT cron.schedule(
  'nightly-guesty-sync',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://owsvuxxflhghlbrlhxst.supabase.co/functions/v1/nightly-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93c3Z1eHhmbGhnaGxicmxoeHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNDcwMzksImV4cCI6MjA3NDkyMzAzOX0.AqiAu-Bryv0ts9GNj-kZdnIhk9pHTIvvMLdpNr1Sidg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

### Step 5: Update Settings UI

Add a section in Settings showing:
- Last automated sync timestamp per account
- Toggle to enable/disable automated syncing
- Badge showing automation status

## Error Handling

| Scenario | Handling |
|----------|----------|
| One sync fails | Log error, continue to next sync type |
| Account has no initial reservations | Skip `sync-new-reservations`, log warning |
| Rate limit hit | Individual sync functions already handle retries |
| Sync times out | Mark as failed, continue to next |
| Job cancelled mid-sync | Functions check job status and stop gracefully |

## What You'll See After Implementation

- Data refreshes automatically every night at 3 AM UTC
- No manual clicking required
- View last automated sync time in Settings
- Enable/disable automation per account
- Check sync history in Settings for any failures

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/functions/nightly-sync/index.ts` | Create orchestrator function |
| `supabase/config.toml` | Add nightly-sync config |
| `src/pages/Settings.tsx` | Add automation status display |
| Database migration | Add `last_automated_sync` and `automated_sync_enabled` columns |


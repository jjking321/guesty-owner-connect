

# Enable pg_net Extension for Cron Jobs

## Problem

The nightly sync cron jobs have been failing with:
```
ERROR: schema "net" does not exist
```

The `pg_net` extension was never enabled when the cron jobs were originally created. This extension is required for `pg_cron` to make HTTP POST requests to trigger edge functions.

---

## Fix

Run a database migration to enable the `pg_net` extension:

```sql
-- Enable pg_net extension for HTTP requests from cron jobs
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
```

---

## Why This Happened

When cron jobs were set up, only `pg_cron` was enabled. The jobs use `net.http_post()` to call edge functions, but this function comes from `pg_net` which was never added.

---

## After Fix

| Cron Job | Schedule | Status |
|----------|----------|--------|
| `nightly-sync` | 3:00 AM UTC | Will work |
| `generate-all-forecasts` | 2:00 AM UTC | Will work |

The next scheduled run at 3:00 AM UTC should execute successfully.

---

## Verification

After enabling, you can manually trigger the nightly sync to confirm everything works:
- Call the `nightly-sync` edge function directly
- Or wait for the 3 AM UTC scheduled run


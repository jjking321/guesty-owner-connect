
Goal
- Fix the bulk reservations sync UI “loop” (0 → 3000 → 0 → 3000 …) by making progress counters monotonic across self-invocations. The sync is likely continuing correctly via offsets, but the progress counter is being overwritten by per-invocation counts.

What’s happening (root cause)
- Each self-invoked run is a fresh execution context.
- In `fetchAndSaveReservationsBatch()` we track `totalFetched` / `totalSaved` starting from 0 for that invocation.
- We then write `sync_jobs.items_synced = totalSaved` (and in the outer progress callback we also write `items_synced = saved`), so every new invocation “starts progress over” even though `skip` (offset) may be advancing.
- Result: the Settings progress card repeatedly shows 0→3000 then back to 0 on the next invocation, which looks like it’s stuck in a loop.

High-confidence fix
- Change what we store as `sync_jobs.items_synced` during reservations bulk sync to be an absolute, cumulative value that never resets.
- Best available “absolute progress” without schema changes: use the absolute processed offset:
  - `absoluteProcessed = startOffsetValue + fetchedThisInvocation`
  - or equivalently inside the fetch loop: `absoluteProcessed = skip + reservations.length` / `skip + limit` (since `skip` is initialized to `startOffsetValue`)

Implementation details

A) Backend function changes (primary fix)
File: `supabase/functions/sync-guesty-data/index.ts`

1) Treat `items_synced` as “processed so far” (monotonic) for the reservations sync
- In the progress callback (currently sets `items_synced: saved`):
  - Change to `items_synced: startOffsetValue + fetched`
  - Keep `progress_message` showing both processed and saved, e.g.:
    - `Processing: processed ${startOffsetValue + fetched}/${total ?? '?'} (saved +${savedThisInvocation})`
  - Keep `total_items: total` as-is (Guesty’s `count`).

2) Stop overwriting the job with per-invocation saved counts inside `fetchAndSaveReservationsBatch()`
Inside `fetchAndSaveReservationsBatch()` there are multiple `updateSyncJob()` calls that currently do:
- `items_synced: totalSaved`  (this resets per invocation)
Change those writes to:
- `items_synced: startOffset + totalFetched` (or `skip + limit` at save boundaries)
Keep:
- `last_synced_offset` = next offset to resume (still `skip + limit` is fine)
- `total_items` = `data.count`

Practical approach (minimal diff):
- Add a new param to `fetchAndSaveReservationsBatch()`:
  - `baseOffset: number` (or reuse `startOffset`)
- Compute `absoluteFetched = startOffset + totalFetched`
- Replace every `items_synced: totalSaved` write with `items_synced: absoluteFetched`
- Update the “Saved X reservations …” message to still show `totalSaved` but without using it for `items_synced`.

3) Fix self-invocation “handoff” update
- In the `needsContinuation` block (before `supabase.functions.invoke`), it currently writes:
  - `items_synced: totalSaved`
Change to:
  - `items_synced: nextOffset` (because `nextOffset` is the absolute processed offset we are resuming from)
  - `last_synced_offset: nextOffset` remains.

4) Fix completion update
- On completion it currently writes:
  - `items_synced: totalSaved`
Change to:
  - `items_synced: totalFetched + startOffsetValue` (or `total_items` if present)
  - Keep `last_synced_offset: 0`

5) (Optional but recommended) Respect Stop more quickly
- Add a lightweight cancellation check so the function stops soon after you press Stop:
  - On each “save batch” (every ~1000), read job status:
    - If `status !== 'running'`, exit early without self-invocation.
- This avoids burning time/API calls after a user cancellation.

B) UI improvements (secondary, makes behavior obvious)
File: `src/components/SyncProgressCard.tsx`

1) Show “Processed offset” when available
- When `syncJob.last_synced_offset` exists and job is running, display something like:
  - “Processed: {syncJob.items_synced} / {syncJob.total_items}”
  - “Resume offset: {syncJob.last_synced_offset}”
- This makes it clear that the job is advancing beyond 3000 even across self-invocations.

2) Ensure the count badge uses the same monotonic value
- Today it displays `items_synced / total_items`. After backend fix, this becomes stable.
- Optionally, label it “Processed” for reservations to reduce confusion.

Validation / Testing plan (end-to-end)
1) Start bulk “Sync Reservations” from /settings.
2) Confirm the progress badge increases past 3000 (e.g., 3000 → 6000 → 9000…) without dropping back to 0.
3) Confirm logs show increasing offsets (e.g., “Continuing … offset 3000”, then 6000, etc.).
4) Click Stop mid-run:
   - Confirm the job transitions to failed quickly and does not keep progressing.
5) Click Resume:
   - Confirm it continues from the prior `last_synced_offset` and the progress counter continues increasing (does not reset).

Why this solves the “loop”
- The “loop” is a display artifact caused by writing per-invocation counts to a single shared progress row.
- By writing absolute progress (offset-based) each time, the progress bar and counter remain monotonic and accurately reflect overall progress across self-invocations.

Files to change
- `supabase/functions/sync-guesty-data/index.ts` (required)
- `src/components/SyncProgressCard.tsx` (optional but recommended)

Risks / trade-offs
- Using offset-based “processed” counts is slightly different than “unique rows inserted,” but it matches how pagination and self-invocation work and is the most reliable monotonic progress indicator without adding new database columns.
- If Guesty returns occasional duplicates across pages (rare), “processed” may slightly over-count relative to truly unique saved rows; progress will still converge and not reset.

Deliverable
- Bulk reservations sync no longer appears stuck; progress climbs smoothly until completion, even across multiple self-invocations.



# Plan: Backend Data Migration for Review Private Notes

## Overview

Create a SQL migration to move the incorrectly mapped `response_text` data (which currently contains `private_feedback`) to the new `private_note` column for all existing reviews.

## Current State

| Column | Currently Contains | Should Contain |
|--------|-------------------|----------------|
| `response_text` | Host's private feedback | Host's public response to review |
| `private_note` | NULL (new column) | Host's private feedback |

## Migration SQL

```sql
-- Move private_feedback data from response_text to private_note
-- Then clear response_text since we don't have actual host responses

UPDATE reviews
SET 
  private_note = response_text,
  response_text = NULL,
  updated_at = NOW()
WHERE response_text IS NOT NULL;
```

## What This Does

1. Copies current `response_text` values to `private_note`
2. Sets `response_text` to NULL (since we don't have actual host public responses without re-syncing)
3. Updates the `updated_at` timestamp

## Result

After migration:
- `private_note` will contain the private feedback that was incorrectly in `response_text`
- `response_text` will be NULL (future syncs will populate it correctly with host public responses)
- No full review re-sync required

## Note

If you want to populate the actual public host responses (`response_text`), you would still need to run a review sync. But the private feedback will be correctly placed immediately.


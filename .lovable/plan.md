

# Filter Actionables to Active Properties Only

## Overview

Add a filter to exclude inactive listings from the actionables generation. Currently, 271 inactive properties are being processed along with 536 active ones.

---

## Current State

**Line 156** in `generate-actionables/index.ts`:
```typescript
.eq('archived', false)
.eq('guesty_accounts.actionables_generation_enabled', true);
```

This filters out archived listings but includes inactive listings (271 of them).

---

## Fix

Add `.eq('active', true)` to the listings query:

```typescript
.eq('archived', false)
.eq('active', true)
.eq('guesty_accounts.actionables_generation_enabled', true);
```

---

## Impact

| Metric | Before | After |
|--------|--------|-------|
| Listings processed | ~807 | ~536 |
| Inactive listings | 271 included | 0 (excluded) |
| Processing time | Higher | ~33% faster |

---

## File to Modify

| File | Change |
|------|--------|
| `supabase/functions/generate-actionables/index.ts` | Add `.eq('active', true)` filter on line 157 |


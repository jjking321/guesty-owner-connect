

# Fix Copy Goals Property List Truncation

## Problem
The "Copy Goals from Another Property" dialog in Property Settings has two queries hitting the default 1000-row limit:

1. **Listings query** (line 55): Fetches all non-composite, non-archived listings. With ~200+ properties this is close to the limit and may clip.
2. **Goals query** (line 72): Fetches all property_goals for a year. With ~200+ properties x 12 months = ~2400+ rows, this is definitely truncated at 1000, causing many properties to appear as having "no goals" and not show up as source options.

## Solution

In `src/components/CopyGoalsFromPropertyDialog.tsx`, add explicit `.limit()` calls to both queries:

- **Listings query**: Add `.limit(5000)` to ensure all properties are returned.
- **Goals query**: Add `.limit(50000)` to cover all properties x 12 months.

This follows the same pattern already used elsewhere in the codebase (documented in project memory as the standard fix for this recurring issue).

## Technical Details

| File | Lines | Change |
|------|-------|--------|
| `src/components/CopyGoalsFromPropertyDialog.tsx` | 61 | Add `.limit(5000)` before `.order("nickname")` |
| `src/components/CopyGoalsFromPropertyDialog.tsx` | 75 | Add `.limit(50000)` after `.eq("year", year)` |

Two single-line additions. No other changes needed.


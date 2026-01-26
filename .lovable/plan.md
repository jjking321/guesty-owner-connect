

## Fix: Goals Review Missing Active/Listed Filter

The Goals Review page is showing 428 properties instead of 272 because it's missing the `active` and `is_listed` filters in the listings query.

---

### Root Cause

**Current Query (GoalsReview.tsx line 27-36):**
```typescript
.from("listings")
.select("id, nickname, thumbnail")
.eq("archived", false)  // Only filters archived
```

**Bulk Goals Generator Query (line 57-61):**
```typescript
.from("listings")
.eq("active", true)      // ← Missing in GoalsReview
.eq("is_listed", true)   // ← Missing in GoalsReview  
.eq("archived", false)
```

---

### Impact

| Count | Description |
|-------|-------------|
| 428 | Listings shown on Goals Review (current) |
| 272 | Active + listed listings with goals |
| 156 | Inactive/unlisted listings showing with $0 goals |

---

### Fix

**File: `src/pages/GoalsReview.tsx` (lines 30-33)**

Add the missing filters to match the bulk goals generator:

```typescript
const { data, error } = await supabase
  .from("listings")
  .select("id, nickname, thumbnail")
  .eq("active", true)      // Add this
  .eq("is_listed", true)   // Add this
  .eq("archived", false)
  .order("nickname");
```

---

### Result

After this fix:
- Goals Review will show exactly 272 properties (matching Portfolio view)
- All displayed properties will have goals
- No more properties showing $0 when they shouldn't


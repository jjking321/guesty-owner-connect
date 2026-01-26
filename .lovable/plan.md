

## Reuse PropertySettings Popup in Goals Review Table

### Overview
Replace the navigation to property detail with the existing `PropertySettings` dialog component, which already contains the full goals editing interface.

### Changes Required

**File: `src/components/GoalsReviewTable.tsx`**

---

### 1. Update Imports

Replace navigation import with PropertySettings:

```typescript
// Remove:
import { useNavigate } from "react-router-dom";

// Add:
import { PropertySettings } from "@/components/PropertySettings";
```

---

### 2. Remove Navigate Hook

Remove the unused navigate hook from the component:

```typescript
// Remove this line:
const navigate = useNavigate();
```

---

### 3. Update Property Name Cell (lines 262-277)

Replace the navigation button with a flex container showing property name and the settings icon button:

```typescript
<TableCell className="sticky left-10 bg-background z-[1]">
  <div className="flex items-center gap-2">
    {listing.thumbnail && (
      <img
        src={listing.thumbnail}
        alt=""
        className="w-8 h-8 rounded object-cover"
      />
    )}
    <span className="font-medium text-sm whitespace-nowrap">
      {listing.nickname || listing.id}
    </span>
    <PropertySettings listingId={listing.id} />
  </div>
</TableCell>
```

---

### Summary

| Change | Description |
|--------|-------------|
| Replace imports | Remove react-router-dom, add PropertySettings |
| Remove navigate hook | Clean up unused variable |
| Update property cell | Show name as text + PropertySettings icon button |

---

### What Users Get

- Clicking the settings gear icon opens the existing Property Settings dialog
- Dialog contains full GoalsInput with AI suggestions, copy goals, and archive features
- Users stay on the Goals Review page
- No new components needed - reuses existing tested functionality


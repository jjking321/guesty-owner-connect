

# Add Platform Logos to Reviews Page

## Overview

Replace the emoji icons (🏠, 🏨, 🏖️) with official brand logos for Airbnb, VRBO, and Booking.com on the Reviews page. This affects:
- The "By Platform" section in the ReviewsSummaryAggregated component
- The "By Platform" section in the ReviewsSummary component
- The platform badge in the ReviewsTable component

---

## Changes Required

### 1. Create Icon Components for VRBO and Booking.com

Follow the existing `AirbnbIcon.tsx` pattern to create consistent, themeable SVG components.

**New Files**:
- `src/components/icons/VrboIcon.tsx` - VRBO logo as inline SVG
- `src/components/icons/BookingIcon.tsx` - Booking.com logo as inline SVG

Each component will:
- Accept className and other SVG props for flexibility
- Include accessibility attributes (role, aria-label)
- Use the official brand colors (VRBO blue, Booking.com dark blue)

### 2. Create a Unified PlatformIcon Component

Create a single component that maps platform names to their respective icons.

**New File**: `src/components/icons/PlatformIcon.tsx`

```tsx
// Maps platform source string to the appropriate brand icon
// Falls back to a generic icon for unknown platforms
<PlatformIcon platform="Airbnb" className="w-6 h-6" />
<PlatformIcon platform="VRBO" className="w-6 h-6" />
<PlatformIcon platform="Booking.com" className="w-6 h-6" />
```

Platform matching will be case-insensitive:
- "airbnb", "Airbnb" -> AirbnbIcon (color: #FF385C)
- "vrbo", "VRBO" -> VrboIcon (color: #0066CC)
- "booking", "Booking.com", "Booking.Com" -> BookingIcon (color: #003580)
- Other platforms -> A generic Building2 icon from Lucide

### 3. Update ReviewsSummaryAggregated Component

Replace the `getPlatformIcon` function that returns emojis with the new `PlatformIcon` component.

**File**: `src/components/ReviewsSummaryAggregated.tsx`

```tsx
// Before
<span className="text-2xl">{getPlatformIcon(platform.source)}</span>

// After
<PlatformIcon platform={platform.source} className="w-8 h-8" />
```

### 4. Update ReviewsSummary Component

Apply the same change to the ReviewsSummary component.

**File**: `src/components/ReviewsSummary.tsx`

```tsx
// Before
<span className="text-2xl">{getPlatformIcon(platform.source)}</span>

// After
<PlatformIcon platform={platform.source} className="w-8 h-8" />
```

### 5. Update ReviewsTable Component (Optional Enhancement)

Update the platform Badge to include the icon alongside the text.

**File**: `src/components/ReviewsTable.tsx`

```tsx
// Before
<Badge variant="outline" className="capitalize">
  {review.source}
</Badge>

// After
<Badge variant="outline" className="capitalize flex items-center gap-1.5">
  <PlatformIcon platform={review.source || ''} className="w-4 h-4" />
  {review.source}
</Badge>
```

---

## Files to Create

| File | Description |
|------|-------------|
| `src/components/icons/VrboIcon.tsx` | VRBO brand logo as React SVG component |
| `src/components/icons/BookingIcon.tsx` | Booking.com brand logo as React SVG component |
| `src/components/icons/PlatformIcon.tsx` | Unified component mapping platform names to icons |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/ReviewsSummaryAggregated.tsx` | Replace emoji with PlatformIcon component |
| `src/components/ReviewsSummary.tsx` | Replace emoji with PlatformIcon component |
| `src/components/ReviewsTable.tsx` | Add PlatformIcon to platform badge |

---

## Brand Colors Reference

- **Airbnb**: #FF385C (Rausch red)
- **VRBO**: #0066CC (Blue)
- **Booking.com**: #003580 (Dark blue)

---

## Technical Notes

- Icons use inline SVG for best performance and theming flexibility
- Each icon component uses `currentColor` by default but has hardcoded brand colors as the primary fill
- The `className` prop allows size customization (w-6 h-6, w-8 h-8, etc.)
- Case-insensitive platform matching handles variations like "VRBO", "vrbo", "Booking.Com", "Booking.com"


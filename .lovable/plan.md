

# Plan: Update Category Ratings Display

## Current Implementation

The category ratings are currently displayed as simple badges:
```tsx
<div className="mt-1 flex flex-wrap gap-2">
  {Object.entries(review.category_ratings).map(([key, value]) => (
    <Badge key={key} variant="secondary">
      {key}: {value}/5
    </Badge>
  ))}
</div>
```

## Desired Design (from reference image)

A horizontal layout with:
- Category name on top (e.g., "Cleanliness", "Accuracy")
- Rating number below (e.g., 4.6)
- Icon at the bottom
- Separated by vertical dividers
- Light gray background

## Implementation

### Icon Mapping

Map each Airbnb category to an appropriate Lucide icon:

| Category | Icon |
|----------|------|
| Cleanliness | `SprayBottle` or `Sparkles` |
| Accuracy | `CheckCircle` |
| Check-in | `KeyRound` |
| Communication | `MessageSquare` |
| Location | `Map` |
| Value | `Tag` |

### Updated Component Structure

Replace lines 272-284 in `DisputeDetailSheet.tsx`:

```tsx
{/* Category Ratings */}
{review.category_ratings && Object.keys(review.category_ratings).length > 0 && (
  <div>
    <Label className="text-sm font-medium">Category Ratings</Label>
    <div className="mt-2 flex bg-muted/50 rounded-lg p-4">
      {Object.entries(review.category_ratings).map(([key, value], index, array) => {
        const IconComponent = getCategoryIcon(key);
        return (
          <div key={key} className="flex items-center">
            <div className="flex flex-col items-center px-4 text-center">
              <span className="text-sm font-medium text-foreground">
                {formatCategoryName(key)}
              </span>
              <span className="text-sm text-muted-foreground mt-1">
                {value}
              </span>
              <IconComponent className="h-5 w-5 mt-2 text-foreground" />
            </div>
            {index < array.length - 1 && (
              <div className="h-16 w-px bg-border" />
            )}
          </div>
        );
      })}
    </div>
  </div>
)}
```

### Helper Functions

Add these helper functions to the component:

```tsx
import { 
  SprayCanIcon, // or Sparkles for cleanliness
  CheckCircle,
  KeyRound,
  MessageSquare,
  Map,
  Tag,
  HelpCircle
} from "lucide-react";

const getCategoryIcon = (category: string) => {
  const iconMap: Record<string, any> = {
    'cleanliness': SprayCanIcon,
    'accuracy': CheckCircle,
    'check-in': KeyRound,
    'checkin': KeyRound,
    'communication': MessageSquare,
    'location': Map,
    'value': Tag,
  };
  return iconMap[category.toLowerCase()] || HelpCircle;
};

const formatCategoryName = (key: string) => {
  // Convert snake_case or camelCase to Title Case
  return key
    .replace(/[-_]/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
};
```

## File to Modify

| File | Change |
|------|--------|
| `src/components/dispute/DisputeDetailSheet.tsx` | Update category ratings display with icons and vertical layout |

## Visual Result

The category ratings will display as a horizontal row with:
- Light gray background (`bg-muted/50`)
- Each category showing name, rating, and icon vertically stacked
- Vertical dividers between categories
- Responsive padding and spacing


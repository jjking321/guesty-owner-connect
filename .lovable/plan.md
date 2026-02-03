
# Add Refresh Scrape Button to Airbnb Ratings Table

## Overview

Add a refresh button to each row in the Airbnb Ratings table that allows users to manually trigger a rating scrape for an individual property. This will call the existing `scrape-airbnb-rating` edge function.

---

## UI Design

```text
| Property          | Rating | Reviews | Last Scraped | Airbnb | Action   |
|-------------------|--------|---------|--------------|--------|----------|
| 141 California #2 | ★ 4.67 | 72      | 2 hours ago  | [Link] | [↻]      |
| 402 S Orlando #3  | ★ 4.69 | 62      | 2 hours ago  | [Link] | [↻]      |
```

- A new "Action" column with a refresh icon button
- Button shows loading spinner while scraping
- Toast notification on success/failure
- Table data refreshes after successful scrape

---

## Technical Implementation

**File:** `src/components/AirbnbRatingsTable.tsx`

### Changes Required:

1. **Add imports:**
   - `useMutation`, `useQueryClient` from `@tanstack/react-query`
   - `RefreshCw`, `Loader2` from `lucide-react`
   - `Button` from ui/button
   - `useToast` hook

2. **Add mutation to call edge function:**
   ```typescript
   const queryClient = useQueryClient();
   const { toast } = useToast();
   const [scrapingId, setScrapingId] = useState<string | null>(null);
   
   const scrapeMutation = useMutation({
     mutationFn: async (listingId: string) => {
       const { data, error } = await supabase.functions.invoke('scrape-airbnb-rating', {
         body: { listingId }
       });
       if (error) throw error;
       if (!data.success) throw new Error(data.error);
       return data;
     },
     onSuccess: (data) => {
       queryClient.invalidateQueries({ queryKey: ['airbnb-ratings'] });
       toast({
         title: "Rating updated",
         description: `Rating: ${data.rating?.toFixed(2)} (${data.reviewCount} reviews)`,
       });
       setScrapingId(null);
     },
     onError: (error: Error) => {
       toast({
         title: "Scrape failed",
         description: error.message,
         variant: "destructive",
       });
       setScrapingId(null);
     },
   });
   ```

3. **Add handler function:**
   ```typescript
   const handleScrape = (listingId: string) => {
     setScrapingId(listingId);
     scrapeMutation.mutate(listingId);
   };
   ```

4. **Add new column header:**
   ```tsx
   <TableHead className="text-center">Action</TableHead>
   ```

5. **Add refresh button to each row:**
   ```tsx
   <TableCell className="text-center">
     <Button
       variant="ghost"
       size="icon"
       onClick={() => handleScrape(listing.id)}
       disabled={scrapingId === listing.id}
       title="Refresh rating"
     >
       {scrapingId === listing.id ? (
         <Loader2 className="h-4 w-4 animate-spin" />
       ) : (
         <RefreshCw className="h-4 w-4" />
       )}
     </Button>
   </TableCell>
   ```

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/AirbnbRatingsTable.tsx` | **Modify** | Add refresh button column and mutation logic |

---

## Edge Function

The existing `scrape-airbnb-rating` edge function already handles single-property scraping:
- Accepts `{ listingId }` in the request body
- Fetches the Airbnb page and extracts rating data
- Updates the `listings` table with the scraped values
- Returns `{ success, rating, reviewCount, scrapedAt }` on success



## Add Portfolio-Level Pacing Tab

### Overview
Add a tabbed interface to the Portfolio Overview page with two tabs: "Portfolio" (the current view showing the properties table and metrics summary) and "Pacing" (displaying the PacingReport component with aggregated pacing data for all properties in the portfolio).

### Current State
- The PropertiesBulkEdit page (`/properties/bulk-edit`) shows a Portfolio Overview with PropertyMetricsSummary cards, filters, and a PropertiesTable
- The OwnerDetail and GroupDetail pages already have tabs with a "Pacing" tab that uses the PacingReport component with `listingIds` prop
- PacingReport supports multi-listing views via the `listingIds` prop

### Implementation Plan

#### Update `src/pages/PropertiesBulkEdit.tsx`

**1. Add Imports:**
- Import `Tabs, TabsList, TabsTrigger, TabsContent` from the UI components
- Import `PacingReport` from `@/components/PacingReport`
- Import `Card, CardContent` for the empty state fallback

**2. Add Reservations Query:**
Fetch all reservations for active properties to pass to PacingReport:
```typescript
const { data: allReservations = [] } = useQuery({
  queryKey: ["portfolio-reservations"],
  queryFn: async () => {
    // Paginate to fetch all reservations (avoid 1000 row limit)
    const pageSize = 1000;
    let from = 0;
    const results: any[] = [];

    while (true) {
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .in("status", ["confirmed", "checked_in", "checked_out"])
        .range(from, from + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      results.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return results;
  },
});
```

**3. Wrap Content in Tabs Structure:**
- Wrap the existing content (PropertyMetricsSummary, filters, PropertiesTable) inside `TabsContent value="portfolio"`
- Add a new `TabsContent value="pacing"` with the PacingReport component
- Add TabsList with two triggers: "Portfolio" and "Pacing"

**4. Layout Adjustments:**
- Place the Tabs component after the header section
- Keep the year/month selectors and action buttons in the header (shared across tabs)
- The PropertyMetricsSummary can be shared or moved inside the Portfolio tab

### Technical Details

**Tab Structure:**
```typescript
<Tabs defaultValue="portfolio" className="space-y-6">
  <TabsList className="grid w-full max-w-[300px] grid-cols-2">
    <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
    <TabsTrigger value="pacing">Pacing</TabsTrigger>
  </TabsList>

  <TabsContent value="portfolio" className="space-y-6">
    <PropertyMetricsSummary ... />
    {/* Filters and PropertiesTable */}
  </TabsContent>

  <TabsContent value="pacing">
    {allReservations.length > 0 ? (
      <PacingReport 
        reservations={allReservations} 
        listingIds={listingIds} 
      />
    ) : (
      <Card>
        <CardContent className="text-center py-12">
          <p className="text-muted-foreground">
            No reservation data available for pacing report
          </p>
        </CardContent>
      </Card>
    )}
  </TabsContent>
</Tabs>
```

**Note on Performance:**
- The reservations query will paginate to fetch all data (similar to goals batched fetch pattern used elsewhere)
- The query runs independently and is cached by React Query
- Lazy loading: reservations only render fully when Pacing tab is selected

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/PropertiesBulkEdit.tsx` | Add Tabs, PacingReport imports; add reservations query; wrap content in tab structure |

### User Experience
1. User navigates to Portfolio Overview (`/properties/bulk-edit`)
2. Two tabs appear: "Portfolio" (default) and "Pacing"
3. Portfolio tab shows the current view with metrics summary, filters, and properties table
4. Clicking "Pacing" tab displays the PacingReport with aggregated YTD metrics across all properties
5. Users can toggle between YTD and Monthly views, see booking pace comparisons, and export CSV/PDF
6. Year and month selectors in the header remain available for both views


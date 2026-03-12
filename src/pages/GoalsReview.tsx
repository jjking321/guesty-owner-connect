import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GoalsReviewTable } from "@/components/GoalsReviewTable";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Lock, Unlock, Search, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { CopyGoalsDialog } from "@/components/CopyGoalsDialog";

interface MonthlyAverage {
  month: string;
  revenue: number;
  adr: number;
  occupancy: number;
}

export default function GoalsReview() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedListings, setSelectedListings] = useState<Set<string>>(new Set());
  const [copyGoalsOpen, setCopyGoalsOpen] = useState(false);

  // Fetch listings
  const { data: listings = [] } = useQuery({
    queryKey: ["listings-for-goals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, thumbnail")
        .eq("active", true)
        .eq("is_listed", true)
        .eq("archived", false)
        .order("nickname");
      if (error) throw error;
      return data;
    },
  });

  // Derive listing IDs for batching
  const listingIds = useMemo(() => listings.map(l => l.id), [listings]);

  // Fetch goals in batches to avoid 1000 row limit
  const { data: goals = [], refetch: refetchGoals } = useQuery({
    queryKey: ["property-goals", selectedYear, listingIds],
    enabled: listingIds.length > 0,
    queryFn: async () => {
      const BATCH_SIZE = 60; // 60 listings × 12 months = 720 rows < 1000
      const chunks: string[][] = [];
      for (let i = 0; i < listingIds.length; i += BATCH_SIZE) {
        chunks.push(listingIds.slice(i, i + BATCH_SIZE));
      }

      const promises = chunks.map((batchIds) =>
        supabase
          .from("property_goals")
          .select("*")
          .eq("year", selectedYear)
          .in("listing_id", batchIds)
      );

      const results = await Promise.all(promises);
      const all: typeof results[0]["data"] extends (infer T)[] | null ? T[] : never[] = [];
      for (const res of results) {
        if (res.error) throw res.error;
        if (res.data) all.push(...res.data);
      }

      console.log("Goals batched fetch:", {
        batches: chunks.length,
        listingCount: listingIds.length,
        goalsCount: all.length,
      });

      return all;
    },
  });

  // Fetch historical actuals using existing RPC (12 parallel calls for each month)
  const { data: historicalActuals = [] } = useQuery({
    queryKey: ["historical-actuals-rpc", selectedYear - 1],
    queryFn: async () => {
      const priorYear = selectedYear - 1;
      
      // Call RPC for each month in parallel
      const monthPromises = Array.from({ length: 12 }, (_, i) => 
        supabase.rpc('get_portfolio_night_metrics', {
          p_year: priorYear,
          p_month: i + 1
        })
      );
      
      const results = await Promise.all(monthPromises);
      
      // Combine results with month info
      const all: Array<{ listing_id: string; month: number; revenue: number }> = [];
      results.forEach((res, idx) => {
        if (res.error) throw res.error;
        res.data?.forEach((row: { listing_id: string; actual_revenue: number }) => {
          all.push({
            listing_id: row.listing_id,
            month: idx + 1,
            revenue: Number(row.actual_revenue) || 0
          });
        });
      });
      
      return all;
    },
  });

  // Fetch compset averages
  const { data: compsetSummaries = [] } = useQuery({
    queryKey: ["compset-summaries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_compset_summary")
        .select("listing_id, monthly_averages");
      if (error) throw error;
      return data;
    },
  });

  // Process historical actuals by listing and month (already aggregated from RPC)
  const historicalByListingMonth = useMemo(() => {
    const result: Record<string, Record<number, number>> = {};
    
    historicalActuals.forEach((row) => {
      if (!result[row.listing_id]) {
        result[row.listing_id] = {};
      }
      result[row.listing_id][row.month] = row.revenue;
    });
    
    return result;
  }, [historicalActuals]);

  // Process compset averages by listing and month
  const compsetByListingMonth = useMemo(() => {
    const result: Record<string, Record<number, number>> = {};
    
    compsetSummaries.forEach((summary) => {
      if (summary.monthly_averages && Array.isArray(summary.monthly_averages)) {
        result[summary.listing_id] = {};
        (summary.monthly_averages as unknown as MonthlyAverage[]).forEach((avg) => {
          const monthNum = new Date(`${avg.month}-01`).getMonth() + 1;
          result[summary.listing_id][monthNum] = avg.revenue || 0;
        });
      }
    });
    
    return result;
  }, [compsetSummaries]);

  // Filter listings by search
  const filteredListings = useMemo(() => {
    if (!searchQuery) return listings;
    const query = searchQuery.toLowerCase();
    return listings.filter((l) => l.nickname?.toLowerCase().includes(query));
  }, [listings, searchQuery]);

  // Calculate totals
  const totals = useMemo(() => {
    let totalGoals = 0;
    let totalLastYear = 0;

    filteredListings.forEach((listing) => {
      // Sum goals for this listing
      const listingGoals = goals.filter((g) => g.listing_id === listing.id);
      listingGoals.forEach((g) => {
        totalGoals += g.projection_revenue || 0;
      });

      // Sum last year actuals
      const lyData = historicalByListingMonth[listing.id] || {};
      Object.values(lyData).forEach((val) => {
        totalLastYear += val;
      });
    });

    const percentChange = totalLastYear > 0 ? ((totalGoals - totalLastYear) / totalLastYear) * 100 : 0;

    return { totalGoals, totalLastYear, percentChange };
  }, [filteredListings, goals, historicalByListingMonth]);

  // Bulk lock/unlock
  const handleBulkLock = async (lock: boolean) => {
    if (selectedListings.size === 0) {
      toast({ title: "No properties selected", description: "Please select properties to lock/unlock", variant: "destructive" });
      return;
    }

    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;

    const { error } = await supabase
      .from("property_goals")
      .update({
        locked: lock,
        locked_at: lock ? new Date().toISOString() : null,
        locked_by: lock ? userId : null,
      })
      .eq("year", selectedYear)
      .in("listing_id", Array.from(selectedListings));

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: lock ? "Goals Locked" : "Goals Unlocked", description: `${selectedListings.size} properties updated` });
      refetchGoals();
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ["Property", "Jan Goal", "Jan LY", "Jan Comp", "Feb Goal", "Feb LY", "Feb Comp", "Mar Goal", "Mar LY", "Mar Comp", "Apr Goal", "Apr LY", "Apr Comp", "May Goal", "May LY", "May Comp", "Jun Goal", "Jun LY", "Jun Comp", "Jul Goal", "Jul LY", "Jul Comp", "Aug Goal", "Aug LY", "Aug Comp", "Sep Goal", "Sep LY", "Sep Comp", "Oct Goal", "Oct LY", "Oct Comp", "Nov Goal", "Nov LY", "Nov Comp", "Dec Goal", "Dec LY", "Dec Comp", "Total Goal", "Total LY"];
    
    const rows = filteredListings.map((listing) => {
      const listingGoals = goals.filter((g) => g.listing_id === listing.id);
      const lyData = historicalByListingMonth[listing.id] || {};
      const compData = compsetByListingMonth[listing.id] || {};
      
      const row: (string | number)[] = [listing.nickname || listing.id];
      let totalGoal = 0;
      let totalLY = 0;

      for (let m = 1; m <= 12; m++) {
        const goal = listingGoals.find((g) => g.month === m)?.projection_revenue || 0;
        const ly = lyData[m] || 0;
        const comp = compData[m] || 0;
        row.push(goal, ly, comp);
        totalGoal += goal;
        totalLY += ly;
      }

      row.push(totalGoal, totalLY);
      return row;
    });

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goals-review-${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Goals Review</h1>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-8 text-sm">
              <div>
                <span className="text-muted-foreground">Total Goals:</span>{" "}
                <span className="font-semibold">${totals.totalGoals.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Last Year:</span>{" "}
                <span className="font-semibold">${totals.totalLastYear.toLocaleString()}</span>
              </div>
              <div>
                <span className={totals.percentChange >= 0 ? "text-green-600" : "text-red-600"}>
                  {totals.percentChange >= 0 ? "+" : ""}{totals.percentChange.toFixed(1)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search properties..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleBulkLock(true)} disabled={selectedListings.size === 0}>
            <Lock className="h-4 w-4 mr-2" />
            Lock Selected
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleBulkLock(false)} disabled={selectedListings.size === 0}>
            <Unlock className="h-4 w-4 mr-2" />
            Unlock Selected
          </Button>
        </div>

        {/* Table */}
        <GoalsReviewTable
          listings={filteredListings}
          goals={goals}
          historicalByListingMonth={historicalByListingMonth}
          compsetByListingMonth={compsetByListingMonth}
          selectedYear={selectedYear}
          selectedListings={selectedListings}
          onSelectionChange={setSelectedListings}
          onGoalsSaved={refetchGoals}
        />
      </div>
    </DashboardLayout>
  );
}

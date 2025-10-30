import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PropertiesTable } from "@/components/PropertiesTable";
import { PropertyMetricsSummary } from "@/components/PropertyMetricsSummary";
import { BulkGoalsUpload } from "@/components/BulkGoalsUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Download, Search, Sparkles, Filter, ArrowUpDown, ArrowUp, ArrowDown, Upload } from "lucide-react";
import { toast } from "sonner";
import { type NavigationReferrer } from "@/hooks/useSmartNavigation";

interface PropertyMetrics {
  id: string;
  nickname: string;
  thumbnail: string | null;
  address: any;
  propertyType: string | null;
  actualRevenue: number;
  budgetTotal: number;
  projectionTotal: number;
  goalTotal: number;
  forecastedRevenue: number;
  forecastUpdatedAt: string | null;
  budgetAchievement: number;
  projectionAchievement: number;
  goalAchievement: number;
  forecastBudgetAchievement: number;
  forecastProjectionAchievement: number;
  forecastGoalAchievement: number;
  status: "on-track" | "at-risk" | "behind";
  hasGoals: boolean;
  hasLockedGoals: boolean;
  goalsLockedCount: number;
  archived: boolean;
}

export default function PropertiesBulkEdit() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [searchQuery, setSearchQuery] = useState("");
  const [propertyFilters, setPropertyFilters] = useState({
    active: true,
    inactive: false,
    listed: true,
    unlisted: false,
    archived: false,
  });
  const [statusFilters, setStatusFilters] = useState({
    onTrack: true,
    atRisk: true,
    behind: true,
  });
  const [goalsFilters, setGoalsFilters] = useState({
    hasGoals: true,
    noGoals: true,
    locked: true,
    unlocked: true,
  });
  const [isGeneratingBulk, setIsGeneratingBulk] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "actual" | "forecast" | "goalProgress" | "status">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);

  // Fetch all data in parallel
  const { data: listings = [], isLoading: listingsLoading, refetch: refetchListings } = useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("*");
      if (error) throw error;
      return data;
    },
  });

  // Derived: listing IDs for scoping goals query and avoiding pagination truncation
  const listingIds: string[] = useMemo(() => listings.map((l: any) => String(l.id)), [listings]);

  const { data: ytdRevenueData = [], isLoading: ytdRevenueLoading } = useQuery({
    queryKey: ["ytd-revenue", selectedYear],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const endDate = selectedYear === new Date().getFullYear() ? today : `${selectedYear}-12-31`;
      const { data, error } = await supabase
        .rpc("get_ytd_revenue_by_listing", {
          target_year: selectedYear,
          end_date: endDate
        });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: goals = [], isLoading: goalsLoading, refetch: refetchGoals } = useQuery({
    queryKey: ["property_goals", selectedYear, listingIds],
    enabled: listingIds.length > 0,
    queryFn: async () => {
      // Fetch in batches to avoid the 1000 row cap per request
      const BATCH_SIZE = 60; // 60 listings * 12 months = 720 rows < 1000
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
          .order("listing_id", { ascending: true })
          .order("month", { ascending: true })
      );

      const results = await Promise.all(promises);
      const all: any[] = [];
      for (const res of results) {
        if (res.error) throw res.error;
        if (res.data) all.push(...res.data);
      }

      console.log("Goals batched fetch", {
        batches: chunks.length,
        listingCount: listingIds.length,
        goalsCount: all.length,
        expectedMax: listingIds.length * 12,
      });

      return all;
    },
  });

  // Fast lookup: goals grouped by listing_id
  const goalsByListing = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const g of goals) {
      const key = String((g as any).listing_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return map;
  }, [goals]);

  const { data: forecasts = [], isLoading: forecastsLoading } = useQuery({
    queryKey: ["revenue_forecasts", selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_forecasts")
        .select("*")
        .eq("year", selectedYear);
      if (error) throw error;
      return data;
    },
  });

  // Realtime: refetch goals when new rows for the selected year are inserted/updated
  useEffect(() => {
    const channel = supabase
      .channel('property_goals_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'property_goals' },
        (payload) => {
          const yr = (payload.new as any)?.year ?? (payload.old as any)?.year;
          if (yr === selectedYear) {
            refetchGoals();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedYear, refetchGoals]);
  // Calculate metrics for each property
  const propertyMetrics = useMemo(() => {
    if (!listings.length) return [];

    // Create a map of listing_id to YTD revenue
    const revenueMap = new Map(
      ytdRevenueData.map((item: any) => [item.listing_id, Number(item.total_revenue) || 0])
    );

    return listings.map((listing): PropertyMetrics => {
      // Get actual revenue from the aggregated data
      const actualRevenue = revenueMap.get(listing.id) || 0;

      // Calculate annual goals using precomputed map
      const listingGoals = goalsByListing.get(String(listing.id)) || [];
      
      // Debug logging for specific property
      if (listing.nickname === "104 W Leon - Full") {
        console.log("🔍 Debug '104 W Leon - Full' listingGoals", {
          listing_id: listing.id,
          total_goals_fetched: goals.length,
          listingGoalsCount: listingGoals.length,
          sample: (listingGoals as any[]).slice(0, 3).map((g: any) => ({ month: g.month, budget: g.budget_revenue, projection: g.projection_revenue, goal: g.goal_revenue })),
        });
      }
      const budgetTotal = listingGoals.reduce(
        (sum, g) => sum + (Number(g.budget_revenue) || 0),
        0
      );
      const projectionTotal = listingGoals.reduce(
        (sum, g) => sum + (Number(g.projection_revenue) || 0),
        0
      );
      const goalTotal = listingGoals.reduce(
        (sum, g) => sum + (Number(g.goal_revenue) || 0),
        0
      );

      // Get forecast
      const forecast = forecasts.find((f) => f.listing_id === listing.id);
      const totalForecast = forecast?.total_forecast as { p50?: number } | null;
      const forecastedRevenue = totalForecast?.p50 || 0;
      const forecastUpdatedAt = forecast?.generated_at || null;

      // Calculate achievement percentages
      const budgetAchievement = budgetTotal > 0 ? (actualRevenue / budgetTotal) * 100 : 0;
      const projectionAchievement = projectionTotal > 0 ? (actualRevenue / projectionTotal) * 100 : 0;
      const goalAchievement = goalTotal > 0 ? (actualRevenue / goalTotal) * 100 : 0;

      // Calculate forecast achievement percentages
      const forecastBudgetAchievement = budgetTotal > 0 ? (forecastedRevenue / budgetTotal) * 100 : 0;
      const forecastProjectionAchievement = projectionTotal > 0 ? (forecastedRevenue / projectionTotal) * 100 : 0;
      const forecastGoalAchievement = projectionTotal > 0 ? (forecastedRevenue / projectionTotal) * 100 : 0;

      // Determine status based on forecast vs projection
      let status: "on-track" | "at-risk" | "behind" = "on-track";
      if (projectionTotal > 0) {
        if (forecastProjectionAchievement >= 95) status = "on-track";
        else if (forecastProjectionAchievement >= 80) status = "at-risk";
        else status = "behind";
      }

      // Calculate goal lock status
      const hasGoals = goalTotal > 0;
      const hasLockedGoals = listingGoals.some(g => g.locked);
      const goalsLockedCount = listingGoals.filter(g => g.locked).length;

      return {
        id: listing.id,
        nickname: listing.nickname || "Unnamed Property",
        thumbnail: listing.thumbnail,
        address: listing.address,
        propertyType: listing.property_type,
        actualRevenue,
        budgetTotal,
        projectionTotal,
        goalTotal,
        forecastedRevenue,
        forecastUpdatedAt,
        budgetAchievement,
        projectionAchievement,
        goalAchievement,
        forecastBudgetAchievement,
        forecastProjectionAchievement,
        forecastGoalAchievement,
        status,
        hasGoals,
        hasLockedGoals,
        goalsLockedCount,
        archived: listing.archived || false,
      };
    });
  }, [listings, ytdRevenueData, goals, forecasts]);

  // Filter and sort properties
  const filteredProperties = useMemo(() => {
    const filtered = propertyMetrics.filter((property) => {
      // Get the listing to check property filters
      const listing = listings.find(l => l.id === property.id);
      if (!listing) return false;

      // Property status filters
      const activeMatch = (propertyFilters.active && listing.active) || 
                         (propertyFilters.inactive && !listing.active);
      const listedMatch = (propertyFilters.listed && listing.is_listed) || 
                         (propertyFilters.unlisted && !listing.is_listed);
      const archivedMatch = (propertyFilters.archived && listing.archived) || 
                           (!propertyFilters.archived && !listing.archived);
      
      const hasPropertyFilter = propertyFilters.active || propertyFilters.inactive;
      const hasListedFilter = propertyFilters.listed || propertyFilters.unlisted;
      
      const propertyStatusMatch = 
        (!hasPropertyFilter || activeMatch) &&
        (!hasListedFilter || listedMatch) &&
        archivedMatch;

      // Performance status filters
      const hasStatusFilter = statusFilters.onTrack || statusFilters.atRisk || statusFilters.behind;
      const statusMatch = !hasStatusFilter || 
        (statusFilters.onTrack && property.status === "on-track") ||
        (statusFilters.atRisk && property.status === "at-risk") ||
        (statusFilters.behind && property.status === "behind");

      // Goals filters
      const hasGoalsFilter = goalsFilters.hasGoals || goalsFilters.noGoals || goalsFilters.locked || goalsFilters.unlocked;
      
      let goalsMatch = true;
      if (hasGoalsFilter) {
        goalsMatch = 
          (goalsFilters.noGoals && !property.hasGoals) ||
          (goalsFilters.hasGoals && property.hasGoals && !property.hasLockedGoals) ||
          (goalsFilters.locked && property.hasLockedGoals) ||
          (goalsFilters.unlocked && property.hasGoals && !property.hasLockedGoals);
      }

      // Search filter
      const matchesSearch = property.nickname
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      
      return propertyStatusMatch && statusMatch && goalsMatch && matchesSearch;
    });

    // Apply sorting
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case "name":
          comparison = a.nickname.localeCompare(b.nickname);
          break;
        case "actual":
          comparison = a.actualRevenue - b.actualRevenue;
          break;
        case "forecast":
          comparison = a.forecastedRevenue - b.forecastedRevenue;
          break;
        case "goalProgress":
          comparison = a.projectionAchievement - b.projectionAchievement;
          break;
        case "status":
          const statusOrder = { "behind": 0, "at-risk": 1, "on-track": 2 };
          comparison = statusOrder[a.status] - statusOrder[b.status];
          break;
      }
      
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [propertyMetrics, listings, searchQuery, propertyFilters, statusFilters, goalsFilters, sortBy, sortDirection]);

  // Calculate portfolio totals
  const portfolioTotals = useMemo(() => {
    return propertyMetrics.reduce(
      (acc, property) => ({
        actualRevenue: acc.actualRevenue + property.actualRevenue,
        budgetTotal: acc.budgetTotal + property.budgetTotal,
        projectionTotal: acc.projectionTotal + property.projectionTotal,
        goalTotal: acc.goalTotal + property.goalTotal,
        forecastedRevenue: acc.forecastedRevenue + property.forecastedRevenue,
      }),
      {
        actualRevenue: 0,
        budgetTotal: 0,
        projectionTotal: 0,
        goalTotal: 0,
        forecastedRevenue: 0,
      }
    );
  }, [propertyMetrics]);

  const handleRefreshForecasts = async () => {
    toast.info("Starting forecast generation for all properties...");
    try {
      const { data, error } = await supabase.functions.invoke("generate-all-forecasts");
      if (error) throw error;
      
      const estimatedMinutes = data?.estimated_duration_minutes || 20;
      toast.success(
        `Forecast generation started in background for ${data?.total_properties || 0} properties (${data?.total_forecasts || 0} forecasts). ` +
        `This may take ${estimatedMinutes}-${estimatedMinutes + 10} minutes. Please refresh the page after waiting.`
      );
    } catch (error) {
      console.error("Error generating forecasts:", error);
      toast.error("Failed to start forecast generation");
    }
  };

  const handleGenerateMissingForecasts = async () => {
    toast.info("Checking for properties missing forecasts...");
    try {
      const { data, error } = await supabase.functions.invoke('generate-missing-forecasts');
      
      if (error) throw error;
      
      const propertiesCount = data?.properties_processed || 0;
      const estimatedMinutes = data?.estimated_duration_minutes || 0;
      
      if (propertiesCount === 0) {
        toast.success("All properties already have forecasts for the current and next year.");
      } else {
        toast.success(
          `Forecast generation started for ${propertiesCount} properties missing forecasts. ` +
          `Estimated time: ~${estimatedMinutes} minutes. Please refresh after waiting.`
        );
      }
    } catch (error: any) {
      console.error('Error generating missing forecasts:', error);
      toast.error(error.message || "Failed to start forecast generation");
    }
  };

  const handleGenerateBulkGoals = async () => {
    setIsGeneratingBulk(true);
    toast.info("Starting goal generation for all properties... This will run in the background and may take several minutes.");
    try {
      const { data, error } = await supabase.functions.invoke('generate-bulk-goals', {
        body: { year: selectedYear, excludeLocked: true }
      });

      if (error) throw error;

      toast.success(`Goal generation started for ${data.totalProperties} properties. Please refresh in a few minutes to see results.`);
    } catch (error: any) {
      console.error("Error starting goal generation:", error);
      toast.error(error.message || "Failed to start goal generation");
    } finally {
      setIsGeneratingBulk(false);
    }
  };

  const handleGenerateMissingGoals = async () => {
    setIsGeneratingBulk(true);
    toast.info("Starting goal generation for properties without goals... This will run in the background.");
    try {
      const { data, error } = await supabase.functions.invoke('generate-bulk-goals', {
        body: { year: selectedYear, onlyMissingGoals: true }
      });

      if (error) throw error;

      toast.success(`Goal generation started for ${data.totalProperties} properties without goals. Please refresh in a few minutes to see results.`);
    } catch (error: any) {
      console.error("Error starting goal generation:", error);
      toast.error(error.message || "Failed to start goal generation");
    } finally {
      setIsGeneratingBulk(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredProperties.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProperties.map(p => p.id)));
    }
  };

  const handleSelectProperty = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkArchive = async (archive: boolean) => {
    const idsArray = Array.from(selectedIds);
    
    const { error } = await supabase
      .from("listings")
      .update({ archived: archive })
      .in("id", idsArray);

    if (error) {
      toast.error("Failed to update properties", {
        description: error.message,
      });
      return;
    }

    toast.success(
      archive ? "Properties archived" : "Properties restored",
      {
        description: `${idsArray.length} ${idsArray.length === 1 ? 'property' : 'properties'} ${archive ? 'archived' : 'restored'} successfully.`,
      }
    );

    setSelectedIds(new Set());
    refetchListings();
  };

  const handleExportCSV = () => {
    const headers = [
      "Property",
      "Type",
      "Location",
      "Actual Revenue",
      "Budget",
      "Projection",
      "Goal",
      "Forecast",
      "Budget Achievement %",
      "Projection Achievement %",
      "Goal Achievement %",
      "Status",
    ];
    
    const rows = filteredProperties.map((p) => [
      p.nickname,
      p.propertyType || "",
      p.address?.city || "",
      p.actualRevenue.toFixed(2),
      p.budgetTotal.toFixed(2),
      p.projectionTotal.toFixed(2),
      p.goalTotal.toFixed(2),
      p.forecastedRevenue.toFixed(2),
      p.budgetAchievement.toFixed(1),
      p.projectionAchievement.toFixed(1),
      p.goalAchievement.toFixed(1),
      p.status,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `properties-bulk-${selectedYear}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const isLoading = listingsLoading || ytdRevenueLoading || goalsLoading || forecastsLoading;

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDirection("asc");
    }
  };

  const SortButton = ({ field, label }: { field: typeof sortBy; label: string }) => {
    const isActive = sortBy === field;
    const Icon = isActive ? (sortDirection === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    
    return (
      <Button
        variant={isActive ? "default" : "outline"}
        size="sm"
        onClick={() => handleSort(field)}
      >
        {label}
        <Icon className="ml-2 h-4 w-4" />
      </Button>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-bold">Portfolio Overview</h1>
              <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(parseInt(value))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={currentYear.toString()}>{currentYear}</SelectItem>
                  <SelectItem value={(currentYear + 1).toString()}>{currentYear + 1}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground">
              View and compare revenue metrics across all properties
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => setIsBulkUploadOpen(true)}
              variant="default"
              size="sm"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Projections from CSV
            </Button>
            <Button 
              onClick={handleGenerateMissingGoals} 
              variant="outline"
              size="sm"
              disabled={isGeneratingBulk}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {isGeneratingBulk ? "Generating..." : "Generate Missing Goals"}
            </Button>
            <Button 
              onClick={handleGenerateBulkGoals} 
              variant="outline"
              size="sm"
              disabled={isGeneratingBulk}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {isGeneratingBulk ? "Generating..." : "Regenerate All"}
            </Button>
            <Button onClick={handleGenerateMissingForecasts} variant="outline" size="sm">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Missing Forecasts
            </Button>
            <Button onClick={handleRefreshForecasts} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh All Forecasts
            </Button>
            <Button onClick={handleExportCSV} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        <PropertyMetricsSummary
          totalActualRevenue={portfolioTotals.actualRevenue}
          totalBudget={portfolioTotals.budgetTotal}
          totalProjection={portfolioTotals.projectionTotal}
          totalGoal={portfolioTotals.goalTotal}
          totalForecast={portfolioTotals.forecastedRevenue}
          propertiesCount={propertyMetrics.length}
          onTrackCount={propertyMetrics.filter((p) => p.status === "on-track").length}
          atRiskCount={propertyMetrics.filter((p) => p.status === "at-risk").length}
          behindCount={propertyMetrics.filter((p) => p.status === "behind").length}
        />

        <div className="space-y-3">
          <div className="flex gap-3 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search properties..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="relative">
                  <Filter className="mr-2 h-4 w-4" />
                  Property Filters
                  {(() => {
                    const count = Object.values(propertyFilters).filter(Boolean).length;
                    return count > 0 ? (
                      <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center" variant="secondary">
                        {count}
                      </Badge>
                    ) : null;
                  })()}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 z-50 bg-popover" align="end">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-3">Status</h4>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="prop-active"
                          checked={propertyFilters.active}
                          onCheckedChange={(checked) =>
                            setPropertyFilters({ ...propertyFilters, active: checked as boolean })
                          }
                        />
                        <label htmlFor="prop-active" className="text-sm cursor-pointer">
                          Active
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="prop-inactive"
                          checked={propertyFilters.inactive}
                          onCheckedChange={(checked) =>
                            setPropertyFilters({ ...propertyFilters, inactive: checked as boolean })
                          }
                        />
                        <label htmlFor="prop-inactive" className="text-sm cursor-pointer">
                          Inactive
                        </label>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-3">Listing</h4>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="prop-listed"
                          checked={propertyFilters.listed}
                          onCheckedChange={(checked) =>
                            setPropertyFilters({ ...propertyFilters, listed: checked as boolean })
                          }
                        />
                        <label htmlFor="prop-listed" className="text-sm cursor-pointer">
                          Listed
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="prop-unlisted"
                          checked={propertyFilters.unlisted}
                          onCheckedChange={(checked) =>
                            setPropertyFilters({ ...propertyFilters, unlisted: checked as boolean })
                          }
                        />
                        <label htmlFor="prop-unlisted" className="text-sm cursor-pointer">
                          Unlisted
                        </label>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-3">Archive</h4>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="prop-archived"
                          checked={propertyFilters.archived}
                          onCheckedChange={(checked) =>
                            setPropertyFilters({ ...propertyFilters, archived: checked as boolean })
                          }
                        />
                        <label htmlFor="prop-archived" className="text-sm cursor-pointer">
                          Show Archived
                        </label>
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      setPropertyFilters({
                        active: true,
                        inactive: false,
                        listed: true,
                        unlisted: false,
                        archived: false,
                      })
                    }
                  >
                    Reset
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="relative">
                  <Filter className="mr-2 h-4 w-4" />
                  Performance
                  {(() => {
                    const count = Object.values(statusFilters).filter(Boolean).length;
                    return count > 0 && count < 3 ? (
                      <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center" variant="secondary">
                        {count}
                      </Badge>
                    ) : null;
                  })()}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 z-50 bg-popover" align="end">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-3">Status</h4>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="status-ontrack"
                          checked={statusFilters.onTrack}
                          onCheckedChange={(checked) =>
                            setStatusFilters({ ...statusFilters, onTrack: checked as boolean })
                          }
                        />
                        <label htmlFor="status-ontrack" className="text-sm cursor-pointer">
                          On Track
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="status-atrisk"
                          checked={statusFilters.atRisk}
                          onCheckedChange={(checked) =>
                            setStatusFilters({ ...statusFilters, atRisk: checked as boolean })
                          }
                        />
                        <label htmlFor="status-atrisk" className="text-sm cursor-pointer">
                          At Risk
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="status-behind"
                          checked={statusFilters.behind}
                          onCheckedChange={(checked) =>
                            setStatusFilters({ ...statusFilters, behind: checked as boolean })
                          }
                        />
                        <label htmlFor="status-behind" className="text-sm cursor-pointer">
                          Behind
                        </label>
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      setStatusFilters({
                        onTrack: true,
                        atRisk: true,
                        behind: true,
                      })
                    }
                  >
                    Reset
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="relative">
                  <Filter className="mr-2 h-4 w-4" />
                  Goals
                  {(() => {
                    const count = Object.values(goalsFilters).filter(Boolean).length;
                    return count > 0 && count < 4 ? (
                      <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center" variant="secondary">
                        {count}
                      </Badge>
                    ) : null;
                  })()}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 z-50 bg-popover" align="end">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-3">Goal Status</h4>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="goals-has"
                          checked={goalsFilters.hasGoals}
                          onCheckedChange={(checked) =>
                            setGoalsFilters({ ...goalsFilters, hasGoals: checked as boolean })
                          }
                        />
                        <label htmlFor="goals-has" className="text-sm cursor-pointer">
                          Has Goals
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="goals-none"
                          checked={goalsFilters.noGoals}
                          onCheckedChange={(checked) =>
                            setGoalsFilters({ ...goalsFilters, noGoals: checked as boolean })
                          }
                        />
                        <label htmlFor="goals-none" className="text-sm cursor-pointer">
                          No Goals
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="goals-locked"
                          checked={goalsFilters.locked}
                          onCheckedChange={(checked) =>
                            setGoalsFilters({ ...goalsFilters, locked: checked as boolean })
                          }
                        />
                        <label htmlFor="goals-locked" className="text-sm cursor-pointer">
                          Locked
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="goals-unlocked"
                          checked={goalsFilters.unlocked}
                          onCheckedChange={(checked) =>
                            setGoalsFilters({ ...goalsFilters, unlocked: checked as boolean })
                          }
                        />
                        <label htmlFor="goals-unlocked" className="text-sm cursor-pointer">
                          Unlocked
                        </label>
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      setGoalsFilters({
                        hasGoals: true,
                        noGoals: true,
                        locked: true,
                        unlocked: true,
                      })
                    }
                  >
                    Reset
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          
          <p className="text-sm text-muted-foreground">
            Showing {filteredProperties.length} of {propertyMetrics.length} {propertyMetrics.length === 1 ? 'property' : 'properties'}
          </p>
        </div>

        {/* Bulk Actions Toolbar */}
        {selectedIds.size > 0 && (
          <div className="sticky top-0 z-10 bg-card border rounded-lg p-4 shadow-md">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-base px-3 py-1">
                  {selectedIds.size} {selectedIds.size === 1 ? 'property' : 'properties'} selected
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear Selection
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkArchive(false)}
                  disabled={Array.from(selectedIds).every(id => {
                    const prop = propertyMetrics.find(p => p.id === id);
                    return !prop?.archived;
                  })}
                >
                  Restore Selected
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleBulkArchive(true)}
                  disabled={Array.from(selectedIds).every(id => {
                    const prop = propertyMetrics.find(p => p.id === id);
                    return prop?.archived;
                  })}
                >
                  Archive Selected
                </Button>
              </div>
            </div>
          </div>
        )}

        <PropertiesTable 
          properties={filteredProperties} 
          isLoading={isLoading}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={handleSort}
          selectable={true}
          selectedIds={selectedIds}
          onSelectProperty={handleSelectProperty}
          onSelectAll={handleSelectAll}
          referrer={{
            path: '/properties/bulk-edit',
            label: 'Portfolio View',
            state: {
              searchQuery,
              filters: { propertyFilters, statusFilters, goalsFilters },
              sortBy,
              sortDirection,
              scrollPosition: window.scrollY
            }
          }}
        />

        <BulkGoalsUpload 
          open={isBulkUploadOpen} 
          onOpenChange={setIsBulkUploadOpen}
          onSuccess={() => {
            refetchGoals();
            refetchListings();
          }}
        />
      </div>
    </DashboardLayout>
  );
}

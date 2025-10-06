import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PropertiesTable } from "@/components/PropertiesTable";
import { PropertyMetricsSummary } from "@/components/PropertyMetricsSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Download, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

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
}

export default function PropertiesBulkEdit() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [goalsFilter, setGoalsFilter] = useState<string>("all");
  const [isGeneratingBulk, setIsGeneratingBulk] = useState(false);

  // Fetch all data in parallel
  const { data: listings = [], isLoading: listingsLoading } = useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .eq("active", true)
        .eq("is_listed", true);
      if (error) throw error;
      return data;
    },
  });

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

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ["property_goals", selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_goals")
        .select("*")
        .eq("year", selectedYear);
      if (error) throw error;
      return data;
    },
  });

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

      // Calculate annual goals
      const listingGoals = goals.filter((g) => g.listing_id === listing.id);
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
      const forecastGoalAchievement = goalTotal > 0 ? (forecastedRevenue / goalTotal) * 100 : 0;

      // Determine status based on forecast vs goal
      let status: "on-track" | "at-risk" | "behind" = "on-track";
      if (goalTotal > 0) {
        if (forecastGoalAchievement >= 95) status = "on-track";
        else if (forecastGoalAchievement >= 80) status = "at-risk";
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
      };
    });
  }, [listings, ytdRevenueData, goals, forecasts]);

  // Filter properties
  const filteredProperties = useMemo(() => {
    return propertyMetrics.filter((property) => {
      const matchesSearch = property.nickname
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || property.status === statusFilter;
      
      const matchesGoals = 
        goalsFilter === 'all' ? true :
        goalsFilter === 'no-goals' ? !property.hasGoals :
        goalsFilter === 'unlocked' ? property.hasGoals && !property.hasLockedGoals :
        goalsFilter === 'locked' ? property.hasLockedGoals : true;
      
      return matchesSearch && matchesStatus && matchesGoals;
    });
  }, [propertyMetrics, searchQuery, statusFilter, goalsFilter]);

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
    toast.info("Generating forecasts for all properties...");
    try {
      const { error } = await supabase.functions.invoke("generate-all-forecasts");
      if (error) throw error;
      toast.success("Forecasts generated successfully!");
      // Refetch forecasts
      window.location.reload();
    } catch (error) {
      console.error("Error generating forecasts:", error);
      toast.error("Failed to generate forecasts");
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
              onClick={handleGenerateBulkGoals} 
              variant="default"
              size="sm"
              disabled={isGeneratingBulk}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {isGeneratingBulk ? "Generating..." : "Generate Goals for All"}
            </Button>
            <Button onClick={handleRefreshForecasts} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Forecasts
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

        <div className="flex gap-4 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search properties..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("all")}
            >
              All Status
            </Button>
            <Button
              variant={statusFilter === "on-track" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("on-track")}
            >
              On Track
            </Button>
            <Button
              variant={statusFilter === "at-risk" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("at-risk")}
            >
              At Risk
            </Button>
            <Button
              variant={statusFilter === "behind" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("behind")}
            >
              Behind
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant={goalsFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setGoalsFilter("all")}
            >
              All Properties
            </Button>
            <Button
              variant={goalsFilter === "no-goals" ? "default" : "outline"}
              size="sm"
              onClick={() => setGoalsFilter("no-goals")}
            >
              No Goals
            </Button>
            <Button
              variant={goalsFilter === "unlocked" ? "default" : "outline"}
              size="sm"
              onClick={() => setGoalsFilter("unlocked")}
            >
              Unlocked
            </Button>
            <Button
              variant={goalsFilter === "locked" ? "default" : "outline"}
              size="sm"
              onClick={() => setGoalsFilter("locked")}
            >
              Locked
            </Button>
          </div>
        </div>

        <PropertiesTable properties={filteredProperties} isLoading={isLoading} />
      </div>
    </DashboardLayout>
  );
}

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PropertiesTable } from "@/components/PropertiesTable";
import { PropertyMetricsSummary } from "@/components/PropertyMetricsSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Download, Search } from "lucide-react";
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
}

export default function PropertiesBulkEdit() {
  const currentYear = new Date().getFullYear();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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

  const { data: reservations = [], isLoading: reservationsLoading } = useQuery({
    queryKey: ["reservations", currentYear],
    queryFn: async () => {
      const startDate = `${currentYear}-01-01`;
      const endDate = `${currentYear}-12-31`;
      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .gte("check_in", startDate)
        .lte("check_in", endDate)
        .eq("status", "confirmed");
      if (error) throw error;
      return data;
    },
  });

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ["property_goals", currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_goals")
        .select("*")
        .eq("year", currentYear);
      if (error) throw error;
      return data;
    },
  });

  const { data: forecasts = [], isLoading: forecastsLoading } = useQuery({
    queryKey: ["revenue_forecasts", currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_forecasts")
        .select("*")
        .eq("year", currentYear);
      if (error) throw error;
      return data;
    },
  });

  // Calculate metrics for each property
  const propertyMetrics = useMemo(() => {
    if (!listings.length) return [];

    return listings.map((listing): PropertyMetrics => {
      // Calculate actual revenue
      const listingReservations = reservations.filter(
        (r) => r.listing_id === listing.id
      );
      const actualRevenue = listingReservations.reduce(
        (sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0),
        0
      );

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
      };
    });
  }, [listings, reservations, goals, forecasts]);

  // Filter properties
  const filteredProperties = useMemo(() => {
    return propertyMetrics.filter((property) => {
      const matchesSearch = property.nickname
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || property.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [propertyMetrics, searchQuery, statusFilter]);

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
    a.download = `properties-bulk-${currentYear}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const isLoading = listingsLoading || reservationsLoading || goalsLoading || forecastsLoading;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Portfolio Overview</h1>
            <p className="text-muted-foreground">
              View and compare revenue metrics across all properties
            </p>
          </div>
          <div className="flex gap-2">
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
              All
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
        </div>

        <PropertiesTable properties={filteredProperties} isLoading={isLoading} />
      </div>
    </DashboardLayout>
  );
}

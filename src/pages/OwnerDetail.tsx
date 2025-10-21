import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PropertyMetricsSummary } from "@/components/PropertyMetricsSummary";
import { PropertiesTable } from "@/components/PropertiesTable";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Mail, Phone, Building2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, startOfYear } from "date-fns";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface Owner {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  imported_at: string;
}

export default function OwnerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sortBy, setSortBy] = useState<"name" | "actual" | "forecast" | "goalProgress" | "status">("actual");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfYear(new Date()),
    to: new Date(),
    preset: "ytd",
  });

  // Fetch owner data
  const { data: owner, isLoading: isOwnerLoading } = useQuery({
    queryKey: ["owner", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('owners')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch listings for this owner
  const { data: listings } = useQuery({
    queryKey: ["owner-listings", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .eq('owner_id', id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!id,
  });

  const listingIds = listings?.map(l => l.id) || [];

  // Fetch goals
  const { data: goals } = useQuery({
    queryKey: ["owner-goals", listingIds, dateRange.from],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const year = dateRange.from.getFullYear();

      const { data, error } = await supabase
        .from('property_goals')
        .select('*')
        .in('listing_id', listingIds)
        .eq('year', year);

      if (error) throw error;
      return data || [];
    },
    enabled: listingIds.length > 0,
  });

  // Fetch forecasts
  const { data: forecasts } = useQuery({
    queryKey: ["owner-forecasts", listingIds, dateRange.from],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const year = dateRange.from.getFullYear();

      const { data, error } = await supabase
        .from('revenue_forecasts')
        .select('*')
        .in('listing_id', listingIds)
        .eq('year', year);

      if (error) throw error;
      return data || [];
    },
    enabled: listingIds.length > 0,
  });

  // Fetch reservations
  const { data: reservations } = useQuery({
    queryKey: ["owner-reservations", listingIds, dateRange.from],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const startDate = new Date(dateRange.from);
      startDate.setFullYear(startDate.getFullYear() - 1);

      const endOfYear = new Date(dateRange.from);
      endOfYear.setMonth(11, 31);

      const pageSize = 1000;
      let from = 0;
      const results: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("reservations")
          .select("*")
          .in("listing_id", listingIds)
          .gte("check_out", format(startDate, "yyyy-MM-dd"))
          .lte("check_in", format(endOfYear, "yyyy-MM-dd"))
          .in("status", ["confirmed", "checked_in", "checked_out"])
          .order("check_in", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return results;
    },
    enabled: listingIds.length > 0,
  });

  // Fetch reservation nights for accurate revenue calculation
  const { data: reservationNights } = useQuery({
    queryKey: ["owner-reservation-nights", listingIds, dateRange.from, dateRange.to],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const pageSize = 1000;
      let from = 0;
      const results: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("reservation_nights")
          .select("listing_id, night_date, revenue_allocation")
          .in("listing_id", listingIds)
          .gte("night_date", format(dateRange.from, "yyyy-MM-dd"))
          .lte("night_date", format(dateRange.to, "yyyy-MM-dd"))
          .order("night_date", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return results;
    },
    enabled: listingIds.length > 0,
  });

  const getOwnerName = (owner: Owner) => {
    if (owner.full_name) return owner.full_name;
    if (owner.first_name && owner.last_name) return `${owner.first_name} ${owner.last_name}`;
    if (owner.first_name) return owner.first_name;
    if (owner.last_name) return owner.last_name;
    return 'Unknown Owner';
  };

  const handleSort = (field: "name" | "actual" | "forecast" | "goalProgress" | "status") => {
    if (sortBy === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDirection("desc");
    }
  };

  // Calculate metrics for PropertyMetricsSummary
  const currentYear = dateRange.from.getFullYear();
  const currentDate = new Date();

  const calculateMetrics = () => {
    let totalActualRevenue = 0;
    let totalBudget = 0;
    let totalProjection = 0;
    let totalGoal = 0;
    let totalForecast = 0;
    let onTrackCount = 0;
    let atRiskCount = 0;
    let behindCount = 0;

    listings?.forEach(listing => {
      // Calculate revenue from reservation nights
      const ytdRevenue = reservationNights
        ?.filter(n => n.listing_id === listing.id)
        .reduce((sum, n) => sum + (Number(n.revenue_allocation) || 0), 0) || 0;
      totalActualRevenue += ytdRevenue;

      // Get goals for this listing
      const listingGoals = goals?.filter(g => g.listing_id === listing.id && g.year === currentYear) || [];
      const budget = listingGoals.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0);
      const projection = listingGoals.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0);
      const goal = listingGoals.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0);
      
      totalBudget += budget;
      totalProjection += projection;
      totalGoal += goal;

      // Get forecast
      const listingForecast = forecasts?.find(f => f.listing_id === listing.id && f.year === currentYear);
      const forecastAmount = listingForecast ? (Number((listingForecast.total_forecast as any)?.p50) || 0) : 0;
      totalForecast += forecastAmount;

      // Determine status
      if (projection > 0) {
        const pacing = (forecastAmount / projection) * 100;
        if (pacing >= 95) onTrackCount++;
        else if (pacing >= 85) atRiskCount++;
        else behindCount++;
      }
    });

    return {
      totalActualRevenue,
      totalBudget,
      totalProjection,
      totalGoal,
      totalForecast,
      propertiesCount: listings?.length || 0,
      onTrackCount,
      atRiskCount,
      behindCount,
    };
  };

  const metrics = calculateMetrics();
  const isLoading = isOwnerLoading;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!owner) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Owner not found</p>
            <Button onClick={() => navigate('/owners')} className="mt-4">
              Back to Owners
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/owners">Owners</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{getOwnerName(owner)}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Back Button */}
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => navigate('/owners')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Owners
          </Button>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>

        {/* Owner Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{getOwnerName(owner)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {owner.email && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                    <Mail className="h-3 w-3" />
                    Email
                  </p>
                  <p className="font-medium">{owner.email}</p>
                </div>
              )}
              {owner.phone && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                    <Phone className="h-3 w-3" />
                    Phone
                  </p>
                  <p className="font-medium">{owner.phone}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                  <Building2 className="h-3 w-3" />
                  Properties
                </p>
                <p className="font-medium">{listings?.length || 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Last Synced</p>
                <p className="font-medium text-sm">
                  {new Date(owner.imported_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metrics Summary */}
        <PropertyMetricsSummary {...metrics} />

        {/* Properties Table */}
        <Card>
          <CardHeader>
            <CardTitle>Properties</CardTitle>
          </CardHeader>
          <CardContent>
            {listings && listings.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No properties found for this owner
              </p>
            ) : (
              <PropertiesTable
                properties={(listings || []).map(listing => {
                  const listingGoals = goals?.filter(g => g.listing_id === listing.id && g.year === currentYear) || [];
                  const listingForecast = forecasts?.find(f => f.listing_id === listing.id && f.year === currentYear);
                  
                  const ytdRevenue = reservationNights
                    ?.filter(n => n.listing_id === listing.id)
                    .reduce((sum, n) => sum + (Number(n.revenue_allocation) || 0), 0) || 0;

                  const budget = listingGoals.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0);
                  const projection = listingGoals.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0);
                  const goal = listingGoals.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0);
                  const forecast = listingForecast ? (Number((listingForecast.total_forecast as any)?.p50) || 0) : 0;
                  
                  let status: 'on-track' | 'at-risk' | 'behind' = 'behind';
                  if (projection > 0) {
                    const pacing = (forecast / projection) * 100;
                    if (pacing >= 95) status = 'on-track';
                    else if (pacing >= 85) status = 'at-risk';
                  }

                  const lockedGoals = listingGoals.filter(g => g.locked === true);
                  const budgetAchievement = budget > 0 ? (ytdRevenue / budget) * 100 : 0;
                  const projectionAchievement = projection > 0 ? (ytdRevenue / projection) * 100 : 0;
                  const goalAchievement = goal > 0 ? (ytdRevenue / goal) * 100 : 0;
                  const forecastBudgetAchievement = budget > 0 ? (forecast / budget) * 100 : 0;
                  const forecastProjectionAchievement = projection > 0 ? (forecast / projection) * 100 : 0;
                  const forecastGoalAchievement = goal > 0 ? (forecast / goal) * 100 : 0;

                  return {
                    id: listing.id,
                    nickname: listing.nickname,
                    address: listing.address,
                    thumbnail: listing.thumbnail,
                    propertyType: listing.property_type,
                    actualRevenue: ytdRevenue,
                    budgetTotal: budget,
                    projectionTotal: projection,
                    goalTotal: goal,
                    forecastedRevenue: forecast,
                    forecastUpdatedAt: listingForecast?.updated_at || null,
                    budgetAchievement,
                    projectionAchievement,
                    goalAchievement,
                    forecastBudgetAchievement,
                    forecastProjectionAchievement,
                    forecastGoalAchievement,
                    status,
                    hasGoals: listingGoals.length > 0,
                    hasLockedGoals: lockedGoals.length > 0,
                    goalsLockedCount: lockedGoals.length,
                  };
                }).sort((a, b) => {
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
                      comparison = a.forecastProjectionAchievement - b.forecastProjectionAchievement;
                      break;
                    case "status":
                      const statusOrder = { "on-track": 3, "at-risk": 2, "behind": 1 };
                      comparison = statusOrder[a.status] - statusOrder[b.status];
                      break;
                  }
                  
                  return sortDirection === "asc" ? comparison : -comparison;
                })}
                isLoading={false}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
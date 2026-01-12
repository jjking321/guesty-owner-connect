import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PropertyMetricsSummary } from "@/components/PropertyMetricsSummary";
import { PropertiesTable } from "@/components/PropertiesTable";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";

import { GoalsComparison } from "@/components/GoalsComparison";
import { PacingReport } from "@/components/PacingReport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { type NavigationReferrer } from "@/hooks/useSmartNavigation";
import { useUserRole } from "@/hooks/useUserRole";

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
  const { role, ownerId: userOwnerId } = useUserRole();
  const [sortBy, setSortBy] = useState<"name" | "actual" | "forecast" | "goalProgress" | "status">("actual");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfYear(new Date()),
    to: new Date(),
    preset: "ytd",
  });

  // Redirect owners to their own page if they try to access another owner's page
  useEffect(() => {
    if (role === 'owner' && userOwnerId && id !== userOwnerId) {
      navigate(`/owners/${userOwnerId}`, { replace: true });
      toast({
        title: "Access Restricted",
        description: "You can only view your own dashboard",
        variant: "destructive",
      });
    }
  }, [role, userOwnerId, id, navigate, toast]);

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

  // Calculate year-over-year revenue data
  const calculateYearOverYearRevenue = () => {
    const currentYear = dateRange.from.getFullYear();
    const monthlyRevenue: { [key: string]: { current: number; last: number } } = {};

    // Initialize all months
    for (let i = 0; i < 12; i++) {
      const monthKey = `${i}`;
      monthlyRevenue[monthKey] = { current: 0, last: 0 };
    }

    // Calculate revenue per night and allocate to correct month (excluding owner reservations)
    reservations?.filter(r => r.source !== 'owner').forEach((r) => {
      if (!r.check_in || !r.check_out || !r.nights_count || r.nights_count <= 0) return;

      const checkIn = new Date(r.check_in);
      const checkOut = new Date(r.check_out);
      const revenuePerNight = (Number(r.fare_accommodation_adjusted) || 0) / r.nights_count;

      let currentDate = new Date(checkIn);
      while (currentDate < checkOut) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        if (year === currentYear) {
          monthlyRevenue[month].current += revenuePerNight;
        } else if (year === currentYear - 1) {
          monthlyRevenue[month].last += revenuePerNight;
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return Array.from({ length: 12 }, (_, i) => ({
      month: format(new Date(2025, i), "MMM"),
      monthKey: `${currentYear}-${String(i + 1).padStart(2, '0')}`,
      currentYear: Math.round(monthlyRevenue[i].current),
      lastYear: Math.round(monthlyRevenue[i].last),
    }));
  };

  // Calculate year-over-year occupancy data
  const calculateYearOverYearOccupancy = () => {
    const currentYear = dateRange.from.getFullYear();
    const monthlyOccupancy: { [key: string]: { currentNights: number; lastNights: number; totalDays: number } } = {};

    // Initialize all months
    for (let i = 0; i < 12; i++) {
      const daysInMonth = new Date(currentYear, i + 1, 0).getDate();
      monthlyOccupancy[i] = { currentNights: 0, lastNights: 0, totalDays: daysInMonth };
    }

    // Count nights booked per month (excluding owner reservations)
    reservations?.filter(r => r.source !== 'owner').forEach((r) => {
      if (!r.check_in || !r.check_out) return;

      const checkIn = new Date(r.check_in);
      const checkOut = new Date(r.check_out);

      let currentDate = new Date(checkIn);
      while (currentDate < checkOut) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        if (year === currentYear) {
          monthlyOccupancy[month].currentNights++;
        } else if (year === currentYear - 1) {
          monthlyOccupancy[month].lastNights++;
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    // Calculate occupancy percentage: (nights booked / (days in month × number of properties)) × 100
    const propertyCount = listingIds.length || 1;

    return Array.from({ length: 12 }, (_, i) => {
      const currentOccupancy = (monthlyOccupancy[i].currentNights / (monthlyOccupancy[i].totalDays * propertyCount)) * 100;
      const lastOccupancy = (monthlyOccupancy[i].lastNights / (monthlyOccupancy[i].totalDays * propertyCount)) * 100;

      return {
        month: format(new Date(2025, i), "MMM"),
        monthKey: `${currentYear}-${String(i + 1).padStart(2, '0')}`,
        currentYear: Math.round(currentOccupancy * 10) / 10,
        lastYear: Math.round(lastOccupancy * 10) / 10,
      };
    });
  };

  // Calculate year-over-year RevPAR data
  const calculateYearOverYearRevPAR = () => {
    const revenueData = calculateYearOverYearRevenue();
    const occupancyData = calculateYearOverYearOccupancy();

    return revenueData.map((rev, i) => {
      const occ = occupancyData[i];
      const currentYear = dateRange.from.getFullYear();
      const daysInMonth = new Date(currentYear, i + 1, 0).getDate();
      const propertyCount = listingIds.length || 1;

      const currentRevPAR = rev.currentYear / (daysInMonth * propertyCount);
      const lastRevPAR = rev.lastYear / (daysInMonth * propertyCount);

      return {
        month: rev.month,
        monthKey: rev.monthKey,
        currentYear: Math.round(currentRevPAR),
        lastYear: Math.round(lastRevPAR),
      };
    });
  };

  const revenueData = calculateYearOverYearRevenue();
  const occupancyData = calculateYearOverYearOccupancy();
  const revparData = calculateYearOverYearRevPAR();

  // Calculate aggregated forecast
  const aggregatedForecast = forecasts?.reduce((acc, f) => {
    const totalForecast = (f.total_forecast as any)?.p50 || 0;
    const revenueOnBooks = Number(f.revenue_on_books) || 0;
    return {
      totalProjected: acc.totalProjected + totalForecast,
      totalOnBooks: acc.totalOnBooks + revenueOnBooks,
    };
  }, { totalProjected: 0, totalOnBooks: 0 });

  // Calculate aggregated monthly forecast for TrendChart
  const aggregatedMonthlyForecast = useMemo(() => {
    if (!forecasts || forecasts.length === 0) return null;

    const monthlyData: { [key: string]: { p50: number, onBooks: number } } = {};

    // Initialize all 12 months
    for (let i = 1; i <= 12; i++) {
      const monthKey = `${dateRange.from.getFullYear()}-${String(i).padStart(2, '0')}`;
      monthlyData[monthKey] = { p50: 0, onBooks: 0 };
    }

    // Aggregate each property's monthly forecast
    forecasts.forEach(forecast => {
      const monthlyForecasts = (forecast.monthly_forecasts as any[]) || [];
      monthlyForecasts.forEach((mf: any) => {
        const month = mf.month;
        if (monthlyData[month]) {
          monthlyData[month].p50 += mf.total_forecast_p50 || 0;
          monthlyData[month].onBooks += mf.revenue_on_books || 0;
        }
      });
    });

    return {
      monthly_forecasts: Object.entries(monthlyData).map(([month, data]) => ({
        month,
        totalForecast: { p50: data.p50 },
        revenue_on_books: data.onBooks,
      })),
    };
  }, [forecasts, dateRange.from]);

  const avgGoalProbabilities = forecasts?.reduce((acc, f: any) => {
    const probs = f.goal_probabilities || { projection: 0 };
    return {
      projection: acc.projection + (probs.projection || 0),
      count: acc.count + 1,
    };
  }, { projection: 0, count: 0 });

  const goalProbabilities = avgGoalProbabilities?.count ? {
    projection: avgGoalProbabilities.projection / avgGoalProbabilities.count,
  } : null;

  const totalProjectionRevenue = goals?.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0) || 0;

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
        <PropertyMetricsSummary 
          totalActualRevenue={metrics.totalActualRevenue}
          totalProjection={metrics.totalProjection}
          totalForecast={metrics.totalForecast}
          propertiesCount={metrics.propertiesCount}
          onTrackCount={metrics.onTrackCount}
          atRiskCount={metrics.atRiskCount}
          behindCount={metrics.behindCount}
        />

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
            <TabsTrigger value="pacing">Pacing</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <GoalsComparison 
              listingId={null}
              reservations={reservations || []}
              goals={goals || []}
              forecasts={forecasts || []}
            />
          </TabsContent>

          <TabsContent value="forecast" className="space-y-6">
            {aggregatedForecast && goalProbabilities ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Aggregated Revenue Forecast</CardTitle>
                    <CardDescription>
                      Combined forecast from all {listingIds.length} properties for this owner
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-6 text-center">
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        Projected End-of-Year Revenue
                      </p>
                      <p className="text-4xl font-bold mb-2">
                        ${aggregatedForecast.totalProjected.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                      <div className="mt-4 pt-4 border-t">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="text-center">
                            <p className="text-muted-foreground">Revenue On Books</p>
                            <p className="font-semibold">
                              ${aggregatedForecast.totalOnBooks.toLocaleString()}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">Additional Forecasted</p>
                            <p className="font-semibold">
                              ${(aggregatedForecast.totalProjected - aggregatedForecast.totalOnBooks).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-4">Probability of Hitting Projection</h4>
                      <div className="flex justify-center">
                        {(() => {
                          const probability = goalProbabilities.projection;
                          const target = totalProjectionRevenue;
                          const getColor = (prob: number) => {
                            if (prob >= 70) return "text-green-600";
                            if (prob >= 40) return "text-yellow-600";
                            return "text-red-600";
                          };

                          return (
                            <div className="flex flex-col items-center space-y-2">
                              <div className="relative w-24 h-24">
                                <svg className="transform -rotate-90 w-24 h-24">
                                  <circle
                                    cx="48"
                                    cy="48"
                                    r="40"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="transparent"
                                    className="text-muted"
                                  />
                                  <circle
                                    cx="48"
                                    cy="48"
                                    r="40"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="transparent"
                                    strokeDasharray={`${2 * Math.PI * 40}`}
                                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - probability / 100)}`}
                                    className={getColor(probability)}
                                    strokeLinecap="round"
                                  />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className={`text-2xl font-bold ${getColor(probability)}`}>
                                    {probability.toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                              <div className="text-center">
                                <p className="text-sm font-medium">Projection</p>
                                <p className="text-xs text-muted-foreground">
                                  ${target.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="text-center text-sm text-muted-foreground pt-4 border-t">
                      <p>Forecasts are aggregated from {forecasts?.length || 0} of {listingIds.length} properties</p>
                      <p className="mt-1">Individual property forecasts can be viewed on their detail pages</p>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="text-center py-12">
                  <p className="text-muted-foreground mb-4">
                    No forecasts available yet for properties owned by this owner
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Visit individual property pages to generate forecasts
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="pacing">
            {reservations && reservations.length > 0 ? (
              <PacingReport reservations={reservations} />
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
                referrer={{
                  path: `/owners/${id}`,
                  label: owner ? getOwnerName(owner) : 'Owner',
                  state: { dateRange, sortBy, sortDirection, scrollPosition: window.scrollY }
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
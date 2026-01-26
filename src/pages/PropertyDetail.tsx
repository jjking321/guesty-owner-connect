import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Home, MapPin, Users, Bed, DollarSign, Calendar, TrendingUp, Percent, Info, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { startOfMonth, endOfMonth, getDaysInMonth, format, parseISO, differenceInDays, addDays, addMonths, isSameMonth, subMonths, isWithinInterval, startOfDay, endOfDay, startOfYear } from "date-fns";
import { formatDateDisplay, parseLocalDate } from "@/lib/utils";
import { StripeDateRangePicker, DateRange } from "@/components/StripeDateRangePicker";

import { PacingReport } from "@/components/PacingReport";
import { GoalsComparison } from "@/components/GoalsComparison";
import { PropertySettings } from "@/components/PropertySettings";
import { RevenueForecast } from "@/components/RevenueForecast";
import { ReviewsSummary } from "@/components/ReviewsSummary";
import { ReviewsTable } from "@/components/ReviewsTable";
import { ComparablesModule } from "@/components/ComparablesModule";
import { ListingCalendar } from "@/components/ListingCalendar";
import { CallPrepDialog } from "@/components/CallPrepDialog";
import { RevenueActionsDialog } from "@/components/RevenueActionsDialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSmartNavigation } from "@/hooks/useSmartNavigation";
import { useUserRole } from "@/hooks/useUserRole";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { navigateBack, getReferrer } = useSmartNavigation();
  const { role } = useUserRole();
  const referrer = getReferrer();
  const [listing, setListing] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
  const [goalsData, setGoalsData] = useState<any[]>([]);
  const [revenueForecast, setRevenueForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [metricsDateRange, setMetricsDateRange] = useState<DateRange>({
    from: subMonths(new Date(), 12),
    to: new Date(),
  });
  const [showAdjustedOccupancy, setShowAdjustedOccupancy] = useState(false);
  const [showAdjustedRevPAR, setShowAdjustedRevPAR] = useState(false);
  const [isMonthlyTableOpen, setIsMonthlyTableOpen] = useState(false);

  // Sync reservations mutation
  const syncReservationsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sync-listing-reservations', {
        body: { listingId: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Reservations synced",
        description: `Successfully synced ${data.reservationsCount} reservations from Guesty.`,
      });
      // Reload property data to refresh reservations
      loadPropertyData();
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch capacity calendar for blocked dates
  const { data: capacityCalendar } = useQuery({
    queryKey: ['capacity-calendar-blocks', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('capacity_calendar')
        .select('date, status, block_reason')
        .eq('listing_id', id!)
        .or('block_reason.eq.blocked,status.eq.unavailable');
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!id
  });

  useEffect(() => {
    if (id) {
      loadPropertyData();
    }
  }, [id]);

  const loadPropertyData = async () => {
    try {
      setLoading(true);

      // Load property details
      const { data: listingData, error: listingError } = await supabase
        .from("listings")
        .select("*")
        .eq("id", id)
        .single();

      if (listingError) throw listingError;
      setListing(listingData);

      // Load confirmed and checked_out reservations for this property
      const { data: reservationsData, error: reservationsError } = await supabase
        .from("reservations")
        .select("*")
        .eq("listing_id", id)
        .in("status", ["confirmed", "checked_out", "checked_in"])
        .order("check_in", { ascending: false });

      if (reservationsError) throw reservationsError;
      setReservations(reservationsData || []);

      // Load goals data for current year
      const currentYear = new Date().getFullYear();
      const { data: goalsDataResult, error: goalsError } = await supabase
        .from('property_goals')
        .select('*')
        .eq('listing_id', id)
        .eq('year', currentYear)
        .order('month');

      if (goalsError) throw goalsError;
      setGoalsData(goalsDataResult || []);

      // Load revenue forecast for current year
      const { data: forecastData, error: forecastError } = await supabase
        .from('revenue_forecasts')
        .select('*')
        .eq('listing_id', id)
        .eq('year', currentYear)
        .maybeSingle();

      if (!forecastError && forecastData) {
        setRevenueForecast(forecastData);
      }
    } catch (error: any) {
      toast({
        title: "Error loading property data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getAddress = (address: any) => {
    if (!address) return "N/A";
    const parts = [address.street, address.city, address.state, address.zipcode, address.country].filter(Boolean);
    return parts.join(", ") || "N/A";
  };

  const getBestQualityImage = (listing: any) => {
    // Try to get regular or original from pictures array first
    if (listing.pictures && Array.isArray(listing.pictures) && listing.pictures.length > 0) {
      const firstPicture = listing.pictures[0];
      // Prefer original, then regular, then thumbnail
      return firstPicture.original || firstPicture.regular || firstPicture.thumbnail;
    }
    
    // Fall back to thumbnail field
    return listing.thumbnail || "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=600&fit=crop";
  };


  const calculateMonthlyOccupancy = () => {
    if (reservations.length === 0) return [];

    const monthlyData = new Map<string, { nightsBooked: number; totalDays: number }>();

    // Get last 12 months
    const currentDate = new Date();
    for (let i = 11; i >= 0; i--) {
      const monthDate = subMonths(currentDate, i);
      const monthKey = format(monthDate, 'yyyy-MM');
      const daysInMonth = getDaysInMonth(monthDate);
      monthlyData.set(monthKey, { nightsBooked: 0, totalDays: daysInMonth });
    }

    // Process each reservation (excluding owner reservations)
    reservations.filter(r => r.source !== 'owner').forEach((reservation) => {
      if (!reservation.check_in || !reservation.check_out) return;

      const checkIn = parseISO(reservation.check_in);
      const checkOut = parseISO(reservation.check_out);
      
      // Iterate through each night of the reservation
      let currentNight = checkIn;
      while (currentNight < checkOut) {
        const monthKey = format(currentNight, 'yyyy-MM');
        
        if (monthlyData.has(monthKey)) {
          const data = monthlyData.get(monthKey)!;
          data.nightsBooked++;
        }
        
        currentNight = addDays(currentNight, 1);
      }
    });

    // Convert to array and calculate occupancy rates
    return Array.from(monthlyData.entries())
      .map(([monthKey, data]) => ({
        month: format(parseISO(monthKey + '-01'), 'MMM yyyy'),
        monthKey,
        occupancyRate: (data.nightsBooked / data.totalDays) * 100,
        nightsBooked: data.nightsBooked,
        totalDays: data.totalDays,
      }))
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  };

  const calculateMonthlyRevenue = () => {
    if (reservations.length === 0) return [];

    const monthlyData = new Map<string, number>();

    // Get last 12 months
    const currentDate = new Date();
    for (let i = 11; i >= 0; i--) {
      const monthDate = subMonths(currentDate, i);
      const monthKey = format(monthDate, 'yyyy-MM');
      monthlyData.set(monthKey, 0);
    }

    // Process each reservation - allocate revenue to nights (excluding owner reservations)
    reservations.filter(r => r.source !== 'owner').forEach((reservation) => {
      if (!reservation.check_in || !reservation.fare_accommodation_adjusted) return;

      const checkIn = parseISO(reservation.check_in);
      const revenue = parseFloat(reservation.fare_accommodation_adjusted);
      const nightsCount = reservation.nights_count || 0;
      const revenuePerNight = nightsCount > 0 ? revenue / nightsCount : 0;
      const checkOut = parseISO(reservation.check_out);
      
      // Allocate revenue to each night's month
      let currentNight = checkIn;
      while (currentNight < checkOut) {
        const monthKey = format(currentNight, 'yyyy-MM');
        
        if (monthlyData.has(monthKey)) {
          const currentRevenue = monthlyData.get(monthKey)!;
          monthlyData.set(monthKey, currentRevenue + revenuePerNight);
        }
        
        currentNight = addDays(currentNight, 1);
      }
    });

    // Convert to array
    return Array.from(monthlyData.entries())
      .map(([monthKey, revenue]) => ({
        month: format(parseISO(monthKey + '-01'), 'MMM yyyy'),
        monthKey,
        revenue,
      }))
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  };

  const calculateProjectionAchievement = () => {
    console.log('=== Projection Achievement Debug ===');
    console.log('Revenue Forecast:', revenueForecast);
    console.log('Goals Data:', goalsData);
    
    // If no forecast or goals data, return null
    if (!revenueForecast || goalsData.length === 0) {
      console.log('Missing data - forecast:', !!revenueForecast, 'goals count:', goalsData.length);
      return null;
    }

    // Calculate total annual projection goal
    const totalProjectionGoal = goalsData.reduce((sum, goal) => 
      sum + parseFloat(goal.projection_revenue || 0), 0
    );
    console.log('Total Projection Goal:', totalProjectionGoal);

    // If no projection goal set, return null
    if (totalProjectionGoal === 0) {
      console.log('No projection goal set');
      return null;
    }

    // Get projected end-of-year revenue (from forecast)
    const projectedYearEndRevenue = (revenueForecast.total_forecast as any)?.p50 || 0;
    const revenueOnBooks = parseFloat(revenueForecast.revenue_on_books || 0);
    
    console.log('Projected Year-End Revenue:', projectedYearEndRevenue);
    console.log('Revenue On Books:', revenueOnBooks);
    console.log('Additional Forecasted:', projectedYearEndRevenue - revenueOnBooks);

    // Calculate percentage
    const achievementPercentage = (projectedYearEndRevenue / totalProjectionGoal) * 100;
    console.log('Achievement Percentage:', achievementPercentage.toFixed(2) + '%');

    return {
      percentage: achievementPercentage,
      projectedRevenue: projectedYearEndRevenue,
      projectionGoal: totalProjectionGoal,
      onBooks: revenueOnBooks,
      forecasted: projectedYearEndRevenue - revenueOnBooks
    };
  };

  const calculateMetrics = (dateRange: DateRange) => {
    const emptyMetrics = {
      totalReservations: 0,
      totalRevenue: 0,
      totalNights: 0,
      averageADR: 0,
      averageNightsPerReservation: 0,
      totalGuests: 0,
      averageGuestsPerReservation: 0,
      overallOccupancy: 0,
      revPAR: 0,
      adjustedRevPAR: 0,
      ownerNights: 0,
      blockedNights: 0,
      bookableDays: 0,
      adjustedOccupancy: 0,
    };

    if (reservations.length === 0) {
      return emptyMetrics;
    }

    // Calculate date range boundaries
    const rangeStart = dateRange.from ? startOfDay(dateRange.from) : null;
    const rangeEnd = dateRange.to ? endOfDay(dateRange.to) : null;

    // Helper to check if a night is within the date range
    const isNightInRange = (night: Date) => {
      if (!rangeStart && !rangeEnd) return true; // All time
      if (rangeStart && rangeEnd) {
        return isWithinInterval(night, { start: rangeStart, end: rangeEnd });
      }
      if (rangeStart) return night >= rangeStart;
      if (rangeEnd) return night <= rangeEnd;
      return true;
    };

    // Filter reservations that have any nights in the date range
    const filteredReservations = reservations.filter((r) => {
      if (!r.check_in || !r.check_out) return false;
      const checkIn = parseLocalDate(r.check_in);
      const checkOut = parseLocalDate(r.check_out);
      if (!checkIn || !checkOut) return false;
      
      // Check if any night of reservation falls within range
      let currentNight = new Date(checkIn);
      while (currentNight < checkOut) {
        if (isNightInRange(currentNight)) {
          return true;
        }
        currentNight.setDate(currentNight.getDate() + 1);
      }
      return false;
    });

    if (filteredReservations.length === 0) {
      return emptyMetrics;
    }

    // Calculate revenue using night-based allocation for nights in range only
    let totalRevenue = 0;
    let totalNights = 0;
    let ownerNights = 0;
    let reservationsWithNightsInRange = 0;

    filteredReservations.forEach(r => {
      const checkIn = parseLocalDate(r.check_in);
      const checkOut = parseLocalDate(r.check_out);
      if (!checkIn || !checkOut) return;

      // Count owner nights
      if (r.source === 'owner') {
        let currentNight = new Date(checkIn);
        while (currentNight < checkOut) {
          if (isNightInRange(currentNight)) {
            ownerNights += 1;
          }
          currentNight.setDate(currentNight.getDate() + 1);
        }
        return; // Don't count owner reservations in revenue/nights
      }

      if (!r.fare_accommodation_adjusted || !r.nights_count || r.nights_count === 0) return;
      
      const revenuePerNight = parseFloat(r.fare_accommodation_adjusted) / r.nights_count;
      
      let nightsInRange = 0;
      let currentNight = new Date(checkIn);
      while (currentNight < checkOut) {
        if (isNightInRange(currentNight)) {
          totalRevenue += revenuePerNight;
          totalNights += 1;
          nightsInRange += 1;
        }
        currentNight.setDate(currentNight.getDate() + 1);
      }
      
      if (nightsInRange > 0) {
        reservationsWithNightsInRange += 1;
      }
    });

    // Calculate blocked nights from capacity_calendar
    const blockedNights = (capacityCalendar || []).filter(day => {
      const date = parseLocalDate(day.date);
      if (!date) return false;
      return isNightInRange(date);
    }).length;

    const totalGuests = filteredReservations.filter(r => r.source !== 'owner').reduce((sum, r) => sum + (r.guests_count || 0), 0);
    const averageADR = totalNights > 0 ? totalRevenue / totalNights : 0;
    const averageNightsPerReservation = reservationsWithNightsInRange > 0 ? totalNights / reservationsWithNightsInRange : 0;
    const averageGuestsPerReservation = filteredReservations.filter(r => r.source !== 'owner').length > 0 
      ? totalGuests / filteredReservations.filter(r => r.source !== 'owner').length 
      : 0;

    // Calculate occupancy for the date range
    let totalDaysInRange = 0;
    if (rangeStart && rangeEnd) {
      totalDaysInRange = differenceInDays(rangeEnd, rangeStart) + 1;
    } else {
      // All time - use last 12 months
      totalDaysInRange = 365;
    }
    
    const overallOccupancy = totalDaysInRange > 0 ? (totalNights / totalDaysInRange) * 100 : 0;

    // Calculate adjusted occupancy (excluding owner nights and blocked days)
    const bookableDays = Math.max(0, totalDaysInRange - ownerNights - blockedNights);
    const adjustedOccupancy = bookableDays > 0 ? Math.min(100, (totalNights / bookableDays) * 100) : 0;

    // Calculate RevPAR = ADR × Occupancy Rate
    const revPAR = averageADR * (overallOccupancy / 100);
    const adjustedRevPAR = averageADR * (adjustedOccupancy / 100);

    return {
      totalReservations: filteredReservations.filter(r => r.source !== 'owner').length,
      totalRevenue,
      totalNights,
      averageADR,
      averageNightsPerReservation,
      totalGuests,
      averageGuestsPerReservation,
      overallOccupancy,
      revPAR,
      adjustedRevPAR,
      ownerNights,
      blockedNights,
      bookableDays,
      adjustedOccupancy,
    };
  };

  const metrics = calculateMetrics(metricsDateRange);

  // Calculate monthly metrics for the table
  const monthlyMetrics = useMemo(() => {
    const data: Array<{
      month: string;
      monthStart: Date;
      revenue: number;
      nights: number;
      occupancy: number;
      adr: number;
      revpar: number;
    }> = [];

    if (!metricsDateRange.from || !metricsDateRange.to) return data;

    // Iterate through each month in the date range
    let currentMonth = startOfMonth(metricsDateRange.from);
    const endMonth = startOfMonth(metricsDateRange.to);

    while (currentMonth <= endMonth) {
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);
      
      // Calculate metrics for this specific month
      const monthMetrics = calculateMetrics({ from: monthStart, to: monthEnd });
      
      data.push({
        month: format(currentMonth, 'MMM yyyy'),
        monthStart: currentMonth,
        revenue: monthMetrics.totalRevenue,
        nights: monthMetrics.totalNights,
        occupancy: monthMetrics.overallOccupancy,
        adr: monthMetrics.averageADR,
        revpar: monthMetrics.revPAR,
      });

      currentMonth = addMonths(currentMonth, 1);
    }

    return data;
  }, [reservations, metricsDateRange, capacityCalendar]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="text-center py-12 text-muted-foreground">Loading property details...</div>
      </DashboardLayout>
    );
  }

  if (!listing) {
    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>Property Not Found</CardTitle>
            <CardDescription>The property you're looking for doesn't exist.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/listings")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Listings
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Breadcrumb Navigation */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={referrer?.path || "/listings"}>
                  {referrer?.label || "Properties"}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{listing?.nickname || "Property Details"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Back Button */}
        <Button variant="outline" onClick={navigateBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to {referrer?.label || "Properties"}
        </Button>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">{listing.nickname || "Unnamed Property"}</h2>
              <p className="text-muted-foreground flex items-center gap-1 mt-1">
                <MapPin className="h-4 w-4" />
                {getAddress(listing.address)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {role && role !== 'owner' && (
              <>
                <CallPrepDialog 
                  listingId={id!} 
                  propertyName={listing.nickname || "Property"} 
                />
                <RevenueActionsDialog 
                  listingId={id!} 
                  propertyName={listing.nickname || "Property"} 
                />
              </>
            )}
            <PropertySettings listingId={id!} />
          </div>
        </div>

        {/* Property Image and Details */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2 overflow-hidden">
            <div className="aspect-video w-full overflow-hidden bg-muted">
              <img
                src={getBestQualityImage(listing)}
                alt={listing.nickname || "Property"}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=600&fit=crop";
                }}
              />
            </div>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Property Details</CardTitle>
                <div className="flex gap-2">
                  {listing.active && <Badge variant="secondary">Active</Badge>}
                  {listing.is_listed && <Badge variant="outline">Listed</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Home className="h-4 w-4" />
                    <span className="text-sm">Type</span>
                  </div>
                  <span className="font-medium">{listing.property_type || "N/A"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Bed className="h-4 w-4" />
                    <span className="text-sm">Bedrooms</span>
                  </div>
                  <span className="font-medium">{listing.bedrooms ?? "N/A"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span className="text-sm">Accommodates</span>
                  </div>
                  <span className="font-medium">{listing.accommodates ?? "N/A"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span className="text-sm">Listed Since</span>
                  </div>
                  <span className="font-medium">
                    {listing.created_at_guesty
                      ? new Date(listing.created_at_guesty).toLocaleDateString()
                      : "N/A"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Stats</CardTitle>
              <CardDescription>Based on confirmed reservations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-2xl font-bold">{metrics.totalReservations}</div>
                <div className="text-sm text-muted-foreground">Total Reservations</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  ${metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                <div className="text-sm text-muted-foreground">Total Revenue</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{metrics.totalNights}</div>
                <div className="text-sm text-muted-foreground">Total Nights Booked</div>
              </div>
              
              {(() => {
                const projectionAchievement = calculateProjectionAchievement();
                if (!projectionAchievement) return null;
                
                const { percentage, projectedRevenue, projectionGoal } = projectionAchievement;
                const colorClass = percentage >= 100 ? 'text-green-600 dark:text-green-500' : 
                                   percentage >= 80 ? 'text-yellow-600 dark:text-yellow-500' : 
                                   'text-red-600 dark:text-red-500';
                
                return (
                  <div>
                    <div className={`text-2xl font-bold ${colorClass}`}>
                      {percentage.toFixed(0)}%
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Goal Achievement
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      ${projectedRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })} / ${projectionGoal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>

        {/* Tabs for different sections */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="reservations">Reservations</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Performance Metrics with Date Filter */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Performance Metrics</h3>
                <StripeDateRangePicker
                  value={metricsDateRange}
                  onChange={setMetricsDateRange}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-muted-foreground" />
                        Occupancy Rate
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="adjusted-occupancy" className="text-xs font-normal text-muted-foreground cursor-pointer">
                          Adjusted
                        </Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p>Adjusted occupancy excludes owner stays ({metrics.ownerNights} nights) and blocked dates ({metrics.blockedNights} days) from the calculation.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <Switch
                          id="adjusted-occupancy"
                          checked={showAdjustedOccupancy}
                          onCheckedChange={setShowAdjustedOccupancy}
                        />
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {showAdjustedOccupancy 
                        ? metrics.adjustedOccupancy.toFixed(1)
                        : metrics.overallOccupancy.toFixed(1)}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {showAdjustedOccupancy 
                        ? `${metrics.bookableDays} bookable days`
                        : 'For selected period'}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      Average ADR
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      ${metrics.averageADR.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Per night average</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        RevPAR
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="adjusted-revpar" className="text-xs font-normal text-muted-foreground cursor-pointer">
                          Adjusted
                        </Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p>Adjusted RevPAR uses adjusted occupancy, which excludes owner stays and blocked dates from the calculation.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <Switch
                          id="adjusted-revpar"
                          checked={showAdjustedRevPAR}
                          onCheckedChange={setShowAdjustedRevPAR}
                        />
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      ${showAdjustedRevPAR
                        ? metrics.adjustedRevPAR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : metrics.revPAR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {showAdjustedRevPAR
                        ? 'Per bookable room night'
                        : 'Revenue per available room'}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      Avg Nights/Reservation
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {metrics.averageNightsPerReservation.toFixed(1)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Average stay length</p>
                  </CardContent>
                </Card>
              </div>

              {/* Monthly Performance Table */}
              <Collapsible open={isMonthlyTableOpen} onOpenChange={setIsMonthlyTableOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 w-full justify-start p-0 h-auto hover:bg-transparent">
                    {isMonthlyTableOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span className="text-sm font-medium">Monthly Breakdown</span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Month</TableHead>
                              <TableHead className="text-right">Revenue</TableHead>
                              <TableHead className="text-right">Nights</TableHead>
                              <TableHead className="text-right">Occupancy</TableHead>
                              <TableHead className="text-right">ADR</TableHead>
                              <TableHead className="text-right">RevPAR</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {monthlyMetrics.map((row) => (
                              <TableRow key={row.month}>
                                <TableCell className="font-medium">{row.month}</TableCell>
                                <TableCell className="text-right">
                                  ${row.revenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </TableCell>
                                <TableCell className="text-right">{row.nights}</TableCell>
                                <TableCell className="text-right">{row.occupancy.toFixed(1)}%</TableCell>
                                <TableCell className="text-right">
                                  ${row.adr.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </TableCell>
                                <TableCell className="text-right">
                                  ${row.revpar.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Pacing Report - YTD metrics */}
            <PacingReport reservations={reservations} listingId={id} />

            {/* Goals Comparison */}
            <GoalsComparison listingId={id!} reservations={reservations} />

            {/* Revenue Forecast */}
            <RevenueForecast listingId={id!} />

            {/* Property Comparables */}
            <ComparablesModule
              listingId={id!}
              latitude={(listing?.address as any)?.lat}
              longitude={(listing?.address as any)?.lng}
              bedrooms={listing?.bedrooms}
              guests={listing?.accommodates}
            />
          </TabsContent>

          <TabsContent value="calendar" className="space-y-6">
            <ListingCalendar listingId={id!} />
          </TabsContent>

          <TabsContent value="reservations" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Reservations</CardTitle>
                  <CardDescription>
                    All confirmed reservations for this property
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncReservationsMutation.mutate()}
                  disabled={syncReservationsMutation.isPending}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${syncReservationsMutation.isPending ? 'animate-spin' : ''}`} />
                  {syncReservationsMutation.isPending ? 'Syncing...' : 'Sync Reservations'}
                </Button>
              </CardHeader>
              <CardContent>
                {reservations.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No confirmed reservations found for this property
                  </p>
                ) : (
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Check In</TableHead>
                          <TableHead>Check Out</TableHead>
                          <TableHead>Nights</TableHead>
                          <TableHead>Guests</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>ADR</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reservations.map((reservation) => {
                          const adr = reservation.nights_count > 0
                            ? parseFloat(reservation.fare_accommodation_adjusted || 0) / reservation.nights_count
                            : 0;
                          
                          return (
                            <TableRow key={reservation.id}>
                              <TableCell className="whitespace-nowrap">
                                {formatDateDisplay(reservation.check_in)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatDateDisplay(reservation.check_out)}
                              </TableCell>
                              <TableCell>{reservation.nights_count}</TableCell>
                              <TableCell>{reservation.guests_count}</TableCell>
                              <TableCell>
                                {reservation.source && (
                                  <Badge variant="outline" className="text-xs">
                                    {reservation.source}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>${adr.toFixed(0)}</TableCell>
                              <TableCell className="text-right font-semibold">
                                ${parseFloat(reservation.fare_accommodation_adjusted || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reviews" className="space-y-6">
            <ReviewsSection listingId={id!} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ReviewsSection({ listingId }: { listingId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  // Fetch reviews
  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['reviews', listingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('listing_id', listingId)
        .order('review_date', { ascending: false });

      if (error) throw error;
      return (data || []).map(review => ({
        ...review,
        category_ratings: review.category_ratings as Record<string, number> | undefined,
      }));
    },
  });

  // Mark as removed mutation
  const markAsRemovedMutation = useMutation({
    mutationFn: async ({ reviewId, reason }: { reviewId: string; reason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('reviews')
        .update({
          is_removed: true,
          removed_at: new Date().toISOString(),
          removed_by: user?.id,
          removed_reason: reason,
        })
        .eq('id', reviewId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews', listingId] });
      toast({
        title: "Review marked as removed",
        description: "The review has been marked as removed and will be excluded from calculations.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to mark review as removed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: async (reviewId: string) => {
      const { error } = await supabase
        .from('reviews')
        .update({
          is_removed: false,
          removed_at: null,
          removed_by: null,
          removed_reason: null,
        })
        .eq('id', reviewId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews', listingId] });
      toast({
        title: "Review restored",
        description: "The review has been restored and will be included in calculations.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to restore review",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-muted-foreground">Loading reviews...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Reviews</CardTitle>
          <CardDescription>
            Guest reviews and ratings for this property
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-1">
              <ReviewsSummary
                reviews={reviews}
                onPlatformClick={(platform) => setSelectedPlatform(platform)}
              />
            </div>
            <div className="md:col-span-2">
              <ReviewsTable
                reviews={reviews}
                selectedPlatform={selectedPlatform !== 'all' ? selectedPlatform : undefined}
                onMarkAsRemoved={(reviewId, reason) =>
                  markAsRemovedMutation.mutateAsync({ reviewId, reason })
                }
                onRestore={(reviewId) => restoreMutation.mutateAsync(reviewId)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

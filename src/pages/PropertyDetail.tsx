import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Home, MapPin, Users, Bed, DollarSign, Calendar, TrendingUp, Percent } from "lucide-react";
import { startOfMonth, endOfMonth, getDaysInMonth, format, parseISO, differenceInDays, addDays, isSameMonth, subMonths } from "date-fns";
import { TrendChart } from "@/components/TrendChart";
import { PacingReport } from "@/components/PacingReport";
import { GoalsComparison } from "@/components/GoalsComparison";
import { PropertySettings } from "@/components/PropertySettings";
import { RevenueForecast } from "@/components/RevenueForecast";

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [listing, setListing] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
  const [goalsData, setGoalsData] = useState<any[]>([]);
  const [revenueForecast, setRevenueForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
        .in("status", ["confirmed", "checked_out"])
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

  // Calculate year-over-year occupancy comparison

  const calculateYearOverYearOccupancy = () => {
    if (reservations.length === 0) return [];

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    // Initialize data structures for both years
    const currentYearData = new Map<string, { nightsBooked: number; totalDays: number }>();
    const lastYearData = new Map<string, { nightsBooked: number; totalDays: number }>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      currentYearData.set(currentKey, { nightsBooked: 0, totalDays: getDaysInMonth(currentDate) });
      lastYearData.set(lastKey, { nightsBooked: 0, totalDays: getDaysInMonth(lastDate) });
    }

    // Process each reservation
    reservations.forEach((reservation) => {
      if (!reservation.check_in || !reservation.check_out) return;

      const checkIn = parseISO(reservation.check_in);
      const checkOut = parseISO(reservation.check_out);
      
      // Iterate through each night of the reservation
      let currentNight = checkIn;
      while (currentNight < checkOut) {
        const monthKey = format(currentNight, 'yyyy-MM');
        const year = currentNight.getFullYear();
        
        if (year === currentYear && currentYearData.has(monthKey)) {
          const data = currentYearData.get(monthKey)!;
          data.nightsBooked++;
        } else if (year === lastYear && lastYearData.has(monthKey)) {
          const data = lastYearData.get(monthKey)!;
          data.nightsBooked++;
        }
        
        currentNight = addDays(currentNight, 1);
      }
    });

    // Combine data by month name
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      const currentData = currentYearData.get(currentKey) || { nightsBooked: 0, totalDays: getDaysInMonth(currentDate) };
      const lastData = lastYearData.get(lastKey) || { nightsBooked: 0, totalDays: getDaysInMonth(lastDate) };
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: (currentData.nightsBooked / currentData.totalDays) * 100,
        lastYear: (lastData.nightsBooked / lastData.totalDays) * 100,
      });
    }

    return result;
  };

  const calculateYearOverYearRevenue = () => {
    if (reservations.length === 0) return [];

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    // Initialize data structures for both years
    const currentYearData = new Map<string, number>();
    const lastYearData = new Map<string, number>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentKey = format(new Date(currentYear, month, 1), 'yyyy-MM');
      const lastKey = format(new Date(lastYear, month, 1), 'yyyy-MM');
      
      currentYearData.set(currentKey, 0);
      lastYearData.set(lastKey, 0);
    }

    // Process each reservation - assign revenue to check-in month
    reservations.forEach((reservation) => {
      if (!reservation.check_in || !reservation.fare_accommodation_adjusted) return;

      const checkIn = parseISO(reservation.check_in);
      const monthKey = format(checkIn, 'yyyy-MM');
      const year = checkIn.getFullYear();
      const revenue = parseFloat(reservation.fare_accommodation_adjusted);
      
      if (year === currentYear && currentYearData.has(monthKey)) {
        currentYearData.set(monthKey, currentYearData.get(monthKey)! + revenue);
      } else if (year === lastYear && lastYearData.has(monthKey)) {
        lastYearData.set(monthKey, lastYearData.get(monthKey)! + revenue);
      }
    });

    // Combine data by month name
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: currentYearData.get(currentKey) || 0,
        lastYear: lastYearData.get(lastKey) || 0,
      });
    }

    return result;
  };

  const calculateYearOverYearRevPAR = () => {
    if (reservations.length === 0) return [];

    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    // Initialize data structures for both years - tracking revenue and nights
    const currentYearData = new Map<string, { revenue: number; nightsBooked: number; totalDays: number }>();
    const lastYearData = new Map<string, { revenue: number; nightsBooked: number; totalDays: number }>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      currentYearData.set(currentKey, { revenue: 0, nightsBooked: 0, totalDays: getDaysInMonth(currentDate) });
      lastYearData.set(lastKey, { revenue: 0, nightsBooked: 0, totalDays: getDaysInMonth(lastDate) });
    }

    // Process each reservation
    reservations.forEach((reservation) => {
      if (!reservation.check_in || !reservation.check_out) return;

      const checkIn = parseISO(reservation.check_in);
      const checkOut = parseISO(reservation.check_out);
      const revenue = parseFloat(reservation.fare_accommodation_adjusted || 0);
      
      // For revenue, assign to check-in month
      const checkInMonthKey = format(checkIn, 'yyyy-MM');
      const checkInYear = checkIn.getFullYear();
      
      if (checkInYear === currentYear && currentYearData.has(checkInMonthKey)) {
        const data = currentYearData.get(checkInMonthKey)!;
        data.revenue += revenue;
      } else if (checkInYear === lastYear && lastYearData.has(checkInMonthKey)) {
        const data = lastYearData.get(checkInMonthKey)!;
        data.revenue += revenue;
      }
      
      // For nights, iterate through each night of the reservation
      let currentNight = checkIn;
      while (currentNight < checkOut) {
        const monthKey = format(currentNight, 'yyyy-MM');
        const year = currentNight.getFullYear();
        
        if (year === currentYear && currentYearData.has(monthKey)) {
          const data = currentYearData.get(monthKey)!;
          data.nightsBooked++;
        } else if (year === lastYear && lastYearData.has(monthKey)) {
          const data = lastYearData.get(monthKey)!;
          data.nightsBooked++;
        }
        
        currentNight = addDays(currentNight, 1);
      }
    });

    // Calculate RevPAR for each month
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      const currentData = currentYearData.get(currentKey)!;
      const lastData = lastYearData.get(lastKey)!;
      
      // Calculate ADR and Occupancy, then RevPAR = ADR × Occupancy
      const currentADR = currentData.nightsBooked > 0 ? currentData.revenue / currentData.nightsBooked : 0;
      const currentOccupancy = (currentData.nightsBooked / currentData.totalDays) * 100;
      const currentRevPAR = currentADR * (currentOccupancy / 100);
      
      const lastADR = lastData.nightsBooked > 0 ? lastData.revenue / lastData.nightsBooked : 0;
      const lastOccupancy = (lastData.nightsBooked / lastData.totalDays) * 100;
      const lastRevPAR = lastADR * (lastOccupancy / 100);
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: currentRevPAR,
        lastYear: lastRevPAR,
      });
    }

    return result;
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

    // Process each reservation
    reservations.forEach((reservation) => {
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

    // Process each reservation - assign revenue to check-in month
    reservations.forEach((reservation) => {
      if (!reservation.check_in || !reservation.fare_accommodation_adjusted) return;

      const checkIn = parseISO(reservation.check_in);
      const monthKey = format(checkIn, 'yyyy-MM');
      
      if (monthlyData.has(monthKey)) {
        const currentRevenue = monthlyData.get(monthKey)!;
        monthlyData.set(monthKey, currentRevenue + parseFloat(reservation.fare_accommodation_adjusted));
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

  const calculateMetrics = () => {
    if (reservations.length === 0) {
      return {
        totalReservations: 0,
        totalRevenue: 0,
        totalNights: 0,
        averageADR: 0,
        averageNightsPerReservation: 0,
        totalGuests: 0,
        averageGuestsPerReservation: 0,
        overallOccupancy: 0,
        revPAR: 0,
      };
    }

    // Filter to last 12 months only
    const twelveMonthsAgo = subMonths(new Date(), 12);
    const last12MonthsReservations = reservations.filter((r) => {
      if (!r.check_in) return false;
      const checkInDate = parseISO(r.check_in);
      return checkInDate >= twelveMonthsAgo;
    });

    if (last12MonthsReservations.length === 0) {
      return {
        totalReservations: 0,
        totalRevenue: 0,
        totalNights: 0,
        averageADR: 0,
        averageNightsPerReservation: 0,
        totalGuests: 0,
        averageGuestsPerReservation: 0,
        overallOccupancy: 0,
        revPAR: 0,
      };
    }

    const totalRevenue = last12MonthsReservations.reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
    const totalNights = last12MonthsReservations.reduce((sum, r) => sum + (r.nights_count || 0), 0);
    const totalGuests = last12MonthsReservations.reduce((sum, r) => sum + (r.guests_count || 0), 0);
    const averageADR = totalNights > 0 ? totalRevenue / totalNights : 0;
    const averageNightsPerReservation = totalNights / last12MonthsReservations.length;
    const averageGuestsPerReservation = totalGuests / last12MonthsReservations.length;

    // Calculate overall occupancy for last 12 months
    const monthlyOccupancy = calculateMonthlyOccupancy();
    const overallOccupancy = monthlyOccupancy.length > 0
      ? monthlyOccupancy.reduce((sum, month) => sum + month.occupancyRate, 0) / monthlyOccupancy.length
      : 0;

    // Calculate RevPAR = ADR × Occupancy Rate
    const revPAR = averageADR * (overallOccupancy / 100);

    return {
      totalReservations: last12MonthsReservations.length,
      totalRevenue,
      totalNights,
      averageADR,
      averageNightsPerReservation,
      totalGuests,
      averageGuestsPerReservation,
      overallOccupancy,
      revPAR,
    };
  };

  const metrics = calculateMetrics();
  const yearOverYearOccupancy = calculateYearOverYearOccupancy();
  const yearOverYearRevenue = calculateYearOverYearRevenue();
  const yearOverYearRevPAR = calculateYearOverYearRevPAR();

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
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/listings")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-3xl font-bold tracking-tight">{listing.nickname || "Unnamed Property"}</h2>
              <p className="text-muted-foreground flex items-center gap-1 mt-1">
                <MapPin className="h-4 w-4" />
                {getAddress(listing.address)}
              </p>
            </div>
          </div>
          <PropertySettings listingId={id!} />
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
                      Projection Goal Achievement
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

        {/* Metrics Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Percent className="h-4 w-4 text-muted-foreground" />
                Occupancy Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.overallOccupancy.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">Last 12 months</p>
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
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                RevPAR
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${metrics.revPAR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Revenue per available room</p>
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

        {/* Charts */}
        <TrendChart 
          occupancyData={yearOverYearOccupancy}
          revenueData={yearOverYearRevenue}
          revparData={yearOverYearRevPAR}
          goalsData={goalsData}
          reservations={reservations}
          revenueForecast={revenueForecast}
        />

        {/* Pacing Report */}
        <PacingReport reservations={reservations} />

        {/* Revenue Forecast */}
        <RevenueForecast listingId={id!} />

        {/* Goals Comparison */}
        <GoalsComparison listingId={id!} reservations={reservations} />

        {/* Recent Reservations */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Confirmed Reservations</CardTitle>
            <CardDescription>
              Showing the most recent confirmed bookings for this property
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reservations.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No confirmed reservations found for this property
              </p>
            ) : (
              <div className="space-y-4">
                {reservations.slice(0, 5).map((reservation) => {
                  const adr = reservation.nights_count > 0
                    ? parseFloat(reservation.fare_accommodation_adjusted || 0) / reservation.nights_count
                    : 0;
                  
                  return (
                    <div
                      key={reservation.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {new Date(reservation.check_in).toLocaleDateString()} -{" "}
                            {new Date(reservation.check_out).toLocaleDateString()}
                          </span>
                          {reservation.source && (
                            <Badge variant="outline" className="text-xs">
                              {reservation.source}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>{reservation.nights_count} nights</span>
                          <span>{reservation.guests_count} guests</span>
                          <span>ADR: ${adr.toFixed(0)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold">
                          ${parseFloat(reservation.fare_accommodation_adjusted || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-xs text-muted-foreground">Total</div>
                      </div>
                    </div>
                  );
                })}
                {reservations.length > 5 && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate("/reservations")}
                  >
                    View All Reservations
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

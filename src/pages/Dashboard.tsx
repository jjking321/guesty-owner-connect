import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Home, Calendar, TrendingUp, Plus, RefreshCw, CalendarIcon, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Date range filters - default to current year
  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState<Date>(new Date(currentYear, 0, 1));
  const [endDate, setEndDate] = useState<Date>(new Date(currentYear, 11, 31));
  const [showCustomDates, setShowCustomDates] = useState(false);

  // React Query for Guesty Accounts with caching
  const { data: guestyAccounts = [] } = useQuery({
    queryKey: ['guesty-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guesty_accounts")
        .select("id, account_name, organization_id");
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
  });

  // React Query for Reservations with optimized columns
  const { data: reservations = [], isLoading: reservationsLoading, refetch: refetchReservations } = useQuery({
    queryKey: ['dashboard-reservations', startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      const allReservations: any[] = [];
      const batchSize = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error } = await supabase
          .from("reservations")
          .select("id, listing_id, check_in, check_out, fare_accommodation_adjusted, nights_count, guests_count, status, source, confirmation_code")
          .in("status", ["confirmed", "checked_in", "checked_out"])
          .gte("check_in", startDateStr)
          .lte("check_in", endDateStr)
          .order("check_in", { ascending: false })
          .range(offset, offset + batchSize - 1);

        if (error) throw error;
        
        if (batch && batch.length > 0) {
          allReservations.push(...batch);
          offset += batchSize;
          hasMore = batch.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      return allReservations;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });

  // React Query for Listings with optimized columns
  const { data: listings = [], isLoading: listingsLoading, refetch: refetchListings } = useQuery({
    queryKey: ['dashboard-listings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, active, archived, bedrooms, address")
        .eq("archived", false);
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });

  const loading = reservationsLoading || listingsLoading;

  const handleRefresh = async () => {
    await Promise.all([
      refetchReservations(),
      refetchListings()
    ]);
    toast({
      title: "Data refreshed",
      description: "Dashboard data has been updated",
    });
  };

  // Memoized metrics calculations
  const metrics = useMemo(() => {
    const totalRevenue = reservations.reduce((sum, r) => sum + (parseFloat(r.fare_accommodation_adjusted || 0)), 0);
    const totalBookings = reservations.length;
    const activeListings = listings.filter(l => l.active).length;
    const avgNightlyRate = reservations.length > 0
      ? reservations.reduce((sum, r) => sum + (parseFloat(r.fare_accommodation_adjusted || 0) / (r.nights_count || 1)), 0) / reservations.length
      : 0;

    return { totalRevenue, totalBookings, activeListings, avgNightlyRate };
  }, [reservations, listings]);

  // Memoized chart data
  const chartData = useMemo(() => {
    const revenueByMonth = reservations.reduce((acc: any, r) => {
      if (!r.check_in) return acc;
      const checkInDate = new Date(r.check_in);
      const yearMonth = `${checkInDate.getFullYear()}-${String(checkInDate.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = checkInDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      
      if (!acc[yearMonth]) {
        acc[yearMonth] = { month: monthLabel, revenue: 0, bookings: 0, sortKey: yearMonth };
      }
      acc[yearMonth].revenue += parseFloat(r.fare_accommodation_adjusted || 0);
      acc[yearMonth].bookings += 1;
      return acc;
    }, {});

    return Object.values(revenueByMonth)
      .sort((a: any, b: any) => a.sortKey.localeCompare(b.sortKey))
      .slice(-12);
  }, [reservations]);

  // Memoized top properties
  const topProperties = useMemo(() => {
    const propertyRevenue = reservations.reduce((acc: any, r) => {
      const listing = listings.find(l => l.id === r.listing_id);
      const propName = listing?.nickname || r.listing_id;
      if (!acc[propName]) {
        acc[propName] = { name: propName, revenue: 0, bookings: 0 };
      }
      acc[propName].revenue += parseFloat(r.fare_accommodation_adjusted || 0);
      acc[propName].bookings += 1;
      return acc;
    }, {});

    return Object.values(propertyRevenue)
      .sort((a: any, b: any) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [reservations, listings]);

  // Memoized bedroom data
  const bedroomData = useMemo(() => {
    const propertiesByBedrooms = listings.filter(l => l.active).reduce((acc: any, listing) => {
      const bedrooms = listing.bedrooms || 0;
      const label = bedrooms === 0 ? 'Studio' : `${bedrooms} BR`;
      if (!acc[label]) {
        acc[label] = { bedrooms: label, count: 0, sortKey: bedrooms };
      }
      acc[label].count += 1;
      return acc;
    }, {});

    return Object.values(propertiesByBedrooms)
      .sort((a: any, b: any) => a.sortKey - b.sortKey);
  }, [listings]);

  // Memoized city data
  const cityData = useMemo(() => {
    const propertiesByCity = listings.filter(l => l.active).reduce((acc: any, listing) => {
      const address = listing.address as any;
      const city = address?.city || 'Unknown';
      if (!acc[city]) {
        acc[city] = { city, count: 0 };
      }
      acc[city].count += 1;
      return acc;
    }, {});

    return Object.values(propertiesByCity)
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 10);
  }, [listings]);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-muted-foreground">
              {showCustomDates 
                ? `${format(startDate, "MMM d, yyyy")} - ${format(endDate, "MMM d, yyyy")}`
                : `${format(startDate, "yyyy")} Performance Overview`}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!showCustomDates ? (
              <Button onClick={() => setShowCustomDates(true)} variant="outline">
                <CalendarIcon className="mr-2 h-4 w-4" />
                Custom Date Range
              </Button>
            ) : (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("justify-start text-left font-normal")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(startDate, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={(date) => date && setStartDate(date)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("justify-start text-left font-normal")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(endDate, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={endDate}
                      onSelect={(date) => date && setEndDate(date)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <Button 
                  onClick={() => {
                    setShowCustomDates(false);
                    setStartDate(new Date(currentYear, 0, 1));
                    setEndDate(new Date(currentYear, 11, 31));
                  }} 
                  variant="outline"
                  size="icon"
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button onClick={handleRefresh} variant="outline" disabled={loading}>
              <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button onClick={() => navigate("/settings")}>
              <Plus className="mr-2 h-4 w-4" />
              {guestyAccounts.length === 0 ? "Connect Guesty" : "Manage"}
            </Button>
          </div>
        </div>

        {/* No account warning */}
        {guestyAccounts.length === 0 && (
          <Card className="border-accent">
            <CardHeader>
              <CardTitle>Welcome to Revenue Manager!</CardTitle>
              <CardDescription>
                To get started, connect your Guesty account to import your listings and reservations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate("/settings")}>
                <Plus className="mr-2 h-4 w-4" />
                Connect Guesty Account
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Metrics */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Revenue"
            value={`$${metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={DollarSign}
            description={showCustomDates ? "Selected period" : `Year ${currentYear}`}
          />
          <MetricCard
            title="Total Bookings"
            value={metrics.totalBookings}
            icon={Calendar}
            description="All confirmed reservations"
          />
          <MetricCard
            title="Active Listings"
            value={metrics.activeListings}
            icon={Home}
            description="Currently active properties"
          />
          <MetricCard
            title="Avg Nightly Rate"
            value={`$${metrics.avgNightlyRate.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            icon={TrendingUp}
            description="Across all properties"
          />
        </div>

        {/* Charts */}
        {reservations.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Revenue Over Time</CardTitle>
                <CardDescription>Monthly accommodation revenue trends</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: any) => [`$${parseFloat(value).toLocaleString()}`, "Revenue"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ fill: "hsl(var(--primary))" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Performing Properties</CardTitle>
                <CardDescription>By total accommodation revenue</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topProperties}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" angle={-45} textAnchor="end" height={80} />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: any) => [`$${parseFloat(value).toLocaleString()}`, "Revenue"]}
                    />
                    <Bar dataKey="revenue" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Property Distribution Charts */}
        {listings.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Properties by Bedroom Count</CardTitle>
                <CardDescription>Distribution of properties by size</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={bedroomData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="bedrooms" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: any) => [value, "Properties"]}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Properties by City</CardTitle>
                <CardDescription>Top locations (up to 10)</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={cityData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="city" className="text-xs" angle={-45} textAnchor="end" height={80} />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: any) => [value, "Properties"]}
                    />
                    <Bar dataKey="count" fill="hsl(var(--accent))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recent Bookings */}
        {reservations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Bookings</CardTitle>
              <CardDescription>Latest confirmed reservations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {reservations.slice(0, 5).map((reservation) => {
                  const listing = listings.find(l => l.id === reservation.listing_id);
                  return (
                    <div key={reservation.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="space-y-1">
                        <p className="font-medium">{listing?.nickname || reservation.listing_id}</p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(reservation.check_in).toLocaleDateString()} - {new Date(reservation.check_out).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {reservation.nights_count} nights • {reservation.guests_count} guests • {reservation.source}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">
                          ${parseFloat(reservation.fare_accommodation_adjusted || 0).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">Accommodation</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

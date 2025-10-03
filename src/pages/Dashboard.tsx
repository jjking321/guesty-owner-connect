import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MetricCard } from "@/components/MetricCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Home, Calendar, TrendingUp, Plus, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";

export default function Dashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [guestyAccounts, setGuestyAccounts] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load Guesty accounts
      const { data: accounts, error: accountsError } = await supabase
        .from("guesty_accounts")
        .select("*");

      if (accountsError) throw accountsError;
      setGuestyAccounts(accounts || []);

      // Load reservations from the last year
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];

      const { data: reservationsData, error: reservationsError } = await supabase
        .from("reservations")
        .select("*")
        .gte("check_in", oneYearAgoStr)
        .order("check_in", { ascending: false });

      if (reservationsError) throw reservationsError;
      setReservations(reservationsData || []);

      // Load listings
      const { data: listingsData, error: listingsError } = await supabase
        .from("listings")
        .select("*");

      if (listingsError) throw listingsError;
      setListings(listingsData || []);
    } catch (error: any) {
      toast({
        title: "Error loading data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Calculate metrics based on accommodation fare
  const totalRevenue = reservations.reduce((sum, r) => sum + (parseFloat(r.fare_accommodation_adjusted || 0)), 0);
  const totalBookings = reservations.length;
  const activeListings = listings.filter(l => l.active).length;
  const avgNightlyRate = reservations.length > 0
    ? reservations.reduce((sum, r) => sum + (parseFloat(r.fare_accommodation_adjusted || 0) / (r.nights_count || 1)), 0) / reservations.length
    : 0;

  // Prepare chart data - group by month
  const revenueByMonth = reservations.reduce((acc: any, r) => {
    if (!r.check_in) return acc;
    const month = new Date(r.check_in).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    if (!acc[month]) {
      acc[month] = { month, revenue: 0, bookings: 0 };
    }
    acc[month].revenue += parseFloat(r.fare_accommodation_adjusted || 0);
    acc[month].bookings += 1;
    return acc;
  }, {});

  const chartData = Object.values(revenueByMonth).slice(-12);

  // Top performing properties
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

  const topProperties = Object.values(propertyRevenue)
    .sort((a: any, b: any) => b.revenue - a.revenue)
    .slice(0, 5);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <p className="text-muted-foreground">Overview of your vacation rental performance</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadData} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
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
            value={`$${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={DollarSign}
            description="Accommodation fare (past year)"
          />
          <MetricCard
            title="Total Bookings"
            value={totalBookings}
            icon={Calendar}
            description="All confirmed reservations"
          />
          <MetricCard
            title="Active Listings"
            value={activeListings}
            icon={Home}
            description="Currently active properties"
          />
          <MetricCard
            title="Avg Nightly Rate"
            value={`$${avgNightlyRate.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
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

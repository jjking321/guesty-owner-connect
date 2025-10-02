import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Home, MapPin, Users, Bed, DollarSign, Calendar, TrendingUp } from "lucide-react";

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [listing, setListing] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
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

      // Load confirmed reservations for this property
      const { data: reservationsData, error: reservationsError } = await supabase
        .from("reservations")
        .select("*")
        .eq("listing_id", id)
        .eq("status", "confirmed")
        .order("check_in", { ascending: false });

      if (reservationsError) throw reservationsError;
      setReservations(reservationsData || []);
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
      };
    }

    const totalRevenue = reservations.reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
    const totalNights = reservations.reduce((sum, r) => sum + (r.nights_count || 0), 0);
    const totalGuests = reservations.reduce((sum, r) => sum + (r.guests_count || 0), 0);
    const averageADR = totalNights > 0 ? totalRevenue / totalNights : 0;
    const averageNightsPerReservation = totalNights / reservations.length;
    const averageGuestsPerReservation = totalGuests / reservations.length;

    return {
      totalReservations: reservations.length,
      totalRevenue,
      totalNights,
      averageADR,
      averageNightsPerReservation,
      totalGuests,
      averageGuestsPerReservation,
    };
  };

  const metrics = calculateMetrics();

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

        {/* Property Image and Details */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2 overflow-hidden">
            <div className="aspect-video w-full overflow-hidden bg-muted">
              <img
                src={listing.thumbnail || "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=600&fit=crop"}
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
            </CardContent>
          </Card>
        </div>

        {/* Metrics Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Total Guests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.totalGuests}</div>
              <p className="text-xs text-muted-foreground mt-1">All confirmed bookings</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Avg Guests/Reservation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.averageGuestsPerReservation.toFixed(1)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Average party size</p>
            </CardContent>
          </Card>
        </div>

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

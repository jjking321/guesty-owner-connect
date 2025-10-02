import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Search } from "lucide-react";

export default function Reservations() {
  const { toast } = useToast();
  const [reservations, setReservations] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load reservations
      const { data: reservationsData, error: reservationsError } = await supabase
        .from("reservations")
        .select("*")
        .order("check_in", { ascending: false });

      if (reservationsError) throw reservationsError;
      setReservations(reservationsData || []);

      // Load listings for display
      const { data: listingsData, error: listingsError } = await supabase
        .from("listings")
        .select("*");

      if (listingsError) throw listingsError;
      setListings(listingsData || []);
    } catch (error: any) {
      toast({
        title: "Error loading reservations",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getListingName = (listingId: string) => {
    const listing = listings.find(l => l.id === listingId);
    return listing?.nickname || listingId;
  };

  const getListingAddress = (listingId: string) => {
    const listing = listings.find(l => l.id === listingId);
    if (!listing?.address) return "";
    const parts = [listing.address.city, listing.address.state].filter(Boolean);
    return parts.join(", ");
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "confirmed": return "default";
      case "inquiry": return "secondary";
      case "cancelled": return "destructive";
      default: return "outline";
    }
  };

  const filteredReservations = reservations.filter((reservation) => {
    const searchLower = searchQuery.toLowerCase();
    const listingName = getListingName(reservation.listing_id).toLowerCase();
    const confirmationCode = reservation.confirmation_code?.toLowerCase() || "";
    const source = reservation.source?.toLowerCase() || "";
    
    return (
      listingName.includes(searchLower) ||
      confirmationCode.includes(searchLower) ||
      source.includes(searchLower)
    );
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reservations</h2>
            <p className="text-muted-foreground">View and manage all your bookings</p>
          </div>
          <Button onClick={loadData} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by property, confirmation code, or source..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading reservations...</div>
        ) : reservations.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Reservations Found</CardTitle>
              <CardDescription>
                Sync your Guesty account to see reservations here.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : filteredReservations.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Reservations Match Your Search</CardTitle>
              <CardDescription>
                Try adjusting your search terms.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Check In</TableHead>
                  <TableHead>Check Out</TableHead>
                  <TableHead className="text-center">Nights</TableHead>
                  <TableHead className="text-center">Guests</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Accommodation</TableHead>
                  <TableHead className="text-right">Owner Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReservations.map((reservation) => (
                  <TableRow key={reservation.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{getListingName(reservation.listing_id)}</div>
                        {getListingAddress(reservation.listing_id) && (
                          <div className="text-xs text-muted-foreground">
                            {getListingAddress(reservation.listing_id)}
                          </div>
                        )}
                        {reservation.confirmation_code && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {reservation.confirmation_code}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(reservation.check_in).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {new Date(reservation.check_out).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-center">
                      {reservation.nights_count}
                    </TableCell>
                    <TableCell className="text-center">
                      {reservation.guests_count}
                    </TableCell>
                    <TableCell>
                      {reservation.source && (
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-muted">
                          {reservation.source}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusColor(reservation.status)}>
                        {reservation.status || "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      ${parseFloat(reservation.fare_accommodation_adjusted || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      ${parseFloat(reservation.owner_revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

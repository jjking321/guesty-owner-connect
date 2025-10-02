import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Filter, X, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function Reservations() {
  const { toast } = useToast();
  const [reservations, setReservations] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filter states
  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [checkInFrom, setCheckInFrom] = useState<Date | undefined>();
  const [checkInTo, setCheckInTo] = useState<Date | undefined>();
  const [minNights, setMinNights] = useState<string>("");
  const [maxNights, setMaxNights] = useState<string>("");
  const [minGuests, setMinGuests] = useState<string>("");
  const [maxGuests, setMaxGuests] = useState<string>("");
  const [minAccommodation, setMinAccommodation] = useState<string>("");
  const [maxAccommodation, setMaxAccommodation] = useState<string>("");

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

  const clearFilters = () => {
    setSelectedProperty("all");
    setSelectedSource("all");
    setSelectedStatus("all");
    setCheckInFrom(undefined);
    setCheckInTo(undefined);
    setMinNights("");
    setMaxNights("");
    setMinGuests("");
    setMaxGuests("");
    setMinAccommodation("");
    setMaxAccommodation("");
  };

  const uniqueSources = Array.from(new Set(reservations.map(r => r.source).filter(Boolean)));
  const uniqueStatuses = Array.from(new Set(reservations.map(r => r.status).filter(Boolean)));
  
  const filteredReservations = reservations.filter((reservation) => {
    // Property filter
    if (selectedProperty !== "all" && reservation.listing_id !== selectedProperty) {
      return false;
    }
    
    // Source filter
    if (selectedSource !== "all" && reservation.source !== selectedSource) {
      return false;
    }
    
    // Status filter
    if (selectedStatus !== "all" && reservation.status !== selectedStatus) {
      return false;
    }
    
    // Check-in date filter
    if (checkInFrom && new Date(reservation.check_in) < checkInFrom) {
      return false;
    }
    if (checkInTo && new Date(reservation.check_in) > checkInTo) {
      return false;
    }
    
    // Nights filter
    if (minNights && reservation.nights_count < parseInt(minNights)) {
      return false;
    }
    if (maxNights && reservation.nights_count > parseInt(maxNights)) {
      return false;
    }
    
    // Guests filter
    if (minGuests && reservation.guests_count < parseInt(minGuests)) {
      return false;
    }
    if (maxGuests && reservation.guests_count > parseInt(maxGuests)) {
      return false;
    }
    
    // Accommodation filter
    if (minAccommodation && parseFloat(reservation.fare_accommodation_adjusted || 0) < parseFloat(minAccommodation)) {
      return false;
    }
    if (maxAccommodation && parseFloat(reservation.fare_accommodation_adjusted || 0) > parseFloat(maxAccommodation)) {
      return false;
    }
    
    return true;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reservations</h2>
            <p className="text-muted-foreground">View and manage all your bookings</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowFilters(!showFilters)} variant="outline">
              <Filter className="mr-2 h-4 w-4" />
              {showFilters ? "Hide" : "Show"} Filters
            </Button>
            <Button onClick={loadData} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {showFilters && (
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Filters</CardTitle>
                <Button onClick={clearFilters} variant="ghost" size="sm">
                  <X className="mr-2 h-4 w-4" />
                  Clear All
                </Button>
              </div>
            </CardHeader>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Property</label>
                  <Select value={selectedProperty} onValueChange={setSelectedProperty}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Properties" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Properties</SelectItem>
                      {listings.map((listing) => (
                        <SelectItem key={listing.id} value={listing.id}>
                          {listing.nickname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Source</label>
                  <Select value={selectedSource} onValueChange={setSelectedSource}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      {uniqueSources.map((source) => (
                        <SelectItem key={source} value={source}>
                          {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      {uniqueStatuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Check-In From</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !checkInFrom && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {checkInFrom ? format(checkInFrom, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={checkInFrom}
                        onSelect={setCheckInFrom}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Check-In To</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !checkInTo && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {checkInTo ? format(checkInTo, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={checkInTo}
                        onSelect={setCheckInTo}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min Nights</label>
                  <Input
                    type="number"
                    placeholder="Min"
                    value={minNights}
                    onChange={(e) => setMinNights(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Nights</label>
                  <Input
                    type="number"
                    placeholder="Max"
                    value={maxNights}
                    onChange={(e) => setMaxNights(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min Guests</label>
                  <Input
                    type="number"
                    placeholder="Min"
                    value={minGuests}
                    onChange={(e) => setMinGuests(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Guests</label>
                  <Input
                    type="number"
                    placeholder="Max"
                    value={maxGuests}
                    onChange={(e) => setMaxGuests(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min Accommodation ($)</label>
                  <Input
                    type="number"
                    placeholder="Min"
                    value={minAccommodation}
                    onChange={(e) => setMinAccommodation(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Accommodation ($)</label>
                  <Input
                    type="number"
                    placeholder="Max"
                    value={maxAccommodation}
                    onChange={(e) => setMaxAccommodation(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </Card>
        )}

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
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead className="text-right">Owner Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReservations.map((reservation) => {
                  const adr = reservation.nights_count > 0 
                    ? parseFloat(reservation.fare_accommodation_adjusted || 0) / reservation.nights_count 
                    : 0;
                  
                  return (
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
                        ${adr.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ${parseFloat(reservation.owner_revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

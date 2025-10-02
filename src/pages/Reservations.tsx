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
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Filter, X, CalendarIcon, Columns, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
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

  // Column visibility states
  const [visibleColumns, setVisibleColumns] = useState({
    property: true,
    checkIn: true,
    checkOut: true,
    nights: true,
    guests: true,
    source: true,
    status: true,
    accommodation: true,
    adr: true,
    ownerRevenue: true,
  });

  // Sorting states
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    loadData();
    loadDefaultView();
  }, []);

  const loadDefaultView = () => {
    const savedView = localStorage.getItem('reservations_default_view');
    if (savedView) {
      try {
        const view = JSON.parse(savedView);
        if (view.visibleColumns) setVisibleColumns(view.visibleColumns);
        if (view.filters) {
          setSelectedProperty(view.filters.selectedProperty || "all");
          setSelectedSource(view.filters.selectedSource || "all");
          setSelectedStatus(view.filters.selectedStatus || "all");
          setMinNights(view.filters.minNights || "");
          setMaxNights(view.filters.maxNights || "");
          setMinGuests(view.filters.minGuests || "");
          setMaxGuests(view.filters.maxGuests || "");
          setMinAccommodation(view.filters.minAccommodation || "");
          setMaxAccommodation(view.filters.maxAccommodation || "");
        }
        toast({
          title: "Default view loaded",
          description: "Your saved view has been applied.",
        });
      } catch (error) {
        console.error("Error loading saved view:", error);
      }
    }
  };

  const saveDefaultView = () => {
    const view = {
      visibleColumns,
      filters: {
        selectedProperty,
        selectedSource,
        selectedStatus,
        minNights,
        maxNights,
        minGuests,
        maxGuests,
        minAccommodation,
        maxAccommodation,
      },
    };
    localStorage.setItem('reservations_default_view', JSON.stringify(view));
    toast({
      title: "Default view saved",
      description: "Your current view has been saved as default.",
    });
  };

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

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) return <ArrowUpDown className="ml-2 h-4 w-4" />;
    return sortDirection === "asc" ? <ArrowUp className="ml-2 h-4 w-4" /> : <ArrowDown className="ml-2 h-4 w-4" />;
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
  
  let filteredReservations = reservations.filter((reservation) => {
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

  // Apply sorting
  if (sortColumn) {
    filteredReservations = [...filteredReservations].sort((a, b) => {
      let aValue, bValue;

      switch (sortColumn) {
        case "property":
          aValue = getListingName(a.listing_id).toLowerCase();
          bValue = getListingName(b.listing_id).toLowerCase();
          break;
        case "checkIn":
          aValue = new Date(a.check_in).getTime();
          bValue = new Date(b.check_in).getTime();
          break;
        case "checkOut":
          aValue = new Date(a.check_out).getTime();
          bValue = new Date(b.check_out).getTime();
          break;
        case "nights":
          aValue = a.nights_count || 0;
          bValue = b.nights_count || 0;
          break;
        case "guests":
          aValue = a.guests_count || 0;
          bValue = b.guests_count || 0;
          break;
        case "source":
          aValue = (a.source || "").toLowerCase();
          bValue = (b.source || "").toLowerCase();
          break;
        case "status":
          aValue = (a.status || "").toLowerCase();
          bValue = (b.status || "").toLowerCase();
          break;
        case "accommodation":
          aValue = parseFloat(a.fare_accommodation_adjusted || 0);
          bValue = parseFloat(b.fare_accommodation_adjusted || 0);
          break;
        case "adr":
          aValue = a.nights_count > 0 ? parseFloat(a.fare_accommodation_adjusted || 0) / a.nights_count : 0;
          bValue = b.nights_count > 0 ? parseFloat(b.fare_accommodation_adjusted || 0) / b.nights_count : 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reservations</h2>
            <p className="text-muted-foreground">View and manage all your bookings</p>
          </div>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <Columns className="mr-2 h-4 w-4" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-3">Toggle Columns</h4>
                    <div className="space-y-2">
                      {Object.entries({
                        property: "Property",
                        checkIn: "Check In",
                        checkOut: "Check Out",
                        nights: "Nights",
                        guests: "Guests",
                        source: "Source",
                        status: "Status",
                        accommodation: "Accommodation",
                        adr: "ADR",
                        ownerRevenue: "Owner Revenue",
                      }).map(([key, label]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <Checkbox
                            id={key}
                            checked={visibleColumns[key as keyof typeof visibleColumns]}
                            onCheckedChange={(checked) =>
                              setVisibleColumns((prev) => ({ ...prev, [key]: checked }))
                            }
                          />
                          <label
                            htmlFor={key}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                          >
                            {label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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
                <Button onClick={() => setShowFilters(false)} variant="ghost" size="sm">
                  <X className="h-4 w-4" />
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

              <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                <Button onClick={clearFilters} variant="outline" size="sm">
                  Clear All Filters
                </Button>
                <Button onClick={saveDefaultView} variant="default" size="sm">
                  Save as Default View
                </Button>
              </div>
            </div>
          </Card>
        )}

        {!loading && reservations.length > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing <span className="font-semibold text-foreground">{filteredReservations.length}</span> of{" "}
              <span className="font-semibold text-foreground">{reservations.length}</span> reservations
            </span>
          </div>
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
                  {visibleColumns.property && (
                    <TableHead>
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("property")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Property
                        {getSortIcon("property")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.checkIn && (
                    <TableHead>
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("checkIn")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Check In
                        {getSortIcon("checkIn")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.checkOut && (
                    <TableHead>
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("checkOut")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Check Out
                        {getSortIcon("checkOut")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.nights && (
                    <TableHead className="text-center">
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("nights")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Nights
                        {getSortIcon("nights")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.guests && (
                    <TableHead className="text-center">
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("guests")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Guests
                        {getSortIcon("guests")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.source && (
                    <TableHead>
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("source")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Source
                        {getSortIcon("source")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.status && (
                    <TableHead>
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("status")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Status
                        {getSortIcon("status")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.accommodation && (
                    <TableHead className="text-right">
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("accommodation")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        Accommodation
                        {getSortIcon("accommodation")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.adr && (
                    <TableHead className="text-right">
                      <Button
                        variant="ghost"
                        onClick={() => handleSort("adr")}
                        className="h-auto p-0 hover:bg-transparent"
                      >
                        ADR
                        {getSortIcon("adr")}
                      </Button>
                    </TableHead>
                  )}
                  {visibleColumns.ownerRevenue && (
                    <TableHead className="text-right">Owner Revenue</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReservations.map((reservation) => {
                  const adr = reservation.nights_count > 0 
                    ? parseFloat(reservation.fare_accommodation_adjusted || 0) / reservation.nights_count 
                    : 0;
                  
                  return (
                    <TableRow key={reservation.id}>
                      {visibleColumns.property && (
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
                      )}
                      {visibleColumns.checkIn && (
                        <TableCell>
                          {new Date(reservation.check_in).toLocaleDateString()}
                        </TableCell>
                      )}
                      {visibleColumns.checkOut && (
                        <TableCell>
                          {new Date(reservation.check_out).toLocaleDateString()}
                        </TableCell>
                      )}
                      {visibleColumns.nights && (
                        <TableCell className="text-center">
                          {reservation.nights_count}
                        </TableCell>
                      )}
                      {visibleColumns.guests && (
                        <TableCell className="text-center">
                          {reservation.guests_count}
                        </TableCell>
                      )}
                      {visibleColumns.source && (
                        <TableCell>
                          {reservation.source && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-muted">
                              {reservation.source}
                            </span>
                          )}
                        </TableCell>
                      )}
                      {visibleColumns.status && (
                        <TableCell>
                          <Badge variant={getStatusColor(reservation.status)}>
                            {reservation.status || "Unknown"}
                          </Badge>
                        </TableCell>
                      )}
                      {visibleColumns.accommodation && (
                        <TableCell className="text-right font-semibold">
                          ${parseFloat(reservation.fare_accommodation_adjusted || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </TableCell>
                      )}
                      {visibleColumns.adr && (
                        <TableCell className="text-right text-muted-foreground">
                          ${adr.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </TableCell>
                      )}
                      {visibleColumns.ownerRevenue && (
                        <TableCell className="text-right text-muted-foreground">
                          ${parseFloat(reservation.owner_revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </TableCell>
                      )}
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

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Filter, X, CalendarIcon, Columns, ArrowUpDown, ArrowUp, ArrowDown, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { cn, formatDateDisplay } from "@/lib/utils";
import { SyncProgressCard } from "@/components/SyncProgressCard";

export default function Reservations() {
  const { toast } = useToast();
  const [reservations, setReservations] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [mostRecentReservation, setMostRecentReservation] = useState<Date | null>(null);
  const [isSyncingNew, setIsSyncingNew] = useState(false);
  const [lastSyncAttempt, setLastSyncAttempt] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [cooldownReason, setCooldownReason] = useState<string>('');
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(100);
  
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
    loadCurrentAccount();
    
    // Load last sync attempt from localStorage
    const lastSync = localStorage.getItem('last_reservation_sync_attempt');
    const lastReason = localStorage.getItem('last_reservation_sync_reason');
    if (lastSync) {
      setLastSyncAttempt(parseInt(lastSync));
      setCooldownReason(lastReason || '');
    }
  }, []);

  const loadCurrentAccount = async () => {
    const { data: accounts } = await supabase
      .from('guesty_accounts')
      .select('id')
      .limit(1)
      .maybeSingle();
    
    if (accounts) {
      setCurrentAccountId(accounts.id);
    }
  };

  // Cooldown timer with tiered durations
  useEffect(() => {
    if (!lastSyncAttempt) return;
    
    // Tiered cooldown based on error type
    const getCooldownDuration = () => {
      if (cooldownReason.includes('OAUTH_RATE_LIMIT')) return 180000; // 3 minutes for OAuth rate limits
      if (cooldownReason.includes('SERVER_ERROR')) return 120000; // 2 minutes for server errors
      return 60000; // 1 minute for normal sync or other errors
    };
    
    const COOLDOWN_MS = getCooldownDuration();
    const updateCooldown = () => {
      const elapsed = Date.now() - lastSyncAttempt;
      const remaining = Math.max(0, COOLDOWN_MS - elapsed);
      setCooldownRemaining(Math.ceil(remaining / 1000));
      
      if (remaining > 0) {
        setTimeout(updateCooldown, 1000);
      }
    };
    
    updateCooldown();
  }, [lastSyncAttempt, cooldownReason]);

  useEffect(() => {
    loadData();
  }, [currentPage, selectedProperty, selectedSource, selectedStatus, checkInFrom, checkInTo, minNights, maxNights, minGuests, maxGuests, minAccommodation, maxAccommodation, sortColumn, sortDirection]);

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
      
      // Build the query with filters
      let query = supabase
        .from("reservations")
        .select("*", { count: 'exact' })
        .in("status", ["confirmed", "checked_in", "checked_out"]);

      // Apply filters at database level where possible
      if (selectedProperty !== "all") {
        query = query.eq("listing_id", selectedProperty);
      }
      if (selectedSource !== "all") {
        query = query.eq("source", selectedSource);
      }
      if (selectedStatus !== "all") {
        query = query.eq("status", selectedStatus);
      }
      if (checkInFrom) {
        query = query.gte("check_in", checkInFrom.toISOString().split('T')[0]);
      }
      if (checkInTo) {
        query = query.lte("check_in", checkInTo.toISOString().split('T')[0]);
      }
      if (minNights) {
        query = query.gte("nights_count", parseInt(minNights));
      }
      if (maxNights) {
        query = query.lte("nights_count", parseInt(maxNights));
      }
      if (minGuests) {
        query = query.gte("guests_count", parseInt(minGuests));
      }
      if (maxGuests) {
        query = query.lte("guests_count", parseInt(maxGuests));
      }
      if (minAccommodation) {
        query = query.gte("fare_accommodation_adjusted", parseFloat(minAccommodation));
      }
      if (maxAccommodation) {
        query = query.lte("fare_accommodation_adjusted", parseFloat(maxAccommodation));
      }

      // Apply sorting
      if (sortColumn) {
        const columnMap: Record<string, string> = {
          property: "listing_id",
          checkIn: "check_in",
          checkOut: "check_out",
          nights: "nights_count",
          guests: "guests_count",
          source: "source",
          status: "status",
          accommodation: "fare_accommodation_adjusted",
        };
        const dbColumn = columnMap[sortColumn] || "check_in";
        query = query.order(dbColumn, { ascending: sortDirection === "asc" });
      } else {
        query = query.order("check_in", { ascending: false });
      }

      // Apply pagination
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data: reservationsData, error: reservationsError, count } = await query;

      if (reservationsError) throw reservationsError;
      
      setReservations(reservationsData || []);
      setFilteredCount(count || 0);

      // Get total count (all reservations)
      const { count: totalReservations } = await supabase
        .from("reservations")
        .select("*", { count: 'exact', head: true })
        .in("status", ["confirmed", "checked_in", "checked_out"]);
      
      setTotalCount(totalReservations || 0);

      // Get most recent reservation date
      const { data: recentData } = await supabase
        .from("reservations")
        .select("last_updated_at_guesty")
        .order("last_updated_at_guesty", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentData?.last_updated_at_guesty) {
        setMostRecentReservation(new Date(recentData.last_updated_at_guesty));
      }

      // Load listings for display (exclude archived)
      const { data: listingsData, error: listingsError } = await supabase
        .from("listings")
        .select("*")
        .eq("archived", false);

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
    setCurrentPage(1);
  };

  const handleSyncNewReservations = async () => {
    try {
      setIsSyncingNew(true);
      
      // Get first guesty account
      const { data: accounts } = await supabase
        .from('guesty_accounts')
        .select('id')
        .limit(1)
        .maybeSingle();
      
      if (!accounts) {
        toast({
          title: "No Guesty account found",
          description: "Please set up a Guesty integration in Settings first.",
          variant: "destructive",
        });
        return;
      }
      
      const { data, error } = await supabase.functions.invoke('sync-new-reservations', {
        body: { accountId: accounts.id }
      });
      
      if (error) {
        throw error;
      }
      
      // Check if it's the initial sync required response
      if (data?.requiresInitialSync) {
        toast({
          title: "Initial sync required",
          description: "Please perform a full sync from the Settings page first.",
          variant: "destructive",
        });
        return;
      }
      
      // Success - set normal cooldown
      const now = Date.now();
      setLastSyncAttempt(now);
      setCooldownReason('SUCCESS');
      localStorage.setItem('last_reservation_sync_attempt', now.toString());
      localStorage.setItem('last_reservation_sync_reason', 'SUCCESS');
      
      toast({
        title: "Sync completed",
        description: `${data.newOrUpdatedCount} reservations updated since ${new Date(data.cutoffDate).toLocaleDateString()}`,
      });
      
      // Reload the data
      await loadData();
      
    } catch (error: any) {
      console.error('Sync error:', error);
      
      // Parse error message for error type and user-friendly display
      let errorMessage = error.message || "An error occurred during sync";
      let errorType = 'UNKNOWN';
      
      if (error.message?.includes("Edge function returned 500")) {
        const match = error.message.match(/"error":"([^"]+)"/);
        if (match) {
          errorMessage = match[1];
        }
      }
      
      // Extract error type prefix if present
      if (errorMessage.includes(':')) {
        const [type, ...messageParts] = errorMessage.split(':');
        errorType = type;
        errorMessage = messageParts.join(':').trim();
      }
      
      // Set cooldown with error type
      const now = Date.now();
      setLastSyncAttempt(now);
      setCooldownReason(errorType);
      localStorage.setItem('last_reservation_sync_attempt', now.toString());
      localStorage.setItem('last_reservation_sync_reason', errorType);
      
      // Provide specific guidance based on error type
      let toastDescription = errorMessage;
      if (errorType === 'OAUTH_RATE_LIMIT') {
        toastDescription = `${errorMessage}\n\nCooldown: 3 minutes`;
      } else if (errorType === 'SERVER_ERROR') {
        toastDescription = `${errorMessage}\n\nCooldown: 2 minutes`;
      }
      
      toast({
        title: "Sync failed",
        description: toastDescription,
        variant: "destructive",
      });
    } finally {
      setIsSyncingNew(false);
    }
  };

  const uniqueSources = ["airbnb2", "VRBO", "Booking.com", "Expedia", "website", "manual", "BE-API"];
  const uniqueStatuses = ["confirmed", "checked_in", "checked_out"];

  const totalPages = Math.ceil(filteredCount / pageSize);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Sync Progress Card */}
        {currentAccountId && (
          <SyncProgressCard 
            accountId={currentAccountId} 
            syncType="new_reservations" 
          />
        )}
        
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reservations</h2>
            <p className="text-muted-foreground">View and manage all your bookings</p>
            {mostRecentReservation && (
              <p className="text-xs text-muted-foreground mt-1">
                Most recent update: {mostRecentReservation.toLocaleString()}
                {(() => {
                  const ageHours = (Date.now() - mostRecentReservation.getTime()) / (1000 * 60 * 60);
                  if (ageHours > 24) {
                    return <span className="ml-2 text-yellow-600">(Data may be outdated - click "Sync New")</span>;
                  }
                  return null;
                })()}
              </p>
            )}
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
            <Button 
              onClick={handleSyncNewReservations} 
              disabled={isSyncingNew || loading || cooldownRemaining > 0}
              variant="default"
              title={
                cooldownRemaining > 0 
                  ? `${
                      cooldownReason === 'OAUTH_RATE_LIMIT' 
                        ? 'OAuth rate limit - wait 3 minutes' 
                        : cooldownReason === 'SERVER_ERROR'
                        ? 'Server error - wait 2 minutes'
                        : 'Cooldown active'
                    } (${cooldownRemaining}s remaining)`
                  : 'Sync new reservations from Guesty'
              }
            >
              {isSyncingNew ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : cooldownRemaining > 0 ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {cooldownReason === 'OAUTH_RATE_LIMIT' ? '⏳ ' : ''}
                  Wait {cooldownRemaining}s
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync New
                </>
              )}
            </Button>
            <Button onClick={loadData} variant="outline" disabled={loading}>
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
                  <SearchableSelect
                    value={selectedProperty}
                    onValueChange={setSelectedProperty}
                    options={[
                      { value: "all", label: "All Properties" },
                      ...listings.map((listing) => ({
                        value: listing.id,
                        label: listing.nickname || listing.id,
                      })),
                    ]}
                    placeholder="All Properties"
                    searchPlaceholder="Search properties..."
                    emptyMessage="No properties found."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Source</label>
                  <SearchableSelect
                    value={selectedSource}
                    onValueChange={setSelectedSource}
                    options={[
                      { value: "all", label: "All Sources" },
                      ...uniqueSources.map((source) => ({
                        value: source,
                        label: source,
                      })),
                    ]}
                    placeholder="All Sources"
                    searchPlaceholder="Search sources..."
                    emptyMessage="No sources found."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <SearchableSelect
                    value={selectedStatus}
                    onValueChange={setSelectedStatus}
                    options={[
                      { value: "all", label: "All Statuses" },
                      ...uniqueStatuses.map((status) => ({
                        value: status,
                        label: status.charAt(0).toUpperCase() + status.slice(1).replace("_", " "),
                      })),
                    ]}
                    placeholder="All Statuses"
                    searchPlaceholder="Search statuses..."
                    emptyMessage="No statuses found."
                  />
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
              Showing <span className="font-semibold text-foreground">{((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredCount)}</span> of{" "}
              <span className="font-semibold text-foreground">{filteredCount}</span> filtered reservations
              {filteredCount !== totalCount && <span className="ml-1">({totalCount} total)</span>}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1 || loading}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || loading}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
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
        ) : reservations.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Reservations Match Your Search</CardTitle>
              <CardDescription>
                Try adjusting your search terms.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <ScrollArea className="h-[calc(100vh-320px)]">
              <div className="min-w-full">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur z-10 border-b">
                    <TableRow className="hover:bg-transparent">
                      {visibleColumns.property && (
                        <TableHead className="h-9 px-2 text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("property")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Property
                            {getSortIcon("property")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.checkIn && (
                        <TableHead className="h-9 px-2 text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("checkIn")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Check In
                            {getSortIcon("checkIn")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.checkOut && (
                        <TableHead className="h-9 px-2 text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("checkOut")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Check Out
                            {getSortIcon("checkOut")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.nights && (
                        <TableHead className="h-9 px-2 text-center text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("nights")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Nights
                            {getSortIcon("nights")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.guests && (
                        <TableHead className="h-9 px-2 text-center text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("guests")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Guests
                            {getSortIcon("guests")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.source && (
                        <TableHead className="h-9 px-2 text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("source")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Source
                            {getSortIcon("source")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.status && (
                        <TableHead className="h-9 px-2 text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("status")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Status
                            {getSortIcon("status")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.accommodation && (
                        <TableHead className="h-9 px-2 text-right text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("accommodation")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            Accommodation
                            {getSortIcon("accommodation")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.adr && (
                        <TableHead className="h-9 px-2 text-right text-xs font-semibold whitespace-nowrap">
                          <Button
                            variant="ghost"
                            onClick={() => handleSort("adr")}
                            className="h-7 px-2 hover:bg-muted/80 text-xs font-semibold"
                          >
                            ADR
                            {getSortIcon("adr")}
                          </Button>
                        </TableHead>
                      )}
                      {visibleColumns.ownerRevenue && (
                        <TableHead className="h-9 px-2 text-right text-xs font-semibold whitespace-nowrap">
                          Owner Revenue
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservations.map((reservation, index) => {
                      const adr = reservation.nights_count > 0 
                        ? parseFloat(reservation.fare_accommodation_adjusted || 0) / reservation.nights_count 
                        : 0;
                      
                      return (
                        <TableRow 
                          key={reservation.id}
                          className={cn(
                            "border-b transition-colors hover:bg-muted/30",
                            index % 2 === 0 ? "bg-background" : "bg-muted/20"
                          )}
                        >
                          {visibleColumns.property && (
                            <TableCell className="p-2 text-sm">
                              <div>
                                <div className="font-medium whitespace-nowrap">{getListingName(reservation.listing_id)}</div>
                                {getListingAddress(reservation.listing_id) && (
                                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                                    {getListingAddress(reservation.listing_id)}
                                  </div>
                                )}
                                {reservation.confirmation_code && (
                                  <div className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">
                                    {reservation.confirmation_code}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          )}
                          {visibleColumns.checkIn && (
                            <TableCell className="p-2 text-sm whitespace-nowrap">
                              {formatDateDisplay(reservation.check_in)}
                            </TableCell>
                          )}
                          {visibleColumns.checkOut && (
                            <TableCell className="p-2 text-sm whitespace-nowrap">
                              {formatDateDisplay(reservation.check_out)}
                            </TableCell>
                          )}
                          {visibleColumns.nights && (
                            <TableCell className="p-2 text-sm text-center whitespace-nowrap">
                              {reservation.nights_count}
                            </TableCell>
                          )}
                          {visibleColumns.guests && (
                            <TableCell className="p-2 text-sm text-center whitespace-nowrap">
                              {reservation.guests_count}
                            </TableCell>
                          )}
                          {visibleColumns.source && (
                            <TableCell className="p-2 text-sm">
                              {reservation.source && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted whitespace-nowrap">
                                  {reservation.source}
                                </span>
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.status && (
                            <TableCell className="p-2 text-sm">
                              <Badge variant={getStatusColor(reservation.status)} className="whitespace-nowrap text-xs">
                                {reservation.status || "Unknown"}
                              </Badge>
                            </TableCell>
                          )}
                          {visibleColumns.accommodation && (
                            <TableCell className="p-2 text-sm text-right font-semibold whitespace-nowrap">
                              ${parseFloat(reservation.fare_accommodation_adjusted || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </TableCell>
                          )}
                          {visibleColumns.adr && (
                            <TableCell className="p-2 text-sm text-right text-muted-foreground whitespace-nowrap">
                              ${adr.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </TableCell>
                          )}
                          {visibleColumns.ownerRevenue && (
                            <TableCell className="p-2 text-sm text-right text-muted-foreground whitespace-nowrap">
                              ${parseFloat(reservation.owner_revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

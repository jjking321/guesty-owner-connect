import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Star, Users, Bed, Bath, Building, ExternalLink, Map, BarChart3, X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ComparablesMap } from "./ComparablesMap";
import { ComparableMetricsDialog } from "./ComparableMetricsDialog";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ComparablesModuleProps {
  listingId: string;
  latitude?: number;
  longitude?: number;
  bedrooms?: number;
  guests?: number;
}

interface Comparable {
  id: string;
  listing_id: string;
  airroi_listing_id: number;
  listing_name: string | null;
  listing_type: string | null;
  room_type: string | null;
  cover_photo_url: string | null;
  host_name: string | null;
  superhost: boolean;
  location_info: {
    country?: string;
    region?: string;
    locality?: string;
    district?: string;
    lat?: number;
    lng?: number;
  } | null;
  property_details: {
    guests?: number;
    bedrooms?: number;
    beds?: number;
    baths?: number;
    amenities?: string[];
  } | null;
  pricing_info: {
    currency?: string;
    cleaning_fee?: number;
    extra_guest_fee?: number;
  } | null;
  ratings: {
    num_reviews?: number;
    rating_overall?: number;
    rating_accuracy?: number;
    rating_checkin?: number;
    rating_cleanliness?: number;
    rating_communication?: number;
    rating_location?: number;
    rating_value?: number;
  } | null;
  performance_metrics: {
    ttm_revenue?: number;
    ttm_occupancy?: number;
    ttm_adr?: number;
    ttm_revpar?: number;
    available_days?: number;
    reserved_days?: number;
    blocked_days?: number;
  } | null;
  fetched_at: string;
  is_selected: boolean;
  selected_at: string | null;
  historical_metrics: unknown | null;
  metrics_fetched_at: string | null;
  // TTM rollup columns from database
  ttm_revenue?: number | null;
  ttm_adr?: number | null;
  ttm_occupancy?: number | null;
  ttm_revpar?: number | null;
  prior_ttm_revenue?: number | null;
  prior_ttm_adr?: number | null;
  prior_ttm_occupancy?: number | null;
  prior_ttm_revpar?: number | null;
  rollups_calculated_at?: string | null;
  // Future rates data
  future_rates?: { rates: { date: string; available: boolean; rate: number }[] } | null;
  future_rates_fetched_at?: string | null;
}

const AMENITY_OPTIONS = [
  { value: 'pool', label: 'Pool' },
  { value: 'hot_tub', label: 'Hot Tub' },
  { value: 'waterfront', label: 'Waterfront' },
  { value: 'beach_access', label: 'Beach Access' },
  { value: 'patio_or_balcony', label: 'Patio/Balcony' },
  { value: 'pets_allowed', label: 'Pets Allowed' },
];

export function ComparablesModule({ 
  listingId, 
  latitude, 
  longitude, 
  bedrooms, 
  guests 
}: ComparablesModuleProps) {
  const { toast } = useToast();
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [radiusMiles, setRadiusMiles] = useState<number>(1);
  const [pendingSelections, setPendingSelections] = useState<Set<string>>(new Set());
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [bedroomMin, setBedroomMin] = useState<number | null>(bedrooms ?? null);
  const [bedroomMax, setBedroomMax] = useState<number | null>(bedrooms ?? null);
  const [minRevenue, setMinRevenue] = useState<string>('');
  const [maxRevenue, setMaxRevenue] = useState<string>('');
  const [showMap, setShowMap] = useState(false);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("selected");
  
  // Pagination state
  const PAGE_SIZE = 10;
  const [currentOffset, setCurrentOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchingMetrics, setFetchingMetrics] = useState(false);
  const [fetchingFutureRates, setFetchingFutureRates] = useState(false);
  const [metricsSelection, setMetricsSelection] = useState<Set<string>>(new Set());
  const [metricsDialogOpen, setMetricsDialogOpen] = useState(false);
  const [selectedComparableForMetrics, setSelectedComparableForMetrics] = useState<Comparable | null>(null);
  const [compsetSummary, setCompsetSummary] = useState<{
    avg_ttm_revenue: number | null;
    avg_ttm_adr: number | null;
    avg_ttm_occupancy: number | null;
    avg_ttm_revpar: number | null;
    avg_prior_ttm_revenue: number | null;
    avg_prior_ttm_adr: number | null;
    avg_prior_ttm_occupancy: number | null;
    avg_prior_ttm_revpar: number | null;
    selected_comparables_count: number | null;
    calculated_at: string | null;
  } | null>(null);

  // Load existing comparables and mapbox token on mount
  useEffect(() => {
    loadExistingComparables();
    fetchMapboxToken();
    loadCompsetSummary();
  }, [listingId]);

  const loadCompsetSummary = async () => {
    try {
      const { data, error } = await supabase
        .from('property_compset_summary')
        .select('*')
        .eq('listing_id', listingId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // Ignore not found
      setCompsetSummary(data);
    } catch (error) {
      console.error('Error loading compset summary:', error);
    }
  };

  const fetchMapboxToken = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-mapbox-token');
      if (error) throw error;
      if (data?.token) {
        setMapboxToken(data.token);
      }
    } catch (error) {
      console.error('Error fetching mapbox token:', error);
    }
  };

  const loadExistingComparables = async () => {
    try {
      const { data, error } = await supabase
        .from('property_comparables')
        .select('*')
        .eq('listing_id', listingId)
        .order('is_selected', { ascending: false })
        .order('fetched_at', { ascending: false });

      if (error) throw error;
      
      // Type assertion since we know the structure matches
      setComparables((data || []) as unknown as Comparable[]);
      
      // Initialize pending selections with currently selected items
      const selected = new Set((data || []).filter(c => c.is_selected).map(c => c.id));
      setPendingSelections(selected);
    } catch (error: any) {
      console.error('Error loading comparables:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const fetchComparables = async () => {
    if (!latitude || !longitude) {
      toast({
        title: "Missing coordinates",
        description: "This property doesn't have valid location coordinates.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setCurrentOffset(0); // Reset pagination on fresh fetch
    try {
      const { data, error } = await supabase.functions.invoke('fetch-property-comparables', {
        body: {
          listing_id: listingId,
          radius_miles: radiusMiles,
          amenities: selectedAmenities,
          bedroom_min: bedroomMin,
          bedroom_max: bedroomMax,
          min_revenue: minRevenue ? parseInt(minRevenue) : null,
          max_revenue: maxRevenue ? parseInt(maxRevenue) : null,
          offset: 0,
          page_size: PAGE_SIZE,
        },
      });

      if (error) throw error;

      if (data.success) {
        setComparables(data.comparables);
        setHasMoreResults(data.pagination?.hasMore || false);
        // Update pending selections
        const selected = new Set<string>(data.comparables.filter((c: Comparable) => c.is_selected).map((c: Comparable) => c.id));
        setPendingSelections(selected);
        
        toast({
          title: "Comparables fetched",
          description: `Found ${data.count} comparable properties.`,
        });
      } else {
        throw new Error(data.error || 'Failed to fetch comparables');
      }
    } catch (error: any) {
      console.error('Error fetching comparables:', error);
      toast({
        title: "Error fetching comparables",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadMoreComparables = async () => {
    if (!latitude || !longitude) return;

    const nextOffset = currentOffset + PAGE_SIZE;
    setLoadingMore(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('fetch-property-comparables', {
        body: {
          listing_id: listingId,
          radius_miles: radiusMiles,
          amenities: selectedAmenities,
          bedroom_min: bedroomMin,
          bedroom_max: bedroomMax,
          min_revenue: minRevenue ? parseInt(minRevenue) : null,
          max_revenue: maxRevenue ? parseInt(maxRevenue) : null,
          offset: nextOffset,
          page_size: PAGE_SIZE,
        },
      });

      if (error) throw error;

      if (data.success) {
        setComparables(data.comparables);
        setCurrentOffset(nextOffset);
        setHasMoreResults(data.pagination?.hasMore || false);
        // Preserve existing selections and add any newly fetched selected items
        const newSelected = new Set<string>(pendingSelections);
        data.comparables.filter((c: Comparable) => c.is_selected).forEach((c: Comparable) => newSelected.add(c.id));
        setPendingSelections(newSelected);
        
        toast({
          title: "More comparables loaded",
          description: `Now showing ${data.count} comparable properties.`,
        });
      } else {
        throw new Error(data.error || 'Failed to load more comparables');
      }
    } catch (error: any) {
      console.error('Error loading more comparables:', error);
      toast({
        title: "Error loading more",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleSelection = (id: string) => {
    setPendingSelections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const saveSelections = async () => {
    setSaving(true);
    try {
      // Update all comparables with their new selection status
      for (const comp of comparables) {
        const isSelected = pendingSelections.has(comp.id);
        if (comp.is_selected !== isSelected) {
          const { error } = await supabase
            .from('property_comparables')
            .update({
              is_selected: isSelected,
              selected_at: isSelected ? new Date().toISOString() : null,
            })
            .eq('id', comp.id);

          if (error) throw error;
        }
      }

      // Reload to get updated data
      await loadExistingComparables();

      toast({
        title: "Selections saved",
        description: `${pendingSelections.size} comparable(s) selected.`,
      });
    } catch (error: any) {
      console.error('Error saving selections:', error);
      toast({
        title: "Error saving selections",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const fetchHistoricalMetrics = async () => {
    if (metricsSelection.size === 0) {
      toast({
        title: "No comparables selected",
        description: "Please check the comparables you want to fetch metrics for.",
        variant: "destructive",
      });
      return;
    }
    
    setFetchingMetrics(true);
    try {
      const selectedIds = Array.from(metricsSelection);
      
      const { data, error } = await supabase.functions.invoke('fetch-comparable-metrics', {
        body: { comparable_ids: selectedIds }
      });
      
      if (error) throw error;
      
      if (data.success) {
        toast({
          title: "Historical metrics fetched",
          description: `Successfully fetched metrics for ${data.fetched} of ${data.total} comparables.`,
        });
        // Reload to show updated data
        await loadExistingComparables();
        // Reload compset summary with new averages
        await loadCompsetSummary();
        // Clear metrics selection after successful fetch
        setMetricsSelection(new Set());
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error: any) {
      console.error('Error fetching historical metrics:', error);
      toast({
        title: "Error fetching metrics",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setFetchingMetrics(false);
    }
  };

  const toggleMetricsSelection = (id: string) => {
    setMetricsSelection(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAllForMetrics = () => {
    const selected = comparables.filter(c => pendingSelections.has(c.id));
    setMetricsSelection(new Set(selected.map(c => c.id)));
  };

  const deselectAllForMetrics = () => {
    setMetricsSelection(new Set());
  };

  const fetchFutureRates = async () => {
    if (metricsSelection.size === 0) {
      toast({
        title: "No comparables selected",
        description: "Please check the comparables you want to fetch future rates for.",
        variant: "destructive",
      });
      return;
    }
    
    setFetchingFutureRates(true);
    try {
      const selectedIds = Array.from(metricsSelection);
      
      const { data, error } = await supabase.functions.invoke('fetch-comparable-future-rates', {
        body: { comparable_ids: selectedIds }
      });
      
      if (error) throw error;
      
      if (data.success) {
        toast({
          title: "Future rates fetched",
          description: `Successfully fetched rates for ${data.fetched} of ${data.total} comparables.`,
        });
        // Reload to show updated data
        await loadExistingComparables();
        // Clear metrics selection after successful fetch
        setMetricsSelection(new Set());
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error: any) {
      console.error('Error fetching future rates:', error);
      toast({
        title: "Error fetching future rates",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setFetchingFutureRates(false);
    }
  };

  const removeFromSelected = (id: string) => {
    setPendingSelections(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
    // Also remove from metrics selection
    setMetricsSelection(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const openMetricsDialog = (comparable: Comparable) => {
    setSelectedComparableForMetrics(comparable);
    setMetricsDialogOpen(true);
  };

  const formatCurrency = (value?: number) => {
    if (value === undefined || value === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value?: number) => {
    if (value === undefined || value === null) return 'N/A';
    return `${(value * 100).toFixed(0)}%`;
  };

  const hasCoordinates = latitude && longitude;
  const hasChanges = comparables.some(c => c.is_selected !== pendingSelections.has(c.id));
  const selectedComparables = comparables.filter(c => pendingSelections.has(c.id));
  const unselectedComparables = comparables.filter(c => !pendingSelections.has(c.id));

  if (initialLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Property Comparables</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities(prev => 
      prev.includes(amenity) 
        ? prev.filter(a => a !== amenity)
        : [...prev, amenity]
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Property Comparables</CardTitle>
        <CardDescription>
          Compare with similar short-term rentals in the area
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="selected">
              Selected ({pendingSelections.size})
            </TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search">
            {/* Search Controls */}
            <div className="space-y-4 mb-6 pb-4 border-b">
              {/* Radius selector and Fetch button */}
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="radius" className="text-sm text-muted-foreground whitespace-nowrap">
                    Search Radius:
                  </Label>
                  <Select
                    value={radiusMiles.toString()}
                    onValueChange={(value) => setRadiusMiles(parseInt(value))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 mile</SelectItem>
                      <SelectItem value="2">2 miles</SelectItem>
                      <SelectItem value="5">5 miles</SelectItem>
                      <SelectItem value="10">10 miles</SelectItem>
                      <SelectItem value="25">25 miles</SelectItem>
                      <SelectItem value="50">50 miles</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  onClick={fetchComparables} 
                  disabled={loading || !hasCoordinates}
                  size="sm"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Fetching...' : 'Fetch Comparables'}
                </Button>
              </div>

              {/* Bedroom Range Filter */}
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">
                  Bedrooms: {bedrooms !== undefined && (
                    <span className="text-xs ml-1">(this property: {bedrooms === 0 ? 'Studio' : bedrooms})</span>
                  )}
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min="0"
                    max="20"
                    placeholder="Min"
                    value={bedroomMin ?? ''}
                    onChange={(e) => setBedroomMin(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-20"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="number"
                    min="0"
                    max="20"
                    placeholder="Max"
                    value={bedroomMax ?? ''}
                    onChange={(e) => setBedroomMax(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-20"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBedroomMin(bedrooms ?? null);
                      setBedroomMax(bedrooms ?? null);
                    }}
                    className="text-xs"
                  >
                    Reset
                  </Button>
                </div>
              </div>

              {/* Amenities Filter */}
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">Amenities:</Label>
                <div className="flex flex-wrap gap-4">
                  {AMENITY_OPTIONS.map((amenity) => (
                    <div key={amenity.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`amenity-${amenity.value}`}
                        checked={selectedAmenities.includes(amenity.value)}
                        onCheckedChange={() => toggleAmenity(amenity.value)}
                      />
                      <Label htmlFor={`amenity-${amenity.value}`} className="text-sm cursor-pointer">
                        {amenity.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* TTM Revenue Range Filter */}
              <div>
                <Label className="text-sm text-muted-foreground mb-2 block">TTM Revenue Range:</Label>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      placeholder="Min"
                      value={minRevenue}
                      onChange={(e) => setMinRevenue(e.target.value)}
                      className="w-28 pl-7"
                    />
                  </div>
                  <span className="text-muted-foreground">to</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      placeholder="Max"
                      value={maxRevenue}
                      onChange={(e) => setMaxRevenue(e.target.value)}
                      className="w-28 pl-7"
                    />
                  </div>
                </div>
              </div>

              {/* Map Toggle */}
              {hasCoordinates && mapboxToken && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="show-map"
                    checked={showMap}
                    onCheckedChange={setShowMap}
                  />
                  <Label htmlFor="show-map" className="flex items-center gap-2 cursor-pointer">
                    <Map className="h-4 w-4" />
                    Show Map
                  </Label>
                </div>
              )}

              {/* Missing coordinates warning */}
              {!hasCoordinates && (
                <p className="text-sm text-destructive">
                  This property doesn't have valid coordinates. Cannot fetch comparables.
                </p>
              )}
            </div>
            {/* Map Display */}
            {showMap && comparables.length > 0 && latitude && longitude && mapboxToken && (
              <div className="mb-6">
                <ComparablesMap
                  subjectLatitude={latitude}
                  subjectLongitude={longitude}
                  comparables={comparables}
                  selectedIds={pendingSelections}
                  radiusMiles={radiusMiles}
                  mapboxToken={mapboxToken}
                  onToggleSelection={toggleSelection}
                />
              </div>
            )}

            {comparables.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Building className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No comparables found. Click "Fetch Comparables" to search for similar properties.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {comparables.map((comp) => (
                  <ComparableCard
                    key={comp.id}
                    comparable={comp}
                    mode="search"
                    isSelected={pendingSelections.has(comp.id)}
                    onToggle={() => toggleSelection(comp.id)}
                    formatCurrency={formatCurrency}
                    formatPercent={formatPercent}
                  />
                ))}

                {/* Load More Button */}
                {hasMoreResults && (
                  <div className="flex justify-center pt-4">
                    <Button 
                      variant="outline" 
                      onClick={loadMoreComparables}
                      disabled={loadingMore}
                    >
                      {loadingMore ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Load More Comparables'
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* Selected Tab */}
          <TabsContent value="selected">
            {selectedComparables.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Building className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No comparables selected yet.</p>
                <p className="text-sm mt-2">
                  Go to the Search tab to find and select comparable properties.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Compset Summary Card */}
                {compsetSummary?.calculated_at && (
                  <CompsetSummaryCard 
                    summary={compsetSummary} 
                    formatCurrency={formatCurrency}
                    formatPercent={formatPercent}
                  />
                )}

                {/* Compset Monthly Trend Chart */}
                {selectedComparables.some(c => c.historical_metrics) && (
                  <CompsetTrendChart 
                    comparables={selectedComparables}
                    formatCurrency={formatCurrency}
                    formatPercent={formatPercent}
                  />
                )}

                {/* Header with Fetch Metrics Button */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {selectedComparables.length} comparable{selectedComparables.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-sm text-muted-foreground">|</span>
                    <button 
                      onClick={selectAllForMetrics}
                      className="text-sm text-primary hover:underline"
                    >
                      Select all
                    </button>
                    <button 
                      onClick={deselectAllForMetrics}
                      className="text-sm text-muted-foreground hover:underline"
                    >
                      Deselect all
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      onClick={fetchHistoricalMetrics}
                      disabled={fetchingMetrics || metricsSelection.size === 0}
                      variant="outline"
                      size="sm"
                    >
                      <BarChart3 className="h-4 w-4 mr-2" />
                      {fetchingMetrics ? 'Fetching...' : `Fetch Historicals (${metricsSelection.size})`}
                    </Button>
                    <Button 
                      onClick={fetchFutureRates}
                      disabled={fetchingFutureRates || metricsSelection.size === 0}
                      variant="outline"
                      size="sm"
                    >
                      <TrendingUp className="h-4 w-4 mr-2" />
                      {fetchingFutureRates ? 'Fetching...' : `Fetch Future Rates (${metricsSelection.size})`}
                    </Button>
                  </div>
                </div>

                {/* Comparables List */}
                <div className="space-y-3">
                  {selectedComparables.map((comp) => (
                    <ComparableCard
                      key={comp.id}
                      comparable={comp}
                      mode="selected"
                      isCheckedForMetrics={metricsSelection.has(comp.id)}
                      onMetricsToggle={() => toggleMetricsSelection(comp.id)}
                      onRemove={() => removeFromSelected(comp.id)}
                      onClick={() => openMetricsDialog(comp)}
                      formatCurrency={formatCurrency}
                      formatPercent={formatPercent}
                    />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Save Button - Always visible when there are changes */}
        {hasChanges && (
          <div className="flex justify-end pt-4 border-t mt-4">
            <Button onClick={saveSelections} disabled={saving}>
              {saving ? 'Saving...' : `Save Selections (${pendingSelections.size})`}
            </Button>
          </div>
        )}

        {/* Metrics Dialog */}
        <ComparableMetricsDialog
          comparable={selectedComparableForMetrics}
          open={metricsDialogOpen}
          onOpenChange={setMetricsDialogOpen}
        />
      </CardContent>
    </Card>
  );
}

interface ComparableCardProps {
  comparable: Comparable;
  mode: 'search' | 'selected';
  // Search mode props
  isSelected?: boolean;
  onToggle?: () => void;
  // Selected mode props
  isCheckedForMetrics?: boolean;
  onMetricsToggle?: () => void;
  onRemove?: () => void;
  onClick?: () => void;
  // Common props
  formatCurrency: (value?: number) => string;
  formatPercent: (value?: number) => string;
}

function ComparableCard({ 
  comparable, 
  mode,
  isSelected,
  onToggle,
  isCheckedForMetrics,
  onMetricsToggle,
  onRemove,
  onClick,
  formatCurrency,
  formatPercent,
}: ComparableCardProps) {
  const details = comparable.property_details;
  const metrics = comparable.performance_metrics;
  const ratings = comparable.ratings;

  const isInSelectedMode = mode === 'selected';
  const cardSelected = isInSelectedMode || isSelected;

  const handleCardClick = (e: React.MouseEvent) => {
    // Only trigger onClick in selected mode and if clicking the card itself
    if (isInSelectedMode && onClick) {
      onClick();
    }
  };

  return (
    <div 
      className={`border rounded-lg p-4 transition-colors ${
        cardSelected ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50'
      } ${isInSelectedMode ? 'cursor-pointer hover:bg-primary/10' : ''}`}
      onClick={handleCardClick}
    >
      <div className="flex gap-4">
        {/* Checkbox / Actions */}
        <div className="flex items-start pt-1" onClick={(e) => e.stopPropagation()}>
          {isInSelectedMode ? (
            <Checkbox
              checked={isCheckedForMetrics}
              onCheckedChange={onMetricsToggle}
              aria-label={`Select ${comparable.listing_name} for metrics fetch`}
            />
          ) : (
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggle}
              aria-label={`Select ${comparable.listing_name}`}
            />
          )}
        </div>

        {/* Photo */}
        {comparable.cover_photo_url && (
          <div className="flex-shrink-0">
            <img
              src={comparable.cover_photo_url}
              alt={comparable.listing_name || 'Comparable property'}
              className="w-24 h-24 object-cover rounded-md"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium truncate">
                  {comparable.listing_name || 'Unnamed Property'}
                </h4>
                <a
                  href={`https://www.airbnb.com/rooms/${comparable.airroi_listing_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  title="View on Airbnb"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <p className="text-sm text-muted-foreground">
                {comparable.location_info?.locality || comparable.location_info?.region || 'Unknown location'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {comparable.superhost && (
                <Badge variant="secondary" className="text-xs">
                  Superhost
                </Badge>
              )}
              {ratings?.rating_overall && (
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <span className="text-sm font-medium">
                    {ratings.rating_overall.toFixed(2)}
                  </span>
                  {ratings.num_reviews && (
                    <span className="text-sm text-muted-foreground">
                      ({ratings.num_reviews})
                    </span>
                  )}
                </div>
              )}
              {isInSelectedMode && onRemove && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  className="ml-2 p-1 text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove from selected"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Property Details */}
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
            {details?.bedrooms !== undefined && (
              <span className="flex items-center gap-1">
                <Bed className="h-4 w-4" />
                {details.bedrooms} bed{details.bedrooms !== 1 ? 's' : ''}
              </span>
            )}
            {details?.baths !== undefined && (
              <span className="flex items-center gap-1">
                <Bath className="h-4 w-4" />
                {details.baths} bath{details.baths !== 1 ? 's' : ''}
              </span>
            )}
            {details?.guests !== undefined && (
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {details.guests} guest{details.guests !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Performance Metrics */}
          <div className="flex flex-wrap gap-4 mt-3">
            {/* Show calculated TTM rollups with YoY in selected mode, otherwise show API metrics */}
            {isInSelectedMode && comparable.rollups_calculated_at ? (
              <>
                <MetricWithYoY
                  label="TTM Revenue"
                  current={comparable.ttm_revenue}
                  prior={comparable.prior_ttm_revenue}
                  formatValue={formatCurrency}
                  isPositiveGood={true}
                  highlightCurrent={true}
                />
                <MetricWithYoY
                  label="Occupancy"
                  current={comparable.ttm_occupancy}
                  prior={comparable.prior_ttm_occupancy}
                  formatValue={(v) => v != null ? `${(v * 100).toFixed(0)}%` : 'N/A'}
                  isPositiveGood={true}
                />
                <MetricWithYoY
                  label="ADR"
                  current={comparable.ttm_adr}
                  prior={comparable.prior_ttm_adr}
                  formatValue={formatCurrency}
                  isPositiveGood={true}
                />
                <MetricWithYoY
                  label="RevPAR"
                  current={comparable.ttm_revpar}
                  prior={comparable.prior_ttm_revpar}
                  formatValue={formatCurrency}
                  isPositiveGood={true}
                />
              </>
            ) : (
              <>
                {metrics?.ttm_revenue !== undefined && (
                  <div className="bg-muted rounded px-2 py-1">
                    <span className="text-xs text-muted-foreground block">TTM Revenue</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {formatCurrency(metrics.ttm_revenue)}
                    </span>
                  </div>
                )}
                {metrics?.ttm_occupancy !== undefined && (
                  <div className="bg-muted rounded px-2 py-1">
                    <span className="text-xs text-muted-foreground block">Occupancy</span>
                    <span className="font-semibold">
                      {formatPercent(metrics.ttm_occupancy)}
                    </span>
                  </div>
                )}
                {metrics?.ttm_adr !== undefined && (
                  <div className="bg-muted rounded px-2 py-1">
                    <span className="text-xs text-muted-foreground block">ADR</span>
                    <span className="font-semibold">
                      {formatCurrency(metrics.ttm_adr)}
                    </span>
                  </div>
                )}
                {metrics?.ttm_revpar !== undefined && (
                  <div className="bg-muted rounded px-2 py-1">
                    <span className="text-xs text-muted-foreground block">RevPAR</span>
                    <span className="font-semibold">
                      {formatCurrency(metrics.ttm_revpar)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper component for displaying metric with YoY comparison
interface MetricWithYoYProps {
  label: string;
  current?: number | null;
  prior?: number | null;
  formatValue: (value?: number | null) => string;
  isPositiveGood?: boolean;
  highlightCurrent?: boolean;
}

function MetricWithYoY({ 
  label, 
  current, 
  prior, 
  formatValue, 
  isPositiveGood = true,
  highlightCurrent = false 
}: MetricWithYoYProps) {
  const calculateYoY = (): { change: number | null; isPositive: boolean } => {
    if (current == null || prior == null || prior === 0) {
      return { change: null, isPositive: true };
    }
    const change = ((current - prior) / prior) * 100;
    return { change, isPositive: change >= 0 };
  };

  const { change, isPositive } = calculateYoY();
  const isGood = isPositiveGood ? isPositive : !isPositive;

  return (
    <div className="bg-muted rounded px-2 py-1 min-w-[80px]">
      <span className="text-xs text-muted-foreground block">{label}</span>
      <span className={`font-semibold ${highlightCurrent ? 'text-green-600 dark:text-green-400' : ''}`}>
        {formatValue(current)}
      </span>
      {change !== null && (
        <div className={`flex items-center gap-0.5 text-xs ${isGood ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isPositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span>{isPositive ? '+' : ''}{change.toFixed(1)}%</span>
        </div>
      )}
      {change === null && prior == null && current != null && (
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
          <Minus className="h-3 w-3" />
          <span>No prior</span>
        </div>
      )}
    </div>
  );
}

// Compset Summary Card component
interface CompsetSummaryCardProps {
  summary: {
    avg_ttm_revenue: number | null;
    avg_ttm_adr: number | null;
    avg_ttm_occupancy: number | null;
    avg_ttm_revpar: number | null;
    avg_prior_ttm_revenue: number | null;
    avg_prior_ttm_adr: number | null;
    avg_prior_ttm_occupancy: number | null;
    avg_prior_ttm_revpar: number | null;
    selected_comparables_count: number | null;
    calculated_at: string | null;
  };
  formatCurrency: (value?: number | null) => string;
  formatPercent: (value?: number | null) => string;
}

function CompsetSummaryCard({ summary, formatCurrency, formatPercent }: CompsetSummaryCardProps) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="border rounded-lg p-4 bg-primary/5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <span className="font-medium">
            Compset Summary ({summary.selected_comparables_count || 0} Properties)
          </span>
        </div>
        {summary.calculated_at && (
          <span className="text-xs text-muted-foreground">
            Updated: {formatDate(summary.calculated_at)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricWithYoY
          label="Avg Revenue"
          current={summary.avg_ttm_revenue}
          prior={summary.avg_prior_ttm_revenue}
          formatValue={formatCurrency}
          isPositiveGood={true}
          highlightCurrent={true}
        />
        <MetricWithYoY
          label="Avg ADR"
          current={summary.avg_ttm_adr}
          prior={summary.avg_prior_ttm_adr}
          formatValue={formatCurrency}
          isPositiveGood={true}
        />
        <MetricWithYoY
          label="Avg Occupancy"
          current={summary.avg_ttm_occupancy}
          prior={summary.avg_prior_ttm_occupancy}
          formatValue={(v) => formatPercent(v)}
          isPositiveGood={true}
        />
        <MetricWithYoY
          label="Avg RevPAR"
          current={summary.avg_ttm_revpar}
          prior={summary.avg_prior_ttm_revpar}
          formatValue={formatCurrency}
          isPositiveGood={true}
        />
      </div>
    </div>
  );
}

// Monthly rollup data type
interface MonthlyRollup {
  date: string;
  month: string;
  avgRevenue: number | null;
  avgAdr: number | null;
  avgOccupancy: number | null;
  avgRevpar: number | null;
  propertyCount: number;
}

// Compset Trend Chart component
interface CompsetTrendChartProps {
  comparables: Comparable[];
  formatCurrency: (value?: number | null) => string;
  formatPercent: (value?: number | null) => string;
}

function CompsetTrendChart({ comparables, formatCurrency, formatPercent }: CompsetTrendChartProps) {
  const [activeMetric, setActiveMetric] = useState<'revenue' | 'adr' | 'occupancy' | 'revpar'>('revenue');
  const [timeRange, setTimeRange] = useState<'6m' | '12m' | '24m' | 'all'>('12m');

  const monthlyRollups = useMemo((): MonthlyRollup[] => {
    type MonthBucket = { revenue: number[]; adr: number[]; occupancy: number[]; revpar: number[] };
    const monthlyData: Record<string, MonthBucket> = {};

    // Aggregate all data by month
    comparables.forEach(comp => {
      const historicalData = comp.historical_metrics as { results?: Array<{
        date: string;
        revenue?: number;
        average_daily_rate?: number;
        occupancy?: number;
        rev_par?: number;
      }> } | null;
      
      if (!historicalData?.results) return;

      historicalData.results.forEach((monthData) => {
        const key = monthData.date; // "YYYY-MM"
        if (!monthlyData[key]) {
          monthlyData[key] = { revenue: [], adr: [], occupancy: [], revpar: [] };
        }
        const bucket = monthlyData[key];
        if (monthData.revenue && monthData.revenue > 0) bucket.revenue.push(monthData.revenue);
        if (monthData.average_daily_rate && monthData.average_daily_rate > 0) bucket.adr.push(monthData.average_daily_rate);
        if (monthData.occupancy && monthData.occupancy > 0) bucket.occupancy.push(monthData.occupancy);
        if (monthData.rev_par && monthData.rev_par > 0) bucket.revpar.push(monthData.rev_par);
      });
    });

    // Calculate averages and format
    const formatMonth = (dateStr: string) => {
      const [year, month] = dateStr.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1);
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    };

    return Object.entries(monthlyData)
      .map(([date, data]): MonthlyRollup => ({
        date,
        month: formatMonth(date),
        avgRevenue: data.revenue.length ? data.revenue.reduce((a, b) => a + b, 0) / data.revenue.length : null,
        avgAdr: data.adr.length ? data.adr.reduce((a, b) => a + b, 0) / data.adr.length : null,
        avgOccupancy: data.occupancy.length ? data.occupancy.reduce((a, b) => a + b, 0) / data.occupancy.length : null,
        avgRevpar: data.revpar.length ? data.revpar.reduce((a, b) => a + b, 0) / data.revpar.length : null,
        propertyCount: Math.max(data.revenue.length, data.adr.length, data.occupancy.length, data.revpar.length)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [comparables]);

  // Filter by selected time range
  const filteredRollups = useMemo(() => {
    if (timeRange === 'all') return monthlyRollups;
    
    const now = new Date();
    const monthsToShow = timeRange === '6m' ? 6 : timeRange === '12m' ? 12 : 24;
    const cutoffDate = new Date(now.getFullYear(), now.getMonth() - monthsToShow, 1);
    const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;
    
    return monthlyRollups.filter(r => r.date >= cutoffStr);
  }, [monthlyRollups, timeRange]);

  if (monthlyRollups.length === 0) {
    return null;
  }

  const metricConfig = {
    revenue: { key: 'avgRevenue', label: 'Avg Revenue', format: formatCurrency, color: 'hsl(var(--primary))' },
    adr: { key: 'avgAdr', label: 'Avg ADR', format: formatCurrency, color: 'hsl(var(--chart-2))' },
    occupancy: { key: 'avgOccupancy', label: 'Avg Occupancy', format: (v: number | null) => v != null ? `${(v * 100).toFixed(0)}%` : 'N/A', color: 'hsl(var(--chart-3))' },
    revpar: { key: 'avgRevpar', label: 'Avg RevPAR', format: formatCurrency, color: 'hsl(var(--chart-4))' },
  };

  const config = metricConfig[activeMetric];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as MonthlyRollup;
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium">{label}</p>
          <p className="text-sm" style={{ color: config.color }}>
            {config.label}: {config.format(payload[0].value)}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.propertyCount} propert{data.propertyCount === 1 ? 'y' : 'ies'}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="font-medium">Compset Monthly Performance</span>
        </div>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as typeof timeRange)}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6m">Last 6 Months</SelectItem>
            <SelectItem value="12m">Last 12 Months</SelectItem>
            <SelectItem value="24m">Last 24 Months</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Metric Tabs */}
      <div className="flex gap-2 mb-4">
        {(Object.keys(metricConfig) as Array<keyof typeof metricConfig>).map((metric) => (
          <button
            key={metric}
            onClick={() => setActiveMetric(metric)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeMetric === metric 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {metricConfig[metric].label.replace('Avg ', '')}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart 
            data={filteredRollups} 
            margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="month" 
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => {
                if (activeMetric === 'occupancy') return `${(value * 100).toFixed(0)}%`;
                if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
                return `$${value.toFixed(0)}`;
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey={config.key}
              stroke={config.color}
              strokeWidth={2}
              name={config.label}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

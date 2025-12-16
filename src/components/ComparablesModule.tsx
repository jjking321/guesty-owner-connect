import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Star, Users, Bed, Bath, Building, ExternalLink } from "lucide-react";

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
  const [radiusMiles, setRadiusMiles] = useState<number>(10);
  const [pendingSelections, setPendingSelections] = useState<Set<string>>(new Set());
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [matchBedrooms, setMatchBedrooms] = useState(false);
  
  // Pagination state
  const PAGE_SIZE = 10;
  const [currentOffset, setCurrentOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Load existing comparables on mount
  useEffect(() => {
    loadExistingComparables();
  }, [listingId]);

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
          bedrooms: matchBedrooms ? bedrooms : null,
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
          bedrooms: matchBedrooms ? bedrooms : null,
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Property Comparables</CardTitle>
            <CardDescription>
              Compare with similar short-term rentals in the area
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
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
        </div>

        {/* Filters Section */}
        <div className="mt-4 space-y-3">
          {/* Bedroom Filter */}
          {bedrooms !== undefined && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="match-bedrooms"
                checked={matchBedrooms}
                onCheckedChange={(checked) => setMatchBedrooms(checked === true)}
              />
              <Label htmlFor="match-bedrooms" className="text-sm cursor-pointer">
                Same bedrooms only ({bedrooms} bed{bedrooms !== 1 ? 's' : ''})
              </Label>
            </div>
          )}

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
        </div>

        {!hasCoordinates && (
          <p className="text-sm text-destructive mt-2">
            This property doesn't have valid coordinates. Cannot fetch comparables.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {comparables.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Building className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No comparables found. Click "Fetch Comparables" to search for similar properties.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Selected Comparables Section */}
            {selectedComparables.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">
                  Selected Comparables ({selectedComparables.length})
                </h4>
                <div className="space-y-3">
                  {selectedComparables.map((comp) => (
                    <ComparableCard
                      key={comp.id}
                      comparable={comp}
                      isSelected={pendingSelections.has(comp.id)}
                      onToggle={() => toggleSelection(comp.id)}
                      formatCurrency={formatCurrency}
                      formatPercent={formatPercent}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Available Comparables Section */}
            {unselectedComparables.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">
                  Available Comparables ({unselectedComparables.length})
                </h4>
                <div className="space-y-3">
                  {unselectedComparables.map((comp) => (
                    <ComparableCard
                      key={comp.id}
                      comparable={comp}
                      isSelected={pendingSelections.has(comp.id)}
                      onToggle={() => toggleSelection(comp.id)}
                      formatCurrency={formatCurrency}
                      formatPercent={formatPercent}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Save Button */}
            {hasChanges && (
              <div className="flex justify-end pt-4 border-t">
                <Button onClick={saveSelections} disabled={saving}>
                  {saving ? 'Saving...' : `Save Selections (${pendingSelections.size})`}
                </Button>
              </div>
            )}
              </div>
            )}

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
      </CardContent>
    </Card>
  );
}

interface ComparableCardProps {
  comparable: Comparable;
  isSelected: boolean;
  onToggle: () => void;
  formatCurrency: (value?: number) => string;
  formatPercent: (value?: number) => string;
}

function ComparableCard({ 
  comparable, 
  isSelected, 
  onToggle,
  formatCurrency,
  formatPercent,
}: ComparableCardProps) {
  const details = comparable.property_details;
  const metrics = comparable.performance_metrics;
  const ratings = comparable.ratings;

  return (
    <div 
      className={`border rounded-lg p-4 transition-colors ${
        isSelected ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50'
      }`}
    >
      <div className="flex gap-4">
        {/* Checkbox */}
        <div className="flex items-start pt-1">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggle}
            aria-label={`Select ${comparable.listing_name}`}
          />
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
          </div>
        </div>
      </div>
    </div>
  );
}

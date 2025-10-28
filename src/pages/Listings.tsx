import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Home, MapPin, Users, Bed, RefreshCw, Search, Filter } from "lucide-react";
import { useSmartNavigation } from "@/hooks/useSmartNavigation";

export default function Listings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { navigateToProperty } = useSmartNavigation();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState({
    active: true,
    inactive: false,
    listed: true,
    unlisted: false,
    archived: false,
  });

  useEffect(() => {
    loadListings();
  }, []);

  const loadListings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .order("nickname", { ascending: true });

      if (error) throw error;
      setListings(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading listings",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getAddress = (address: any) => {
    if (!address) return "N/A";
    const parts = [address.city, address.state, address.country].filter(Boolean);
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

  const filteredListings = listings.filter((listing) => {
    // Status filters
    const activeMatch = (statusFilters.active && listing.active) || 
                       (statusFilters.inactive && !listing.active);
    const listedMatch = (statusFilters.listed && listing.is_listed) || 
                       (statusFilters.unlisted && !listing.is_listed);
    const archivedMatch = (statusFilters.archived && listing.archived) || 
                         (!statusFilters.archived && !listing.archived);
    
    // If no active/inactive filter is selected, show all
    const hasActiveFilter = statusFilters.active || statusFilters.inactive;
    const hasListedFilter = statusFilters.listed || statusFilters.unlisted;
    
    const statusMatch = 
      (!hasActiveFilter || activeMatch) &&
      (!hasListedFilter || listedMatch) &&
      archivedMatch;

    // Search filter
    const searchLower = searchQuery.toLowerCase();
    const nickname = listing.nickname?.toLowerCase() || "";
    const propertyType = listing.property_type?.toLowerCase() || "";
    const address = getAddress(listing.address).toLowerCase();
    
    const searchMatch = !searchQuery || (
      nickname.includes(searchLower) ||
      propertyType.includes(searchLower) ||
      address.includes(searchLower)
    );
    
    return statusMatch && searchMatch;
  });

  const activeFilterCount = Object.values(statusFilters).filter(Boolean).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Properties</h2>
            <p className="text-muted-foreground">
              {loading ? (
                "Loading properties..."
              ) : (
                <>
                  Showing {filteredListings.length} of {listings.length} {listings.length === 1 ? 'property' : 'properties'}
                  {searchQuery && ` matching "${searchQuery}"`}
                </>
              )}
            </p>
          </div>
          <Button onClick={loadListings} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search properties by name, type, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="relative">
                <Filter className="mr-2 h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center" variant="secondary">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 z-50 bg-popover" align="end">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-3">Status</h4>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="active"
                        checked={statusFilters.active}
                        onCheckedChange={(checked) =>
                          setStatusFilters({ ...statusFilters, active: checked as boolean })
                        }
                      />
                      <label htmlFor="active" className="text-sm cursor-pointer">
                        Active
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="inactive"
                        checked={statusFilters.inactive}
                        onCheckedChange={(checked) =>
                          setStatusFilters({ ...statusFilters, inactive: checked as boolean })
                        }
                      />
                      <label htmlFor="inactive" className="text-sm cursor-pointer">
                        Inactive
                      </label>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-3">Listing</h4>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="listed"
                        checked={statusFilters.listed}
                        onCheckedChange={(checked) =>
                          setStatusFilters({ ...statusFilters, listed: checked as boolean })
                        }
                      />
                      <label htmlFor="listed" className="text-sm cursor-pointer">
                        Listed
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="unlisted"
                        checked={statusFilters.unlisted}
                        onCheckedChange={(checked) =>
                          setStatusFilters({ ...statusFilters, unlisted: checked as boolean })
                        }
                      />
                      <label htmlFor="unlisted" className="text-sm cursor-pointer">
                        Unlisted
                      </label>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-3">Archive</h4>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="archived"
                        checked={statusFilters.archived}
                        onCheckedChange={(checked) =>
                          setStatusFilters({ ...statusFilters, archived: checked as boolean })
                        }
                      />
                      <label htmlFor="archived" className="text-sm cursor-pointer">
                        Show Archived
                      </label>
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    setStatusFilters({
                      active: true,
                      inactive: false,
                      listed: true,
                      unlisted: false,
                      archived: false,
                    })
                  }
                >
                  Reset Filters
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading properties...</div>
        ) : listings.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Properties Found</CardTitle>
              <CardDescription>
                Connect your Guesty account and sync your listings to see them here.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : filteredListings.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Properties Match Your Search</CardTitle>
              <CardDescription>
                Try adjusting your search terms.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredListings.map((listing) => (
              <Card
                key={listing.id}
                className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => navigateToProperty(listing.id, {
                  path: '/listings',
                  label: 'Properties',
                  state: {
                    searchQuery,
                    filters: statusFilters,
                    scrollPosition: window.scrollY
                  }
                })}
              >
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
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg line-clamp-1">{listing.nickname || "Unnamed Property"}</CardTitle>
                    <div className="flex gap-1 flex-wrap">
                      {listing.active && (
                        <Badge variant="secondary">Active</Badge>
                      )}
                      {!listing.active && (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                      {listing.is_listed && (
                        <Badge variant="outline">Listed</Badge>
                      )}
                      {listing.archived && (
                        <Badge variant="destructive">Archived</Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {getAddress(listing.address)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Home className="h-4 w-4" />
                      <span>{listing.property_type || "N/A"}</span>
                    </div>
                    {listing.bedrooms !== null && (
                      <div className="flex items-center gap-1">
                        <Bed className="h-4 w-4" />
                        <span>{listing.bedrooms} bed</span>
                      </div>
                    )}
                    {listing.accommodates !== null && (
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        <span>{listing.accommodates}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

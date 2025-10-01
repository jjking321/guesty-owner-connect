import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Home, MapPin, Users, Bed, RefreshCw } from "lucide-react";

export default function Listings() {
  const { toast } = useToast();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Properties</h2>
            <p className="text-muted-foreground">View and manage all your vacation rental properties</p>
          </div>
          <Button onClick={loadListings} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
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
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <Card key={listing.id} className="overflow-hidden">
                {listing.thumbnail && (
                  <div className="aspect-video w-full overflow-hidden bg-muted">
                    <img
                      src={listing.thumbnail}
                      alt={listing.nickname}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg line-clamp-1">{listing.nickname || "Unnamed Property"}</CardTitle>
                    <div className="flex gap-1">
                      {listing.active && (
                        <Badge variant="secondary">Active</Badge>
                      )}
                      {listing.is_listed && (
                        <Badge variant="outline">Listed</Badge>
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

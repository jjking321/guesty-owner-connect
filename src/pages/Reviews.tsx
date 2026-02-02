import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ReviewsTable } from "@/components/ReviewsTable";
import { ReviewsSummary } from "@/components/ReviewsSummary";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";

export default function Reviews() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProperty, setSelectedProperty] = useState<string>('all');
  const [syncingReviews, setSyncingReviews] = useState(false);
  const [guestyAccountId, setGuestyAccountId] = useState<string | null>(null);

  // Fetch guesty account ID on load
  useEffect(() => {
    const fetchAccountId = async () => {
      const { data } = await supabase
        .from('guesty_accounts')
        .select('id')
        .limit(1)
        .single();
      
      if (data) {
        setGuestyAccountId(data.id);
      }
    };
    fetchAccountId();
  }, []);

  // Fetch all reviews
  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['reviews', 'all'],
    queryFn: async () => {
      // Fetch reviews
      const { data: reviewsData, error: reviewsError } = await supabase
        .from('reviews')
        .select('*')
        .order('review_date', { ascending: false });

      if (reviewsError) throw reviewsError;

      // Fetch listings
      const { data: listingsData, error: listingsError } = await supabase
        .from('listings')
        .select('id, nickname');

      if (listingsError) throw listingsError;

      // Create a map of listing_id to nickname
      const listingsMap = new Map(
        (listingsData || []).map(l => [l.id, l.nickname])
      );

      // Combine the data
      return (reviewsData || []).map(review => ({
        ...review,
        property_name: listingsMap.get(review.listing_id) || 'Unknown Property',
        category_ratings: review.category_ratings as Record<string, number> | undefined,
      }));
    },
  });

  // Fetch properties for filter
  const { data: properties = [] } = useQuery({
    queryKey: ['listings', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('id, nickname')
        .order('nickname');

      if (error) throw error;
      return data || [];
    },
  });

  // Mark as removed mutation
  const markAsRemovedMutation = useMutation({
    mutationFn: async ({ reviewId, reason }: { reviewId: string; reason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('reviews')
        .update({
          is_removed: true,
          removed_at: new Date().toISOString(),
          removed_by: user?.id,
          removed_reason: reason,
        })
        .eq('id', reviewId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      toast({
        title: "Review marked as removed",
        description: "The review has been flagged as removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Restore review mutation
  const restoreMutation = useMutation({
    mutationFn: async (reviewId: string) => {
      const { error } = await supabase
        .from('reviews')
        .update({
          is_removed: false,
          removed_at: null,
          removed_by: null,
          removed_reason: null,
        })
        .eq('id', reviewId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      toast({
        title: "Review restored",
        description: "The review has been restored.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleMarkAsRemoved = async (reviewId: string, reason: string) => {
    await markAsRemovedMutation.mutateAsync({ reviewId, reason });
  };

  const handleRestore = async (reviewId: string) => {
    await restoreMutation.mutateAsync(reviewId);
  };

  const handleSyncNewReviews = async () => {
    if (!guestyAccountId) {
      toast({
        title: "No account found",
        description: "Please connect a Guesty account in Settings first.",
        variant: "destructive",
      });
      return;
    }

    setSyncingReviews(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-new-reviews", {
        body: { guestyAccountId },
      });

      if (error) throw error;

      if (data?.requiresFullSync) {
        toast({
          title: "Full sync required",
          description: "Please run a full review sync from Settings first.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Review sync started",
        description: "Fetching new reviews since last sync...",
      });

      // Refresh reviews after a short delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['reviews'] });
      }, 3000);
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingReviews(false);
    }
  };

  // Filter reviews by property
  const filteredReviews = selectedProperty === 'all' 
    ? reviews 
    : reviews.filter(r => r.listing_id === selectedProperty);

  if (reviewsLoading) {
    return (
      <DashboardLayout>
        <div className="text-center py-12 text-muted-foreground">Loading reviews...</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Reviews Management</h2>
            <p className="text-muted-foreground">View and manage reviews across all properties</p>
          </div>
          <Button 
            onClick={handleSyncNewReviews} 
            disabled={syncingReviews || !guestyAccountId}
            variant="outline"
          >
            {syncingReviews ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync New Reviews
          </Button>
        </div>

        {/* Property Filter */}
        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
            <CardDescription>Select a property to filter reviews</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={selectedProperty} onValueChange={setSelectedProperty}>
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Properties</SelectItem>
                {properties.map(property => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.nickname || property.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Reviews Summary */}
        <ReviewsSummary reviews={filteredReviews} />

        {/* Reviews Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Reviews</CardTitle>
            <CardDescription>
              {filteredReviews.length} reviews total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewsTable
              reviews={filteredReviews}
              onMarkAsRemoved={handleMarkAsRemoved}
              onRestore={handleRestore}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

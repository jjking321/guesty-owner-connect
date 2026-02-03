import { useState, useEffect } from "react";
import { subDays } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ReviewsTable } from "@/components/ReviewsTable";
import { ReviewsSummary } from "@/components/ReviewsSummary";
import { DateRangeFilter, DateRange } from "@/components/DateRangeFilter";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 100;

export default function Reviews() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProperty, setSelectedProperty] = useState<string>('all');
  const [syncingReviews, setSyncingReviews] = useState(false);
  const [guestyAccountId, setGuestyAccountId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 29),
    to: new Date(),
    preset: "last30",
  });

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

  // Fetch total review count for pagination
  const { data: totalCount = 0 } = useQuery({
    queryKey: ['reviews', 'count', selectedProperty, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from('reviews')
        .select('*', { count: 'exact', head: true })
        .eq('is_removed', false);
      
      if (selectedProperty !== 'all') {
        query = query.eq('listing_id', selectedProperty);
      }

      if (dateRange.from && dateRange.to) {
        query = query
          .gte('review_date', dateRange.from.toISOString().split('T')[0])
          .lte('review_date', dateRange.to.toISOString().split('T')[0]);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch summary stats for the full filtered dataset (not just current page)
  const { data: summaryStats = [] } = useQuery({
    queryKey: ['reviews', 'summary', selectedProperty, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from('reviews')
        .select('rating, source, is_removed, category_ratings')
        .eq('is_removed', false);
      
      if (selectedProperty !== 'all') {
        query = query.eq('listing_id', selectedProperty);
      }

      if (dateRange.from && dateRange.to) {
        query = query
          .gte('review_date', dateRange.from.toISOString().split('T')[0])
          .lte('review_date', dateRange.to.toISOString().split('T')[0]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch paginated reviews
  const { data: reviews = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['reviews', 'paginated', selectedProperty, currentPage, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('reviews')
        .select('*')
        .eq('is_removed', false)
        .order('review_date', { ascending: false })
        .range(from, to);
      
      if (selectedProperty !== 'all') {
        query = query.eq('listing_id', selectedProperty);
      }

      if (dateRange.from && dateRange.to) {
        query = query
          .gte('review_date', dateRange.from.toISOString().split('T')[0])
          .lte('review_date', dateRange.to.toISOString().split('T')[0]);
      }

      const { data: reviewsData, error: reviewsError } = await query;
      if (reviewsError) throw reviewsError;

      // Fetch listings for property names
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

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedProperty, dateRange.from, dateRange.to]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const showingFrom = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(currentPage * PAGE_SIZE, totalCount);

  if (reviewsLoading && currentPage === 1) {
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

        {/* Filter */}
        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
            <CardDescription>Filter reviews by property and date range</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
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
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
          </CardContent>
        </Card>

        {/* Reviews Summary - uses full filtered dataset */}
        <ReviewsSummary reviews={summaryStats.map(r => ({
          ...r,
          category_ratings: r.category_ratings as Record<string, number> | undefined,
        }))} />

        {/* Reviews Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Reviews</CardTitle>
                <CardDescription>
                  Showing {showingFrom.toLocaleString()} - {showingTo.toLocaleString()} of {totalCount.toLocaleString()} reviews
                </CardDescription>
              </div>
              {/* Pagination Controls */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || reviewsLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  Page {currentPage} of {totalPages || 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages || reviewsLoading}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ReviewsTable
              reviews={reviews}
              onMarkAsRemoved={handleMarkAsRemoved}
              onRestore={handleRestore}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
import { useState, useEffect } from "react";
import { subDays } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReviewsTable } from "@/components/ReviewsTable";
import { ReviewsSummaryAggregated } from "@/components/ReviewsSummaryAggregated";
import { RatingTrendChart } from "@/components/RatingTrendChart";
import { DateRangeFilter, DateRange } from "@/components/DateRangeFilter";
import { AirbnbRatingsTable } from "@/components/AirbnbRatingsTable";
import { AirbnbIcon } from "@/components/icons/AirbnbIcon";
import { SyncProgressCard } from "@/components/SyncProgressCard";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";

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

  // Fetch last sync time
  const { data: lastSyncTime } = useQuery({
    queryKey: ['reviews', 'lastSync', guestyAccountId],
    queryFn: async () => {
      if (!guestyAccountId) return null;
      
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('completed_at')
        .eq('guesty_account_id', guestyAccountId)
        .in('sync_type', ['reviews', 'new_reviews'])
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error || !data?.completed_at) return null;
      return new Date(data.completed_at).toLocaleString();
    },
    enabled: !!guestyAccountId,
  });

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

  // Fetch summary stats using server-side aggregation (avoids 1000 row limit)
  const { data: summaryStats } = useQuery({
    queryKey: ['reviews', 'summary', selectedProperty, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_review_summary_stats', {
        p_listing_id: selectedProperty === 'all' ? null : selectedProperty,
        p_start_date: dateRange.from ? dateRange.from.toISOString().split('T')[0] : null,
        p_end_date: dateRange.to ? dateRange.to.toISOString().split('T')[0] : null,
      });

      if (error) throw error;
      
      const row = data?.[0];
      if (!row) return null;
      
      return {
        total_reviews: row.total_reviews,
        avg_rating: row.avg_rating,
        rating_1_count: row.rating_1_count,
        rating_2_count: row.rating_2_count,
        rating_3_count: row.rating_3_count,
        rating_4_count: row.rating_4_count,
        rating_5_count: row.rating_5_count,
        platform_stats: row.platform_stats as { source: string; count: number; avg_rating: number }[],
        category_averages: row.category_averages as Record<string, number>,
      };
    },
  });

  // Fetch monthly rating trend data
  const { data: ratingTrendData = [], isLoading: trendLoading } = useQuery({
    queryKey: ['reviews', 'trend', selectedProperty, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_monthly_rating_trend', {
        p_listing_id: selectedProperty === 'all' ? null : selectedProperty,
        p_start_date: dateRange.from ? dateRange.from.toISOString().split('T')[0] : null,
        p_end_date: dateRange.to ? dateRange.to.toISOString().split('T')[0] : null,
      });

      if (error) throw error;
      return (data || []) as { month: string; avg_rating: number; review_count: number }[];
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
      // SyncProgressCard handles data refresh via onComplete callback
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
            <p className="text-muted-foreground">
              View and manage reviews across all properties
              {lastSyncTime && (
                <span className="ml-2 text-xs">• Last synced: {lastSyncTime}</span>
              )}
            </p>
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

        {/* Live sync progress tracking */}
        {guestyAccountId && (
          <SyncProgressCard
            accountId={guestyAccountId}
            syncType="new_reviews"
            onComplete={() => queryClient.invalidateQueries({ queryKey: ['reviews'] })}
          />
        )}

        <Tabs defaultValue="reviews" className="space-y-6">
          <TabsList>
            <TabsTrigger value="reviews" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Guest Reviews
            </TabsTrigger>
            <TabsTrigger value="airbnb-ratings" className="gap-2">
              <AirbnbIcon className="h-4 w-4" />
              Airbnb Ratings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="reviews" className="space-y-6">
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

            {/* Reviews Summary - uses server-side aggregation */}
            <ReviewsSummaryAggregated stats={summaryStats} />

            {/* Rating Trend Chart */}
            <RatingTrendChart data={ratingTrendData} isLoading={trendLoading} />

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
          </TabsContent>

          <TabsContent value="airbnb-ratings">
            <AirbnbRatingsTable />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
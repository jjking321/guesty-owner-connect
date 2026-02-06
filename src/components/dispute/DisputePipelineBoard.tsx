import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { DisputeCard } from "./DisputeCard";
import { DisputeDetailSheet } from "./DisputeDetailSheet";
import { cn } from "@/lib/utils";

interface DisputeReview {
  id: string;
  listing_id: string;
  guest_name: string | null;
  rating: number | null;
  review_date: string | null;
  review_text: string | null;
  source: string | null;
  category_ratings: Record<string, number> | null;
  dispute_status: string | null;
  dispute_resolution: string | null;
  dispute_likelihood_score: number | null;
  dispute_violation_category: string | null;
  dispute_case_file: any;
  dispute_analyzed_at: string | null;
  dispute_is_high_priority: boolean | null;
  dispute_message_history: any;
  dispute_conversation_summary: string | null;
  dispute_has_threats: boolean | null;
  dispute_has_pressure: boolean | null;
  dispute_has_refund_demands: boolean | null;
  dispute_notes: string | null;
  property_name?: string;
  reservation_id?: string | null;
}

const COLUMNS = [
  { id: 'triage', label: 'Triage', color: 'bg-yellow-500' },
  { id: 'analyzing', label: 'Analyzing', color: 'bg-blue-500' },
  { id: 'not_eligible', label: 'Not Eligible', color: 'bg-muted-foreground' },
  { id: 'submit_claim', label: 'Submit Claim', color: 'bg-orange-500' },
  { id: 'submitted', label: 'Submitted', color: 'bg-purple-500' },
  { id: 'pending', label: 'Pending', color: 'bg-indigo-500' },
  { id: 'resolved', label: 'Resolved', color: 'bg-green-500' },
];

export function DisputePipelineBoard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProperty, setSelectedProperty] = useState<string>('all');
  const [selectedReview, setSelectedReview] = useState<DisputeReview | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [analyzingBatch, setAnalyzingBatch] = useState(false);

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

  // Auto-populate triage on first load
  useEffect(() => {
    const populateTriage = async () => {
      // Find Airbnb reviews with rating < 4 that have no dispute_status
      const { data: newReviews, error } = await supabase
        .from('reviews')
        .select('id')
        .eq('is_removed', false)
        .ilike('source', '%airbnb%')
        .lt('rating', 4)
        .is('dispute_status', null);

      if (error) {
        console.error('Error finding new dispute candidates:', error);
        return;
      }

      if (newReviews && newReviews.length > 0) {
        console.log(`Found ${newReviews.length} new reviews for triage`);
        
        // Update them to triage status
        const { error: updateError } = await supabase
          .from('reviews')
          .update({ dispute_status: 'triage' })
          .in('id', newReviews.map(r => r.id));

        if (updateError) {
          console.error('Error updating triage status:', updateError);
        } else {
          queryClient.invalidateQueries({ queryKey: ['dispute-reviews'] });
        }
      }
    };

    populateTriage();
  }, []);

  // Fetch all dispute reviews
  const { data: reviews = [], isLoading, refetch } = useQuery({
    queryKey: ['dispute-reviews', selectedProperty],
    queryFn: async () => {
      let query = supabase
        .from('reviews')
        .select('*')
        .eq('is_removed', false)
        .ilike('source', '%airbnb%')
        .lt('rating', 4)
        .not('dispute_status', 'is', null)
        .order('review_date', { ascending: false });

      if (selectedProperty !== 'all') {
        query = query.eq('listing_id', selectedProperty);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Get property names
      const listingIds = [...new Set(data?.map(r => r.listing_id) || [])];
      const { data: listings } = await supabase
        .from('listings')
        .select('id, nickname')
        .in('id', listingIds);

      const listingsMap = new Map(listings?.map(l => [l.id, l.nickname]) || []);

      return (data || []).map(review => ({
        ...review,
        property_name: listingsMap.get(review.listing_id) || 'Unknown Property',
        category_ratings: review.category_ratings as Record<string, number> | null,
      }));
    },
  });

  // Sync selectedReview when reviews data updates (for real-time UI after AI analysis)
  useEffect(() => {
    if (selectedReview && reviews.length > 0) {
      const updated = reviews.find(r => r.id === selectedReview.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedReview)) {
        setSelectedReview(updated);
      }
    }
  }, [reviews, selectedReview]);

  // Group reviews by status
  const reviewsByColumn = COLUMNS.reduce((acc, col) => {
    acc[col.id] = reviews.filter(r => r.dispute_status === col.id);
    return acc;
  }, {} as Record<string, DisputeReview[]>);

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    // Don't allow dropping on analyzing column (AI-controlled)
    if (columnId !== 'analyzing') {
      setDragOverColumn(columnId);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    // Don't allow dropping on analyzing column
    if (newStatus === 'analyzing') return;

    const reviewId = e.dataTransfer.getData('reviewId');
    if (!reviewId) return;

    const review = reviews.find(r => r.id === reviewId);
    if (!review || review.dispute_status === newStatus) return;

    const updateData: any = { 
      dispute_status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (newStatus === 'submitted') {
      updateData.dispute_submitted_at = new Date().toISOString();
    } else if (newStatus === 'resolved') {
      updateData.dispute_resolved_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('reviews')
      .update(updateData)
      .eq('id', reviewId);

    if (error) {
      toast({
        title: "Failed to move review",
        description: error.message,
        variant: "destructive",
      });
    } else {
      queryClient.invalidateQueries({ queryKey: ['dispute-reviews'] });
    }
  };

  // Batch analyze triage items
  const handleAnalyzeBatch = async () => {
    const triageReviews = reviewsByColumn['triage'] || [];
    if (triageReviews.length === 0) {
      toast({ title: "No reviews in triage" });
      return;
    }

    setAnalyzingBatch(true);
    
    // Analyze up to 5 at a time
    const batch = triageReviews.slice(0, 5);
    let successCount = 0;

    for (const review of batch) {
      try {
        const { error } = await supabase.functions.invoke('analyze-review-dispute', {
          body: { reviewId: review.id, includeConversation: true },
        });

        if (!error) {
          successCount++;
        }
      } catch (error) {
        console.error(`Failed to analyze ${review.id}:`, error);
      }
    }

    setAnalyzingBatch(false);
    queryClient.invalidateQueries({ queryKey: ['dispute-reviews'] });
    
    toast({
      title: "Batch analysis complete",
      description: `Analyzed ${successCount} of ${batch.length} reviews`,
    });
  };

  const handleCardClick = (review: DisputeReview) => {
    setSelectedReview(review);
    setSheetOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalCount = reviews.length;
  const highPriorityCount = reviews.filter(r => r.dispute_is_high_priority).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Select value={selectedProperty} onValueChange={setSelectedProperty}>
            <SelectTrigger className="w-[250px]">
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

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{totalCount} disputes</Badge>
            {highPriorityCount > 0 && (
              <Badge variant="destructive">{highPriorityCount} high priority</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button 
            size="sm"
            onClick={handleAnalyzeBatch}
            disabled={analyzingBatch || (reviewsByColumn['triage']?.length || 0) === 0}
          >
            {analyzingBatch ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Analyze Triage ({reviewsByColumn['triage']?.length || 0})
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4 min-w-max">
          {COLUMNS.map(column => (
            <div
              key={column.id}
              className={cn(
                "w-72 flex-shrink-0 rounded-lg border bg-muted/50 transition-colors",
                dragOverColumn === column.id && column.id !== 'analyzing' && "ring-2 ring-primary"
              )}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {/* Column Header */}
              <div className="p-3 border-b flex items-center gap-2">
                <div className={cn("w-3 h-3 rounded-full", column.color)} />
                <span className="font-medium text-sm">{column.label}</span>
                <Badge variant="secondary" className="ml-auto">
                  {reviewsByColumn[column.id]?.length || 0}
                </Badge>
              </div>

              {/* Column Content */}
              <ScrollArea className="h-[calc(100vh-320px)]">
                <div className="p-2 space-y-2">
                  {(reviewsByColumn[column.id] || []).map(review => (
                    <DisputeCard
                      key={review.id}
                      review={review}
                      onClick={() => handleCardClick(review)}
                    />
                  ))}
                  {(reviewsByColumn[column.id]?.length || 0) === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No reviews
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Detail Sheet */}
      <DisputeDetailSheet
        review={selectedReview}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdate={() => {
          queryClient.invalidateQueries({ queryKey: ['dispute-reviews'] });
        }}
      />
    </div>
  );
}

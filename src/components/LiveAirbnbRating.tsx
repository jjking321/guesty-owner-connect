import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AirbnbIcon } from "@/components/icons/AirbnbIcon";
import { RefreshCw, Star, ExternalLink, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface LiveAirbnbRatingProps {
  listingId: string;
  calculatedRating?: number;
  calculatedCount?: number;
}

export function LiveAirbnbRating({
  listingId,
  calculatedRating,
  calculatedCount,
}: LiveAirbnbRatingProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch listing's live rating data
  const { data: listing, isLoading } = useQuery({
    queryKey: ["listing-live-rating", listingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select(
          "live_airbnb_rating, live_airbnb_review_count, live_rating_scraped_at, live_rating_scrape_error, airbnb_listing_id"
        )
        .eq("id", listingId)
        .single();

      if (error) throw error;
      return data;
    },
  });

  // Scrape mutation
  const scrapeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "scrape-airbnb-rating",
        {
          body: { listingId },
        }
      );
      if (error) throw error;
      if (data?.error && !data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["listing-live-rating", listingId] });
      if (data?.success) {
        toast({
          title: "Rating updated",
          description: `Live Airbnb rating: ${data.rating} (${data.reviewCount} reviews)`,
        });
      } else {
        toast({
          title: "Scrape completed with issues",
          description: data?.error || "Could not extract rating data",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to fetch rating",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // If no Airbnb listing ID, don't render
  if (!isLoading && !listing?.airbnb_listing_id) {
    return null;
  }

  const hasRating = listing?.live_airbnb_rating !== null && listing?.live_airbnb_rating !== undefined;
  const hasError = listing?.live_rating_scrape_error && !hasRating;
  const lastScraped = listing?.live_rating_scraped_at
    ? formatDistanceToNow(new Date(listing.live_rating_scraped_at), { addSuffix: true })
    : null;

  // Calculate differences
  const ratingDiff =
    hasRating && calculatedRating !== undefined
      ? listing.live_airbnb_rating - calculatedRating
      : null;
  const countDiff =
    hasRating && calculatedCount !== undefined
      ? (listing.live_airbnb_review_count ?? 0) - calculatedCount
      : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AirbnbIcon className="h-4 w-4 text-[#FF5A5F]" />
            Live Airbnb Rating
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrapeMutation.mutate()}
            disabled={scrapeMutation.isPending}
            className="h-8"
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${scrapeMutation.isPending ? "animate-spin" : ""}`}
            />
            {scrapeMutation.isPending ? "Fetching..." : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : hasError ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">Unable to fetch live rating</span>
            </div>
            <p className="text-xs text-muted-foreground">{listing.live_rating_scrape_error}</p>
            {lastScraped && (
              <p className="text-xs text-muted-foreground">Last attempt: {lastScraped}</p>
            )}
          </div>
        ) : hasRating ? (
          <div className="space-y-3">
            {/* Main rating display */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Star className="h-5 w-5 fill-[#FF5A5F] text-[#FF5A5F]" />
                <span className="text-2xl font-bold">{listing.live_airbnb_rating.toFixed(2)}</span>
              </div>
              <span className="text-muted-foreground">
                ({listing.live_airbnb_review_count ?? 0} reviews on Airbnb)
              </span>
            </div>

            {/* Last scraped */}
            {lastScraped && (
              <p className="text-xs text-muted-foreground">Last checked: {lastScraped}</p>
            )}

            {/* Comparison with calculated */}
            {calculatedRating !== undefined && calculatedCount !== undefined && (
              <div className="pt-2 border-t space-y-1">
              <p className="text-sm text-muted-foreground">
                  Calculated from synced Airbnb reviews:{" "}
                  <span className="font-medium text-foreground">
                    ★ {calculatedRating.toFixed(2)}
                  </span>{" "}
                  ({calculatedCount} reviews)
                </p>
                {(ratingDiff !== null || countDiff !== null) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {ratingDiff !== null && ratingDiff !== 0 && (
                      <Badge variant={ratingDiff > 0 ? "default" : "destructive"} className="text-xs">
                        {ratingDiff > 0 ? "+" : ""}
                        {ratingDiff.toFixed(2)} rating
                      </Badge>
                    )}
                    {countDiff !== null && countDiff !== 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {countDiff > 0 ? "+" : ""}
                        {countDiff} reviews
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Link to Airbnb */}
            {listing.airbnb_listing_id && (
              <a
                href={`https://www.airbnb.com/rooms/${listing.airbnb_listing_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View on Airbnb
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              No live rating data yet. Click refresh to fetch from Airbnb.
            </p>
            {listing?.airbnb_listing_id && (
              <a
                href={`https://www.airbnb.com/rooms/${listing.airbnb_listing_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View on Airbnb
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

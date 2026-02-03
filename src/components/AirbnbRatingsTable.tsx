import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AirbnbIcon } from "@/components/icons/AirbnbIcon";
import { Link } from "react-router-dom";

type SortOrder = 'low-to-high' | 'high-to-low';

export function AirbnbRatingsTable() {
  const [sortOrder, setSortOrder] = useState<SortOrder>('low-to-high');

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['airbnb-ratings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('id, nickname, airbnb_listing_id, live_airbnb_rating, live_airbnb_review_count, live_rating_scraped_at')
        .not('airbnb_listing_id', 'is', null)
        .eq('is_listed', true)
        .eq('archived', false)
        .order('nickname');

      if (error) throw error;
      return data || [];
    },
  });

  const sortedListings = [...listings].sort((a, b) => {
    const ratingA = a.live_airbnb_rating;
    const ratingB = b.live_airbnb_rating;

    // Properties without ratings go to the end
    if (ratingA === null && ratingB === null) return 0;
    if (ratingA === null) return 1;
    if (ratingB === null) return -1;

    if (sortOrder === 'low-to-high') {
      return ratingA - ratingB;
    }
    return ratingB - ratingA;
  });

  const withRatingCount = listings.filter(l => l.live_airbnb_rating !== null).length;
  const totalCount = listings.length;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading Airbnb ratings...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <AirbnbIcon className="h-5 w-5 text-[#FF385C]" />
            Airbnb Live Ratings
          </CardTitle>
          <div className="flex items-center gap-4">
            <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low-to-high">Low to High</SelectItem>
                <SelectItem value="high-to-low">High to Low</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {withRatingCount} of {totalCount} properties scraped
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead className="text-center">Rating</TableHead>
                <TableHead className="text-center">Reviews</TableHead>
                <TableHead>Last Scraped</TableHead>
                <TableHead className="text-center">Airbnb</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedListings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No listings with Airbnb IDs found
                  </TableCell>
                </TableRow>
              ) : (
                sortedListings.map((listing) => (
                  <TableRow key={listing.id}>
                    <TableCell>
                      <Link
                        to={`/property/${listing.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {listing.nickname || 'Unnamed Property'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">
                      {listing.live_airbnb_rating !== null ? (
                        <div className="flex items-center justify-center gap-1">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                          <span className="font-medium">{listing.live_airbnb_rating.toFixed(2)}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Not scraped</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {listing.live_airbnb_review_count !== null ? (
                        <span>{listing.live_airbnb_review_count.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {listing.live_rating_scraped_at ? (
                        <span className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(listing.live_rating_scraped_at), { addSuffix: true })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <a
                        href={`https://www.airbnb.com/rooms/${listing.airbnb_listing_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center p-2 rounded-md hover:bg-muted transition-colors"
                        title="View on Airbnb"
                      >
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

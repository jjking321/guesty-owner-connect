import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Trash2, RotateCcw, Eye } from "lucide-react";
import { format } from "date-fns";
import { ReviewManagementDialog } from "./ReviewManagementDialog";
import { PlatformIcon } from "@/components/icons/PlatformIcon";

interface Review {
  id: string;
  guest_name: string | null;
  rating: number | null;
  review_text?: string | null;
  response_text?: string | null;
  private_note?: string | null;
  review_date: string | null;
  source: string | null;
  is_removed: boolean;
  removed_reason?: string | null;
  category_ratings?: Record<string, number> | null;
  property_name?: string;
}

interface ReviewsTableProps {
  reviews: Review[];
  onMarkAsRemoved: (reviewId: string, reason: string) => Promise<void>;
  onRestore: (reviewId: string) => Promise<void>;
  selectedPlatform?: string;
}

export function ReviewsTable({ reviews, onMarkAsRemoved, onRestore, selectedPlatform }: ReviewsTableProps) {
  const [sortBy, setSortBy] = useState<'date' | 'rating'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [platformFilter, setPlatformFilter] = useState<string>(selectedPlatform || 'all');
  const [showRemoved, setShowRemoved] = useState(false);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);

  // Get unique platforms
  const platforms = Array.from(new Set(reviews.map(r => r.source)));

  // Filter reviews
  let filteredReviews = reviews;
  if (platformFilter !== 'all') {
    filteredReviews = filteredReviews.filter(r => r.source === platformFilter);
  }
  if (!showRemoved) {
    filteredReviews = filteredReviews.filter(r => !r.is_removed);
  }

  // Sort reviews
  const sortedReviews = [...filteredReviews].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'date') {
      const dateA = a.review_date ? new Date(a.review_date).getTime() : 0;
      const dateB = b.review_date ? new Date(b.review_date).getTime() : 0;
      comparison = dateA - dateB;
    } else {
      comparison = (a.rating ?? 0) - (b.rating ?? 0);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const renderStars = (rating: number | null) => {
    const safeRating = rating ?? 0;
    return (
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            className={`w-4 h-4 ${
              i < Math.floor(safeRating)
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-muted text-muted'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All platforms" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platforms.map(platform => (
              <SelectItem key={platform} value={platform}>
                {platform}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'date' | 'rating')}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Sort by Date</SelectItem>
            <SelectItem value="rating">Sort by Rating</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowRemoved(!showRemoved)}
        >
          {showRemoved ? 'Hide' : 'Show'} Removed
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedReviews.map((review) => (
              <TableRow
                key={review.id}
                className={review.is_removed ? 'opacity-50 bg-muted/50' : ''}
              >
                <TableCell className="whitespace-nowrap">
                  {review.review_date ? format(new Date(review.review_date), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell className="max-w-[180px] truncate" title={review.property_name}>
                  {review.property_name || 'Unknown'}
                </TableCell>
                <TableCell>{review.guest_name || 'Unknown'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {renderStars(review.rating)}
                    <span className="text-sm font-medium">
                      {review.rating !== null ? review.rating.toFixed(1) : '—'}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize flex items-center gap-1.5 w-fit">
                    <PlatformIcon platform={review.source || ''} className="w-4 h-4" />
                    {review.source}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-md">
                  <p className={`text-sm line-clamp-2 ${review.is_removed ? 'line-through' : ''}`}>
                    {review.review_text || 'No text provided'}
                  </p>
                  {review.is_removed && review.removed_reason && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Removed: {review.removed_reason}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedReview(review)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {!review.is_removed ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const reason = prompt('Reason for removal:');
                          if (reason) onMarkAsRemoved(review.id, reason);
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRestore(review.id)}
                      >
                        <RotateCcw className="w-4 h-4 text-green-600" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {sortedReviews.length === 0 && (
        <p className="text-center text-muted-foreground py-8">No reviews found</p>
      )}

      {selectedReview && (
        <ReviewManagementDialog
          review={selectedReview}
          open={!!selectedReview}
          onClose={() => setSelectedReview(null)}
          onMarkAsRemoved={onMarkAsRemoved}
          onRestore={onRestore}
        />
      )}
    </div>
  );
}

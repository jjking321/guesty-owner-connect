import { Star, Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DisputeReview {
  id: string;
  listing_id: string;
  guest_name: string | null;
  rating: number | null;
  review_date: string | null;
  review_text: string | null;
  dispute_status: string | null;
  dispute_likelihood_score: number | null;
  dispute_is_high_priority: boolean | null;
  dispute_violation_category: string | null;
  property_name?: string;
}

interface DisputeCardProps {
  review: DisputeReview;
  onClick: () => void;
  isDragging?: boolean;
}

export function DisputeCard({ review, onClick, isDragging }: DisputeCardProps) {
  const getScoreColor = (score: number | null) => {
    if (score === null) return 'bg-muted text-muted-foreground';
    if (score >= 70) return 'bg-green-500/20 text-green-700 dark:text-green-400';
    if (score >= 30) return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
    return 'bg-red-500/20 text-red-700 dark:text-red-400';
  };

  const getRatingColor = (rating: number | null) => {
    if (rating === null) return 'text-muted-foreground';
    if (rating <= 1) return 'text-red-500';
    if (rating <= 2) return 'text-orange-500';
    return 'text-yellow-500';
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown date';
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('reviewId', review.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        "p-3 rounded-lg border bg-card cursor-pointer transition-all hover:shadow-md",
        review.dispute_is_high_priority && "border-l-4 border-l-orange-500",
        isDragging && "opacity-50 scale-95"
      )}
    >
      {/* Property Name */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium truncate flex-1 mr-2">
          {review.property_name || 'Unknown Property'}
        </span>
        {review.dispute_is_high_priority && (
          <Flame className="h-4 w-4 text-orange-500 flex-shrink-0" />
        )}
      </div>

      {/* Rating */}
      <div className="flex items-center gap-1 mb-2">
        <Star className={cn("h-4 w-4 fill-current", getRatingColor(review.rating))} />
        <span className={cn("text-sm font-medium", getRatingColor(review.rating))}>
          {review.rating ?? '?'}/5
        </span>
      </div>

      {/* Guest & Date */}
      <div className="text-xs text-muted-foreground mb-2">
        <div className="truncate">{review.guest_name || 'Unknown Guest'}</div>
        <div>{formatDate(review.review_date)}</div>
      </div>

      {/* Likelihood Score */}
      {review.dispute_likelihood_score !== null && (
        <Badge 
          variant="secondary" 
          className={cn("text-xs", getScoreColor(review.dispute_likelihood_score))}
        >
          {review.dispute_likelihood_score}% likelihood
        </Badge>
      )}

      {/* Violation Category */}
      {review.dispute_violation_category && review.dispute_violation_category !== 'None' && (
        <Badge variant="outline" className="text-xs ml-1">
          {review.dispute_violation_category}
        </Badge>
      )}
    </div>
  );
}

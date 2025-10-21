import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

interface Review {
  id: string;
  guest_name: string;
  rating: number;
  review_text?: string;
  response_text?: string;
  review_date: string;
  source: string;
  is_removed: boolean;
  removed_reason?: string;
  category_ratings?: Record<string, number>;
}

interface ReviewManagementDialogProps {
  review: Review;
  open: boolean;
  onClose: () => void;
  onMarkAsRemoved: (reviewId: string, reason: string) => Promise<void>;
  onRestore: (reviewId: string) => Promise<void>;
}

export function ReviewManagementDialog({
  review,
  open,
  onClose,
  onMarkAsRemoved,
  onRestore,
}: ReviewManagementDialogProps) {
  const [removalReason, setRemovalReason] = useState(review.removed_reason || '');
  const [isLoading, setIsLoading] = useState(false);

  const handleMarkAsRemoved = async () => {
    if (!removalReason.trim()) {
      alert('Please provide a reason for removal');
      return;
    }
    setIsLoading(true);
    try {
      await onMarkAsRemoved(review.id, removalReason);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async () => {
    setIsLoading(true);
    try {
      await onRestore(review.id);
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            className={`w-5 h-5 ${
              i < Math.floor(rating)
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-muted text-muted'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Review Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-lg">{review.guest_name}</p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(review.review_date), 'MMMM d, yyyy')}
              </p>
            </div>
            <Badge variant="outline" className="capitalize">
              {review.source}
            </Badge>
          </div>

          {/* Overall Rating */}
          <div>
            <p className="text-sm font-medium mb-2">Overall Rating</p>
            <div className="flex items-center gap-3">
              {renderStars(review.rating)}
              <span className="text-2xl font-bold">{review.rating.toFixed(1)}</span>
            </div>
          </div>

          {/* Category Ratings */}
          {review.category_ratings && Object.keys(review.category_ratings).length > 0 && (
            <div>
              <p className="text-sm font-medium mb-3">Category Ratings</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(review.category_ratings).map(([category, rating]) => (
                  <div key={category} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm capitalize">{category.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-2">
                      {renderStars(rating)}
                      <span className="text-sm font-semibold">{rating.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review Text */}
          <div>
            <p className="text-sm font-medium mb-2">Review</p>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm whitespace-pre-wrap">
                {review.review_text || 'No text provided'}
              </p>
            </div>
          </div>

          {/* Host Response */}
          {review.response_text && (
            <div>
              <p className="text-sm font-medium mb-2">Host Response</p>
              <div className="p-4 bg-accent/10 rounded-lg border border-accent">
                <p className="text-sm whitespace-pre-wrap">{review.response_text}</p>
              </div>
            </div>
          )}

          {/* Removal Status */}
          {review.is_removed ? (
            <div className="p-4 bg-destructive/10 border border-destructive rounded-lg">
              <p className="text-sm font-medium text-destructive mb-2">This review is marked as removed</p>
              {review.removed_reason && (
                <p className="text-sm">Reason: {review.removed_reason}</p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium mb-2">Mark as Removed</p>
              <Textarea
                placeholder="Enter reason for removal..."
                value={removalReason}
                onChange={(e) => setRemovalReason(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {review.is_removed ? (
            <Button onClick={handleRestore} disabled={isLoading}>
              Restore Review
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={handleMarkAsRemoved}
              disabled={isLoading || !removalReason.trim()}
            >
              Mark as Removed
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

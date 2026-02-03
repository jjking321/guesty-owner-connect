import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";
import { PlatformIcon } from "@/components/icons/PlatformIcon";

interface Review {
  id?: string;
  rating: number | null;
  source: string | null;
  is_removed: boolean;
  category_ratings?: Record<string, number> | null;
}

interface PlatformStats {
  source: string;
  averageRating: number;
  count: number;
  percentage: number;
}

interface ReviewsSummaryProps {
  reviews: Review[];
  onPlatformClick?: (platform: string) => void;
}

export function ReviewsSummary({ reviews, onPlatformClick }: ReviewsSummaryProps) {
  // Filter out removed reviews
  const activeReviews = reviews.filter(r => !r.is_removed);
  
  if (activeReviews.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-center">No reviews yet</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate overall stats
  const totalRating = activeReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
  const averageRating = totalRating / activeReviews.length;
  const totalCount = activeReviews.length;

  // Calculate rating distribution
  const distribution = [5, 4, 3, 2, 1].map(stars => ({
    stars,
    count: activeReviews.filter(r => Math.round(r.rating) === stars).length,
  }));

  // Calculate platform breakdown
  const platformMap = new Map<string, { total: number; sum: number }>();
  activeReviews.forEach(review => {
    const source = review.source || 'unknown';
    const existing = platformMap.get(source) || { total: 0, sum: 0 };
    platformMap.set(source, {
      total: existing.total + 1,
      sum: existing.sum + (review.rating || 0),
    });
  });

  const platformStats: PlatformStats[] = Array.from(platformMap.entries())
    .map(([source, data]) => ({
      source,
      averageRating: data.sum / data.total,
      count: data.total,
      percentage: (data.total / totalCount) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Calculate category averages
  const categoryMap = new Map<string, { total: number; sum: number }>();
  activeReviews.forEach(review => {
    if (review.category_ratings) {
      Object.entries(review.category_ratings).forEach(([category, rating]) => {
        const existing = categoryMap.get(category) || { total: 0, sum: 0 };
        categoryMap.set(category, {
          total: existing.total + 1,
          sum: existing.sum + rating,
        });
      });
    }
  });

  const categoryAverages = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      average: data.sum / data.total,
    }))
    .sort((a, b) => b.average - a.average);

  const renderStars = (rating: number, size: 'sm' | 'lg' = 'sm') => {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const starSize = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';

    return (
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            className={`${starSize} ${
              i < fullStars
                ? 'fill-yellow-400 text-yellow-400'
                : i === fullStars && hasHalfStar
                ? 'fill-yellow-400/50 text-yellow-400'
                : 'fill-muted text-muted'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Overall Rating */}
      <Card>
        <CardHeader>
          <CardTitle>Overall Rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {renderStars(averageRating, 'lg')}
            <div>
              <p className="text-3xl font-bold">{averageRating.toFixed(1)}</p>
              <p className="text-sm text-muted-foreground">{totalCount} reviews</p>
            </div>
          </div>

          {/* Rating Distribution */}
          <div className="space-y-2">
            {distribution.map(({ stars, count }) => (
              <div key={stars} className="flex items-center gap-2">
                <span className="text-sm w-8">{stars}★</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400"
                    style={{ width: `${(count / totalCount) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground w-12 text-right">{count}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Platform Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>By Platform</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {platformStats.map((platform) => (
            <div
              key={platform.source}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
              onClick={() => onPlatformClick?.(platform.source)}
            >
              <div className="flex items-center gap-3 flex-1">
                <PlatformIcon platform={platform.source} className="w-8 h-8" />
                <div className="flex-1">
                  <p className="font-medium capitalize">{platform.source}</p>
                  <div className="flex items-center gap-2">
                    {renderStars(platform.averageRating)}
                    <span className="text-sm font-semibold">{platform.averageRating.toFixed(1)}</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{platform.count} reviews</p>
                <p className="text-xs text-muted-foreground">{platform.percentage.toFixed(0)}%</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Category Ratings */}
      {categoryAverages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Category Ratings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {categoryAverages.map(({ category, average }) => (
              <div key={category} className="flex items-center justify-between">
                <span className="text-sm capitalize">{category.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  {renderStars(average)}
                  <span className="text-sm font-semibold w-8">{average.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";
import { PlatformIcon } from "@/components/icons/PlatformIcon";

interface PlatformStat {
  source: string;
  count: number;
  avg_rating: number;
}

interface ReviewSummaryStats {
  total_reviews: number;
  avg_rating: number;
  rating_1_count: number;
  rating_2_count: number;
  rating_3_count: number;
  rating_4_count: number;
  rating_5_count: number;
  platform_stats: PlatformStat[];
  category_averages: Record<string, number>;
}

interface ReviewsSummaryAggregatedProps {
  stats: ReviewSummaryStats | null;
}

export function ReviewsSummaryAggregated({ stats }: ReviewsSummaryAggregatedProps) {
  if (!stats || stats.total_reviews === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-center">No reviews found for this period</p>
        </CardContent>
      </Card>
    );
  }

  const distribution = [
    { stars: 5, count: stats.rating_5_count },
    { stars: 4, count: stats.rating_4_count },
    { stars: 3, count: stats.rating_3_count },
    { stars: 2, count: stats.rating_2_count },
    { stars: 1, count: stats.rating_1_count },
  ];

  const platformStats = (stats.platform_stats || []).sort((a, b) => b.count - a.count);
  const categoryAverages = Object.entries(stats.category_averages || {})
    .map(([category, average]) => ({ category, average }))
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
            {renderStars(stats.avg_rating, 'lg')}
            <div>
              <p className="text-3xl font-bold">{stats.avg_rating?.toFixed(1) || '0.0'}</p>
              <p className="text-sm text-muted-foreground">{stats.total_reviews.toLocaleString()} reviews</p>
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
                    style={{ width: `${(count / stats.total_reviews) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground w-12 text-right">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Platform Breakdown */}
      {platformStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By Platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {platformStats.map((platform) => (
              <div
                key={platform.source}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div className="flex items-center gap-3 flex-1">
                  <PlatformIcon platform={platform.source} className="w-8 h-8" />
                  <div className="flex-1">
                    <p className="font-medium capitalize">{platform.source}</p>
                    <div className="flex items-center gap-2">
                      {renderStars(platform.avg_rating)}
                      <span className="text-sm font-semibold">{platform.avg_rating?.toFixed(1) || '0.0'}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{platform.count.toLocaleString()} reviews</p>
                  <p className="text-xs text-muted-foreground">
                    {((platform.count / stats.total_reviews) * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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

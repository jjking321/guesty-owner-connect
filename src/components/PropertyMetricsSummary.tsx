import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, Target, AlertCircle, CheckCircle2 } from "lucide-react";

interface PropertyMetricsSummaryProps {
  totalActualRevenue: number;
  totalProjection: number;
  totalForecast: number;
  propertiesCount: number;
  onTrackCount: number;
  atRiskCount: number;
  behindCount: number;
}

export function PropertyMetricsSummary({
  totalActualRevenue,
  totalProjection,
  totalForecast,
  propertiesCount,
  onTrackCount,
  atRiskCount,
  behindCount,
}: PropertyMetricsSummaryProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const goalAchievement = totalProjection > 0 ? (totalForecast / totalProjection) * 100 : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Revenue YTD</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalActualRevenue)}</div>
          <p className="text-xs text-muted-foreground">
            Across {propertiesCount} properties
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Forecasted Year-End</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalForecast)}</div>
          <p className="text-xs text-muted-foreground">
            {goalAchievement.toFixed(1)}% of projection
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Annual Projection</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalProjection)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            Target for the year
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Properties Status</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-green-600 dark:text-green-400">On Track</span>
              <span className="font-medium">{onTrackCount}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-yellow-600 dark:text-yellow-400">At Risk</span>
              <span className="font-medium">{atRiskCount}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-red-600 dark:text-red-400">Behind</span>
              <span className="font-medium">{behindCount}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

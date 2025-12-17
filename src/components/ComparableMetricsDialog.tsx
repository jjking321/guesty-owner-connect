import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Star, Building } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { format, parse } from "date-fns";

interface HistoricalMetricsData {
  results?: Array<{
    date: string;
    occupancy: number;
    average_daily_rate: number;
    rev_par: number;
    revenue: number;
  }>;
}

interface Comparable {
  id: string;
  listing_name: string | null;
  cover_photo_url: string | null;
  superhost: boolean;
  location_info: {
    locality?: string;
    region?: string;
  } | null;
  ratings: {
    rating_overall?: number;
    num_reviews?: number;
  } | null;
  historical_metrics: HistoricalMetricsData | null;
  metrics_fetched_at: string | null;
}

interface ComparableMetricsDialogProps {
  comparable: Comparable | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const METRIC_OPTIONS = [
  { key: 'revenue', label: 'Revenue', color: 'hsl(142, 76%, 36%)', yAxisId: 'revenue' },
  { key: 'average_daily_rate', label: 'ADR', color: 'hsl(217, 91%, 60%)', yAxisId: 'adr' },
  { key: 'occupancy', label: 'Occupancy', color: 'hsl(38, 92%, 50%)', yAxisId: 'occupancy' },
  { key: 'rev_par', label: 'RevPAR', color: 'hsl(262, 83%, 58%)', yAxisId: 'adr' },
];

export function ComparableMetricsDialog({
  comparable,
  open,
  onOpenChange,
}: ComparableMetricsDialogProps) {
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(['revenue']));

  const chartData = useMemo(() => {
    if (!comparable?.historical_metrics?.results) return [];
    
    return comparable.historical_metrics.results.map(item => {
      let dateFormatted = item.date;
      try {
        const parsedDate = parse(item.date, 'yyyy-MM', new Date());
        dateFormatted = format(parsedDate, 'MMM yyyy');
      } catch {
        // Keep original if parsing fails
      }
      
      return {
        date: item.date,
        dateFormatted,
        revenue: item.revenue,
        average_daily_rate: item.average_daily_rate,
        occupancy: item.occupancy * 100, // Convert to percentage
        rev_par: item.rev_par,
      };
    });
  }, [comparable?.historical_metrics]);

  const toggleMetric = (metricKey: string) => {
    setSelectedMetrics(prev => {
      const newSet = new Set(prev);
      if (newSet.has(metricKey)) {
        // Don't allow deselecting the last metric
        if (newSet.size > 1) {
          newSet.delete(metricKey);
        }
      } else {
        newSet.add(metricKey);
      }
      return newSet;
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => `${value.toFixed(0)}%`;

  const formatTooltipValue = (value: number, name: string) => {
    if (name === 'Occupancy') {
      return formatPercent(value);
    }
    return formatCurrency(value);
  };

  const hasRevenueAxis = selectedMetrics.has('revenue');
  const hasAdrAxis = selectedMetrics.has('average_daily_rate') || selectedMetrics.has('rev_par');
  const hasOccupancyAxis = selectedMetrics.has('occupancy');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-4">
            {comparable?.cover_photo_url && (
              <img
                src={comparable.cover_photo_url}
                alt={comparable.listing_name || 'Property'}
                className="w-16 h-16 object-cover rounded-md flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <DialogTitle className="truncate">
                {comparable?.listing_name || 'Property Metrics'}
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <span>
                  {comparable?.location_info?.locality || comparable?.location_info?.region || 'Unknown location'}
                </span>
                {comparable?.superhost && (
                  <Badge variant="secondary" className="text-xs">
                    Superhost
                  </Badge>
                )}
                {comparable?.ratings?.rating_overall && (
                  <div className="flex items-center gap-1">
                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    <span>{comparable.ratings.rating_overall.toFixed(2)}</span>
                    {comparable.ratings.num_reviews && (
                      <span className="text-muted-foreground">
                        ({comparable.ratings.num_reviews})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Metric Toggles */}
        <div className="border-y py-3 my-4">
          <Label className="text-sm text-muted-foreground mb-2 block">Show metrics:</Label>
          <div className="flex flex-wrap gap-4">
            {METRIC_OPTIONS.map((metric) => (
              <div key={metric.key} className="flex items-center gap-2">
                <Checkbox
                  id={`metric-${metric.key}`}
                  checked={selectedMetrics.has(metric.key)}
                  onCheckedChange={() => toggleMetric(metric.key)}
                />
                <Label 
                  htmlFor={`metric-${metric.key}`} 
                  className="text-sm cursor-pointer flex items-center gap-2"
                >
                  <span 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: metric.color }}
                  />
                  {metric.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Chart */}
        {chartData.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Building className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No historical metrics data available.</p>
            <p className="text-sm mt-2">
              Click "Fetch Metrics" to retrieve historical performance data.
            </p>
          </div>
        ) : (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: hasOccupancyAxis ? 60 : 30, left: hasAdrAxis ? 60 : 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="dateFormatted" 
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                  className="fill-muted-foreground"
                />
                {hasRevenueAxis && (
                  <YAxis
                    yAxisId="revenue"
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                    label={{ value: 'Revenue', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: 'hsl(142, 76%, 36%)' } }}
                  />
                )}
                {hasAdrAxis && (
                  <YAxis
                    yAxisId="adr"
                    orientation={hasRevenueAxis ? 'left' : 'left'}
                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                    label={{ value: 'ADR / RevPAR', angle: -90, position: hasRevenueAxis ? 'insideLeft' : 'insideLeft', dx: hasRevenueAxis ? -40 : 0, style: { textAnchor: 'middle', fill: 'hsl(217, 91%, 60%)' } }}
                  />
                )}
                {hasOccupancyAxis && (
                  <YAxis
                    yAxisId="occupancy"
                    orientation="right"
                    tickFormatter={(value) => `${value}%`}
                    domain={[0, 100]}
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                    label={{ value: 'Occupancy', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: 'hsl(38, 92%, 50%)' } }}
                  />
                )}
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatTooltipValue(value, name),
                    name,
                  ]}
                  labelFormatter={(label) => label}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '0.5rem',
                  }}
                />
                <Legend />
                {METRIC_OPTIONS.map((metric) =>
                  selectedMetrics.has(metric.key) ? (
                    <Line
                      key={metric.key}
                      type="monotone"
                      dataKey={metric.key}
                      name={metric.label}
                      stroke={metric.color}
                      yAxisId={metric.yAxisId}
                      dot={false}
                      strokeWidth={2}
                    />
                  ) : null
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Footer with fetch timestamp */}
        {comparable?.metrics_fetched_at && (
          <div className="text-xs text-muted-foreground pt-2 border-t mt-4">
            Metrics fetched: {format(new Date(comparable.metrics_fetched_at), 'MMM d, yyyy \'at\' h:mm a')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

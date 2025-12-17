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
import { Calendar } from "@/components/ui/calendar";
import { Star, Building, TrendingUp, TrendingDown, Minus, CalendarDays } from "lucide-react";
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
import { format, parse, parseISO, isSameDay, startOfMonth, addMonths } from "date-fns";

interface HistoricalMetricsData {
  results?: Array<{
    date: string;
    occupancy: number;
    average_daily_rate: number;
    rev_par: number;
    revenue: number;
  }>;
}

interface FutureRateData {
  date: string;
  available: boolean;
  rate: number;
}

interface FutureRatesData {
  rates?: FutureRateData[];
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
  // TTM rollups
  ttm_revenue?: number | null;
  ttm_adr?: number | null;
  ttm_occupancy?: number | null;
  ttm_revpar?: number | null;
  prior_ttm_revenue?: number | null;
  prior_ttm_adr?: number | null;
  prior_ttm_occupancy?: number | null;
  prior_ttm_revpar?: number | null;
  rollups_calculated_at?: string | null;
  // Future rates
  future_rates?: FutureRatesData | null;
  future_rates_fetched_at?: string | null;
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

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  const formatTooltipValue = (value: number, name: string) => {
    if (name === 'Occupancy') {
      return formatPercent(value);
    }
    return formatCurrency(value);
  };

  const hasRevenueAxis = selectedMetrics.has('revenue');
  const hasAdrAxis = selectedMetrics.has('average_daily_rate') || selectedMetrics.has('rev_par');
  const hasOccupancyAxis = selectedMetrics.has('occupancy');

  // Calculate YoY change percentage
  const calculateYoY = (current: number | null | undefined, prior: number | null | undefined): number | null => {
    if (current == null || prior == null || prior === 0) return null;
    return ((current - prior) / prior) * 100;
  };

  // TTM metrics summary data
  const ttmSummary = useMemo(() => {
    if (!comparable) return null;
    
    const hasTtmData = comparable.ttm_revenue != null || comparable.ttm_adr != null || 
                       comparable.ttm_occupancy != null || comparable.ttm_revpar != null;
    
    if (!hasTtmData) return null;

    return {
      revenue: {
        ttm: comparable.ttm_revenue,
        prior: comparable.prior_ttm_revenue,
        yoy: calculateYoY(comparable.ttm_revenue, comparable.prior_ttm_revenue),
      },
      adr: {
        ttm: comparable.ttm_adr,
        prior: comparable.prior_ttm_adr,
        yoy: calculateYoY(comparable.ttm_adr, comparable.prior_ttm_adr),
      },
      occupancy: {
        ttm: comparable.ttm_occupancy != null ? comparable.ttm_occupancy * 100 : null, // Convert to percentage
        prior: comparable.prior_ttm_occupancy != null ? comparable.prior_ttm_occupancy * 100 : null,
        yoy: calculateYoY(comparable.ttm_occupancy, comparable.prior_ttm_occupancy),
      },
      revpar: {
        ttm: comparable.ttm_revpar,
        prior: comparable.prior_ttm_revpar,
        yoy: calculateYoY(comparable.ttm_revpar, comparable.prior_ttm_revpar),
      },
    };
  }, [comparable]);

  // Get TTM window description
  const getTtmWindowLabel = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // TTM ends at last complete month
    const endMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const endYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    
    // TTM starts 12 months before end
    const startMonth = endMonth;
    const startYear = endYear - 1;
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[startMonth]} ${startYear} - ${monthNames[endMonth]} ${endYear}`;
  };

  const YoYIndicator = ({ value }: { value: number | null }) => {
    if (value == null) return <span className="text-muted-foreground">—</span>;
    
    const isPositive = value > 0;
    const isNeutral = Math.abs(value) < 0.5;
    
    if (isNeutral) {
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Minus className="h-3 w-3" />
          {formatPercent(Math.abs(value))}
        </span>
      );
    }
    
    return (
      <span className={`flex items-center gap-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {isPositive ? '+' : ''}{formatPercent(value)}
      </span>
    );
  };

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

        {/* TTM Summary Section */}
        {ttmSummary && (
          <div className="bg-muted/50 rounded-lg p-4 my-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">TTM Performance ({getTtmWindowLabel()})</h4>
              <span className="text-xs text-muted-foreground">vs. Prior 12 Months</span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Revenue</div>
                <div className="text-lg font-semibold">
                  {ttmSummary.revenue.ttm != null ? formatCurrency(ttmSummary.revenue.ttm) : '—'}
                </div>
                <div className="text-xs">
                  <YoYIndicator value={ttmSummary.revenue.yoy} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">ADR</div>
                <div className="text-lg font-semibold">
                  {ttmSummary.adr.ttm != null ? formatCurrency(ttmSummary.adr.ttm) : '—'}
                </div>
                <div className="text-xs">
                  <YoYIndicator value={ttmSummary.adr.yoy} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Occupancy</div>
                <div className="text-lg font-semibold">
                  {ttmSummary.occupancy.ttm != null ? formatPercent(ttmSummary.occupancy.ttm) : '—'}
                </div>
                <div className="text-xs">
                  <YoYIndicator value={ttmSummary.occupancy.yoy} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">RevPAR</div>
                <div className="text-lg font-semibold">
                  {ttmSummary.revpar.ttm != null ? formatCurrency(ttmSummary.revpar.ttm) : '—'}
                </div>
                <div className="text-xs">
                  <YoYIndicator value={ttmSummary.revpar.yoy} />
                </div>
              </div>
            </div>
          </div>
        )}

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

        {/* Future Rates Calendar Section */}
        <FutureRatesCalendar 
          futureRates={comparable?.future_rates}
          futureRatesFetchedAt={comparable?.future_rates_fetched_at}
          formatCurrency={formatCurrency}
        />

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

interface FutureRatesCalendarProps {
  futureRates?: FutureRatesData | null;
  futureRatesFetchedAt?: string | null;
  formatCurrency: (value: number) => string;
}

function FutureRatesCalendar({ futureRates, futureRatesFetchedAt, formatCurrency }: FutureRatesCalendarProps) {
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  
  // Build a map of date -> rate data for quick lookup
  const ratesMap = useMemo(() => {
    const map = new Map<string, FutureRateData>();
    if (futureRates?.rates) {
      for (const rate of futureRates.rates) {
        map.set(rate.date, rate);
      }
    }
    return map;
  }, [futureRates]);

  // Get rate statistics for legend
  const rateStats = useMemo(() => {
    if (!futureRates?.rates || futureRates.rates.length === 0) return null;
    
    const rates = futureRates.rates.filter(r => r.rate > 0).map(r => r.rate);
    if (rates.length === 0) return null;
    
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const blockedDays = futureRates.rates.filter(r => !r.available).length;
    const totalDays = futureRates.rates.length;
    const occupancy = totalDays > 0 ? (blockedDays / totalDays) * 100 : 0;
    
    return { minRate, maxRate, avgRate, blockedDays, totalDays, occupancy };
  }, [futureRates]);

  // Monthly aggregated data for chart
  const monthlyChartData = useMemo(() => {
    if (!futureRates?.rates || futureRates.rates.length === 0) return [];
    
    const monthGroups = new Map<string, { rates: number[], blockedDays: number, totalDays: number }>();
    
    for (const rate of futureRates.rates) {
      const monthKey = format(parseISO(rate.date), 'yyyy-MM');
      const existing = monthGroups.get(monthKey) || { rates: [], blockedDays: 0, totalDays: 0 };
      
      if (rate.rate > 0) existing.rates.push(rate.rate);
      if (!rate.available) existing.blockedDays++;
      existing.totalDays++;
      
      monthGroups.set(monthKey, existing);
    }
    
    return Array.from(monthGroups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        monthFormatted: format(parse(month, 'yyyy-MM', new Date()), 'MMM yyyy'),
        avgRate: data.rates.length > 0 ? Math.round(data.rates.reduce((a, b) => a + b, 0) / data.rates.length) : 0,
        occupancy: Math.round((data.blockedDays / data.totalDays) * 100),
      }));
  }, [futureRates]);

  // Get color based on rate relative to min/max
  const getRateColor = (rate: number, available: boolean) => {
    if (!available) return 'bg-muted text-muted-foreground line-through';
    if (!rateStats) return 'bg-primary/10';
    
    const { minRate, maxRate } = rateStats;
    const range = maxRate - minRate;
    if (range === 0) return 'bg-blue-100 dark:bg-blue-900/30';
    
    const normalized = (rate - minRate) / range;
    
    if (normalized < 0.33) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    if (normalized < 0.66) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400';
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  };

  if (!futureRates?.rates || futureRates.rates.length === 0) {
    return (
      <div className="border-t pt-4 mt-4">
        <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
          <CalendarDays className="h-4 w-4" />
          Future Rates Calendar
        </h4>
        <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg">
          <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>No future rates data available.</p>
          <p className="text-sm mt-2">
            Click "Fetch Future Rates" to retrieve upcoming pricing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t pt-4 mt-4">
      <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
        <CalendarDays className="h-4 w-4" />
        Future Rates Calendar
      </h4>
      
      {/* Rate Statistics Summary */}
      {rateStats && (
        <div className="grid grid-cols-4 gap-3 mb-4 text-sm">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground">Min Rate</div>
            <div className="font-semibold text-green-600">{formatCurrency(rateStats.minRate)}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground">Avg Rate</div>
            <div className="font-semibold">{formatCurrency(rateStats.avgRate)}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground">Max Rate</div>
            <div className="font-semibold text-red-600">{formatCurrency(rateStats.maxRate)}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground">Occupancy</div>
            <div className="font-semibold">{rateStats.occupancy.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {/* Monthly Rates & Occupancy Chart */}
      {monthlyChartData.length > 0 && (
        <div className="mb-4">
          <h5 className="text-xs font-medium text-muted-foreground mb-2">Monthly Avg Rate & Occupancy</h5>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="monthFormatted" 
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                />
                <YAxis 
                  yAxisId="rate"
                  orientation="left"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => `$${value}`}
                  tickLine={false}
                />
                <YAxis 
                  yAxisId="occupancy"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => `${value}%`}
                  domain={[0, 100]}
                  tickLine={false}
                />
                <Tooltip 
                  formatter={(value: number, name: string) => {
                    if (name === 'Avg Rate') return [`$${value}`, 'Avg Rate'];
                    return [`${value}%`, 'Occupancy'];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line 
                  yAxisId="rate"
                  type="monotone" 
                  dataKey="avgRate"
                  name="Avg Rate"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line 
                  yAxisId="occupancy"
                  type="monotone" 
                  dataKey="occupancy"
                  name="Occupancy"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Calendar with rates */}
      <div className="flex justify-center">
        <Calendar
          mode="single"
          month={calendarMonth}
          onMonthChange={setCalendarMonth}
          className="rounded-md border pointer-events-auto"
          components={{
            Day: ({ date, ...props }) => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const rateData = ratesMap.get(dateStr);
              
              if (!rateData) {
                return (
                  <div className="h-12 w-12 p-1 text-center text-muted-foreground/50">
                    <div className="text-xs">{format(date, 'd')}</div>
                  </div>
                );
              }
              
              const colorClass = getRateColor(rateData.rate, rateData.available);
              
              return (
                <div 
                  className={`h-12 w-12 p-1 text-center rounded-md ${colorClass} cursor-default`}
                  title={`${format(date, 'MMM d')}: ${formatCurrency(rateData.rate)} ${rateData.available ? '(available)' : '(blocked)'}`}
                >
                  <div className="text-xs font-medium">{format(date, 'd')}</div>
                  <div className="text-[10px] truncate">
                    {rateData.rate > 0 ? `$${Math.round(rateData.rate)}` : '—'}
                  </div>
                </div>
              );
            },
          }}
        />
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/30" />
          <span>Low rate</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-yellow-100 dark:bg-yellow-900/30" />
          <span>Mid rate</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30" />
          <span>High rate</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-muted" />
          <span>Blocked</span>
        </div>
      </div>

      {/* Fetch timestamp */}
      {futureRatesFetchedAt && (
        <div className="text-xs text-muted-foreground text-center mt-3">
          Rates fetched: {format(new Date(futureRatesFetchedAt), 'MMM d, yyyy \'at\' h:mm a')}
        </div>
      )}
    </div>
  );
}

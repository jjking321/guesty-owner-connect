import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, AlertCircle, CheckCircle, Clock, DollarSign, RefreshCw, BarChart3, Target } from "lucide-react";
import { parseLocalDate } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface ForecastData {
  listingId: string;
  year: number;
  generated_at?: string;
  forecastMethod?: string;
  paceFactor?: number;
  capacityUtilization?: number;
  dbaBreakdown?: any;
  revenueOnBooks: number;
  forecastedRevenue: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  totalForecast: {
    p50: number;
    p10?: number; p25?: number; p75?: number; p90?: number;
    confidence?: { lower: number; upper: number };
  };
  goalTargets: {
    projection: number;
  };
  goalProbabilities: {
    projection: number;
  };
  monthlyForecasts: Array<{
    month: string;
    revenue_on_books: number;
    additional_forecast: number;
    total_forecast_p50: number;
    velocity_factor?: number;
    velocity_forecast?: number;
    probability_forecast?: number;
    blended_forecast?: number;
    open_nights?: number;
    avg_open_probability?: number;
    forecast_confidence?: string;
    compset_demand?: string;
  }>;
  insights: {
    drivers: string[];
    risks: string[];
    opportunities: string[];
  };
  // New enhanced fields
  probabilityWeightedRevenue?: number;
  avgOpenNightProbability?: number;
  compsetDemandIndex?: number;
  forecastConfidence?: string;
}

interface RevenueForecastProps {
  listingId: string;
}

export function RevenueForecast({ listingId }: RevenueForecastProps) {
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actualRevenue, setActualRevenue] = useState<{
    yearTotal: number;
    monthlyActuals: Record<string, number>;
    monthlyOnBooks: Record<string, number>;
  }>({ yearTotal: 0, monthlyActuals: {}, monthlyOnBooks: {} });
  
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;
  const nextYear = currentYear + 1;
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const { toast } = useToast();

  useEffect(() => {
    loadForecast();
    loadActualRevenue();
  }, [listingId, selectedYear]);

  const loadActualRevenue = async () => {
    try {
      // Fetch reservations that have any nights in the selected year
      // This includes cross-year reservations (e.g., check_in Dec 2025, check_out Jan 2026)
      const { data, error } = await supabase
        .from("reservations")
        .select("check_in, check_out, fare_accommodation_adjusted, nights_count")
        .eq("listing_id", listingId)
        .in("status", ["confirmed", "checked_in", "checked_out"])
        .lt("check_in", `${selectedYear + 1}-01-01`)
        .gt("check_out", `${selectedYear}-01-01`);

      if (error) throw error;

      const monthlyActuals: Record<string, number> = {};
      const monthlyOnBooks: Record<string, number> = {};
      let yearTotal = 0;

      if (data) {
        // Separate past nights (Actual) from future nights (On Books)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        data.forEach((row) => {
          if (row.check_in && row.check_out && row.fare_accommodation_adjusted) {
            const totalRevenue = parseFloat(row.fare_accommodation_adjusted.toString());
            const nightsCount = row.nights_count || 0;
            const revenuePerNight = nightsCount > 0 ? totalRevenue / nightsCount : 0;
            
            let currentNight = parseLocalDate(row.check_in)!;
            const checkOut = parseLocalDate(row.check_out)!;
            
            while (currentNight < checkOut) {
              const monthKey = currentNight.toISOString().substring(0, 7);
              const year = currentNight.getFullYear();
              
              if (year === selectedYear) {
                if (currentNight < today) {
                  // Past night - Actual revenue
                  monthlyActuals[monthKey] = (monthlyActuals[monthKey] || 0) + revenuePerNight;
                  yearTotal += revenuePerNight;
                } else {
                  // Future night - On Books revenue
                  monthlyOnBooks[monthKey] = (monthlyOnBooks[monthKey] || 0) + revenuePerNight;
                }
              }
              
              currentNight.setDate(currentNight.getDate() + 1);
            }
          }
        });
      }

      setActualRevenue({ yearTotal, monthlyActuals, monthlyOnBooks });
    } catch (err) {
      console.error("Error loading actual revenue:", err);
    }
  };

  const loadForecast = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('revenue_forecasts')
        .select('*')
        .eq('listing_id', listingId)
        .eq('year', selectedYear)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setForecast({
          listingId: data.listing_id,
          year: data.year,
          generated_at: data.generated_at,
          forecastMethod: data.forecast_method,
          paceFactor: data.pace_factor,
          capacityUtilization: data.capacity_utilization,
          dbaBreakdown: data.dba_breakdown,
          revenueOnBooks: Number(data.revenue_on_books),
          forecastedRevenue: data.forecasted_revenue as any,
          totalForecast: data.total_forecast as any,
          goalTargets: data.goal_targets as any,
          goalProbabilities: data.goal_probabilities as any,
          monthlyForecasts: data.monthly_forecasts as any,
          insights: data.insights as any,
          probabilityWeightedRevenue: data.probability_weighted_revenue,
          avgOpenNightProbability: data.avg_open_night_probability,
          compsetDemandIndex: data.compset_demand_index,
          forecastConfidence: data.forecast_confidence
        });
      } else {
        setForecast(null);
      }
    } catch (error) {
      console.error('Error loading forecast:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateForecast = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('forecast-revenue', {
        body: { listingId, year: selectedYear }
      });

      if (error) throw error;

      if (data) {
        setForecast({
          listingId: data.listing_id,
          year: data.year,
          generated_at: data.generated_at,
          forecastMethod: data.forecast_method,
          paceFactor: data.pace_factor,
          capacityUtilization: data.capacity_utilization,
          dbaBreakdown: data.dba_breakdown,
          revenueOnBooks: Number(data.revenue_on_books),
          forecastedRevenue: data.forecasted_revenue as any,
          totalForecast: data.total_forecast as any,
          goalTargets: data.goal_targets as any,
          goalProbabilities: data.goal_probabilities as any,
          monthlyForecasts: data.monthly_forecasts as any,
          insights: data.insights as any,
          probabilityWeightedRevenue: data.probability_weighted_revenue,
          avgOpenNightProbability: data.avg_open_night_probability,
          compsetDemandIndex: data.compset_demand_index,
          forecastConfidence: data.forecast_confidence
        });
      }

      toast({
        title: "Forecast Updated",
        description: `Revenue forecast for ${selectedYear} has been recalculated`,
      });
    } catch (error) {
      console.error('Error generating forecast:', error);
      toast({
        title: "Error",
        description: "Failed to generate forecast. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const ProbabilityGauge = ({ label, probability, target }: { label: string; probability: number; target: number }) => {
    const getColor = (prob: number) => {
      if (prob >= 70) return "text-green-600";
      if (prob >= 40) return "text-yellow-600";
      return "text-red-600";
    };

    return (
      <div className="flex flex-col items-center space-y-2">
        <div className="relative w-24 h-24">
          <svg className="transform -rotate-90 w-24 h-24">
            <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-muted" />
            <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent"
              strokeDasharray={`${2 * Math.PI * 40}`}
              strokeDashoffset={`${2 * Math.PI * 40 * (1 - probability / 100)}`}
              className={getColor(probability)} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold ${getColor(probability)}`}>{probability.toFixed(0)}%</span>
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">${target.toLocaleString()}</p>
        </div>
      </div>
    );
  };

  const getWindowIcon = (status: string) => {
    switch (status) {
      case 'open': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'closing': return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'closed': return <AlertCircle className="h-4 w-4 text-red-600" />;
      default: return null;
    }
  };

  const getConfidenceBadge = (confidence: string | undefined) => {
    switch (confidence) {
      case 'high': return <Badge variant="default" className="bg-green-600">High Confidence</Badge>;
      case 'medium': return <Badge variant="secondary">Medium Confidence</Badge>;
      case 'low': return <Badge variant="outline">Low Confidence</Badge>;
      default: return null;
    }
  };

  const getDemandBadge = (demand: string | null | undefined) => {
    switch (demand) {
      case 'High': return <Badge variant="default" className="bg-green-600 text-xs">High</Badge>;
      case 'Medium': return <Badge variant="secondary" className="text-xs">Med</Badge>;
      case 'Low': return <Badge variant="outline" className="text-xs">Low</Badge>;
      default: return <span className="text-muted-foreground text-xs">-</span>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Revenue Forecast
            </CardTitle>
            <CardDescription>AI-powered year-end revenue projection with probability & compset data</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))}>
              <TabsList>
                <TabsTrigger value={lastYear.toString()}>{lastYear}</TabsTrigger>
                <TabsTrigger value={currentYear.toString()}>{currentYear}</TabsTrigger>
                <TabsTrigger value={nextYear.toString()}>{nextYear}</TabsTrigger>
              </TabsList>
            </Tabs>
            {forecast && (
              <Button onClick={generateForecast} variant="outline" size="sm" disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!forecast && !loading && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No forecast available yet</p>
            <Button onClick={generateForecast} size="lg" disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Generate First Forecast
            </Button>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        )}

        {forecast && !loading && (() => {
          // Replace past-month forecasts with realized actuals so annual totals
          // reflect what's still possible, not overstated history.
          const todayForTotals = new Date();
          const currentMonthStart = new Date(todayForTotals.getFullYear(), todayForTotals.getMonth(), 1);
          let adjP50 = 0, adjP10 = 0, adjP90 = 0;
          for (const mf of forecast.monthlyForecasts || []) {
            const [yStr, mStr] = (mf.month || '').split('-');
            const monthDate = new Date(Number(yStr), Number(mStr) - 1, 1);
            const isPast = monthDate < currentMonthStart;
            const modelP50 = Number(mf.total_forecast_p50 || (mf as any).blended_forecast || 0);
            const modelP10 = Number((mf as any).total_forecast_p10 ?? modelP50);
            const modelP90 = Number((mf as any).total_forecast_p90 ?? modelP50);
            const actual = actualRevenue.monthlyActuals[mf.month] || 0;
            if (isPast) {
              adjP50 += actual; adjP10 += actual; adjP90 += actual;
            } else {
              adjP50 += modelP50; adjP10 += modelP10; adjP90 += modelP90;
            }
          }
          const origP10 = Number((forecast.totalForecast as any)?.p10);
          const origP90 = Number((forecast.totalForecast as any)?.p90);
          const hasBand = !isNaN(origP10) && !isNaN(origP90);
          return (
          <>
            {/* Main Forecast Display */}
            {selectedYear === lastYear ? (
              <div className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 rounded-lg p-6 text-center">
                <div className="flex justify-between items-start mb-4">
                  <p className="text-xs text-muted-foreground">Historical Performance</p>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-2">{selectedYear} Actual Revenue</p>
                <p className="text-4xl font-bold mb-2">${Math.round(actualRevenue.yearTotal).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Completed Year</p>
              </div>
            ) : (
              <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-6 text-center">
                <div className="flex justify-between items-start mb-4">
                  <p className="text-xs text-muted-foreground">
                    Last updated: {forecast.generated_at ? formatDistanceToNow(new Date(forecast.generated_at)) : 'N/A'} ago
                  </p>
                  <div className="flex items-center gap-2">
                    {getConfidenceBadge(forecast.forecastConfidence)}
                  </div>
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Projected End-of-Year Revenue</p>
                <p className="text-4xl font-bold mb-2">
                  ${Math.round(adjP50).toLocaleString('en-US')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {hasBand
                    ? `80% Confidence: $${Math.round(adjP10).toLocaleString()} - $${Math.round(adjP90).toLocaleString()}`
                    : 'Confidence interval not available'}
                </p>

                
                {/* Enhanced Metrics Row */}
                <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="text-center">
                    <p className="text-muted-foreground">On Books</p>
                    <p className="font-semibold">${Number(forecast.revenueOnBooks || 0).toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Avg Pace</p>
                    <p className={`font-semibold ${(forecast.paceFactor || 1) > 1.05 ? 'text-green-600' : (forecast.paceFactor || 1) < 0.95 ? 'text-red-600' : ''}`}>
                      {((forecast.paceFactor || 1) * 100).toFixed(0)}%
                    </p>
                  </div>
                  {forecast.avgOpenNightProbability !== undefined && forecast.avgOpenNightProbability > 0 && (
                    <div className="text-center">
                      <p className="text-muted-foreground flex items-center justify-center gap-1">
                        <Target className="h-3 w-3" /> Avg Probability
                      </p>
                      <p className={`font-semibold ${forecast.avgOpenNightProbability > 50 ? 'text-green-600' : forecast.avgOpenNightProbability < 30 ? 'text-red-600' : 'text-yellow-600'}`}>
                        {forecast.avgOpenNightProbability.toFixed(0)}%
                      </p>
                    </div>
                  )}
                  {forecast.compsetDemandIndex !== undefined && forecast.compsetDemandIndex > 0 && (
                    <div className="text-center">
                      <p className="text-muted-foreground flex items-center justify-center gap-1">
                        <BarChart3 className="h-3 w-3" /> Market Demand
                      </p>
                      <p className={`font-semibold ${forecast.compsetDemandIndex > 60 ? 'text-green-600' : forecast.compsetDemandIndex < 40 ? 'text-red-600' : 'text-yellow-600'}`}>
                        {forecast.compsetDemandIndex.toFixed(0)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Goal Probabilities */}
            <div>
              <h4 className="text-sm font-medium mb-4">Probability of Hitting Goal</h4>
              <div className="flex justify-center">
                <ProbabilityGauge 
                  label="Goal" 
                  probability={forecast.goalProbabilities?.projection || 0} 
                  target={forecast.goalTargets?.projection || 0}
                />
              </div>
            </div>

            {/* Monthly Breakdown */}
            <div>
              <h4 className="text-sm font-medium mb-4">Monthly Forecast Breakdown</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="pb-2">Month</th>
                      <th className="pb-2 text-right">Actual</th>
                      <th className="pb-2 text-right">On Books</th>
                      <th className="pb-2 text-right">Forecast</th>
                      <th className="pb-2 text-center">Pace</th>
                      <th className="pb-2 text-center">Prob %</th>
                      <th className="pb-2 text-center">Demand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.monthlyForecasts.map((m) => {
                      const [yStr, mStr] = (m.month || '').split('-');
                      const y = Number(yStr); const mo = Number(mStr) - 1;
                      const monthDate = isNaN(y) || isNaN(mo) ? new Date() : new Date(y, mo, 1);
                      const monthLabel = monthDate.toLocaleString('en-US', { month: 'short' });
                      const today = new Date();
                      const monthStartThisRender = new Date(today.getFullYear(), today.getMonth(), 1);
                      const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
                      
                      // Determine if this is a past month, current month, or future month
                      const isPastMonth = monthDate < monthStartThisRender;
                      const isCurrentMonth = monthDate >= monthStartThisRender && monthDate < nextMonthStart && y === today.getFullYear();
                      const isFutureMonth = monthDate >= nextMonthStart || y > today.getFullYear();
                      
                      const pace = m.velocity_factor;
                      const actualForMonth = actualRevenue.monthlyActuals[m.month] || 0;
                      const onBooksForMonth = actualRevenue.monthlyOnBooks[m.month] || 0;
                      const avgProb = m.avg_open_probability;
                      
                      return (
                        <tr key={m.month} className="border-b">
                          <td className="py-2 font-medium">{monthLabel}</td>
                          <td className="py-2 text-right">
                            {(isPastMonth || isCurrentMonth) && actualForMonth > 0 
                              ? `$${Math.round(actualForMonth).toLocaleString()}` 
                              : <span className="text-muted-foreground">-</span>}
                          </td>
                          <td className="py-2 text-right">
                            {isCurrentMonth && onBooksForMonth > 0
                              ? `$${Math.round(onBooksForMonth).toLocaleString()}`
                              : isFutureMonth 
                                ? `$${Math.round(Number(m.revenue_on_books || 0)).toLocaleString()}`
                                : <span className="text-muted-foreground">-</span>}
                          </td>
                          <td className="py-2 text-right font-semibold">
                            {`$${Math.round(Number(m.total_forecast_p50 || m.blended_forecast || 0)).toLocaleString()}`}
                          </td>
                          <td className="py-2 text-center">
                            {(isCurrentMonth || isFutureMonth) && pace !== undefined ? (
                              <span className={`text-xs font-medium ${pace > 1.1 ? 'text-green-600' : pace < 0.9 ? 'text-red-600' : 'text-muted-foreground'}`}>
                                {(pace * 100).toFixed(0)}%
                              </span>
                            ) : <span className="text-muted-foreground">-</span>}
                          </td>
                          <td className="py-2 text-center">
                            {(isCurrentMonth || isFutureMonth) && avgProb !== undefined && avgProb > 0 ? (
                              <span className={`text-xs font-medium ${avgProb > 50 ? 'text-green-600' : avgProb < 30 ? 'text-red-600' : 'text-yellow-600'}`}>
                                {avgProb.toFixed(0)}%
                              </span>
                            ) : <span className="text-muted-foreground">-</span>}
                          </td>
                          <td className="py-2 text-center">
                            {(isCurrentMonth || isFutureMonth) ? getDemandBadge(m.compset_demand) : <span className="text-muted-foreground text-xs">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Insights */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Key Insights</h4>
              
              {forecast.insights.drivers?.length > 0 && (
                <div className="flex gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-green-600">Drivers</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {forecast.insights.drivers.map((driver, i) => <li key={i}>{driver}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {forecast.insights.risks?.length > 0 && (
                <div className="flex gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-red-600">Risks</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {forecast.insights.risks.map((risk, i) => <li key={i}>{risk}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {forecast.insights.opportunities?.length > 0 && (
                <div className="flex gap-2 text-sm">
                  <DollarSign className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-600">Opportunities</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {forecast.insights.opportunities.map((opp, i) => <li key={i}>{opp}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Last updated: {forecast.generated_at ? formatDistanceToNow(new Date(forecast.generated_at), { addSuffix: true }) : 'Unknown'}
              </p>
              <p className="text-xs text-muted-foreground">Method: Velocity + Probability Blend</p>
            </div>
          </>
          );
        })()}
      </CardContent>
    </Card>
  );
}

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, AlertCircle, CheckCircle, Clock, DollarSign, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    budget: number;
    projection: number;
    goal: number;
  };
  goalProbabilities: {
    budget: number;
    projection: number;
    goal: number;
  };
  monthlyForecasts: Array<{
    month: string; // YYYY-MM
    revenue_on_books: number;
    additional_forecast: number;
    total_forecast_p50: number;
    velocity_factor?: number;
  }>;
  insights: {
    drivers: string[];
    risks: string[];
    opportunities: string[];
  };
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
  }>({ yearTotal: 0, monthlyActuals: {} });
  
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
      const { data, error } = await supabase
        .from("reservations")
        .select("check_in, fare_accommodation_adjusted")
        .eq("listing_id", listingId)
        .in("status", ["confirmed", "checked_in", "checked_out"])
        .gte("check_in", `${selectedYear}-01-01`)
        .lt("check_in", `${selectedYear + 1}-01-01`);

      if (error) throw error;

      const monthlyActuals: Record<string, number> = {};
      let yearTotal = 0;

      if (data) {
        data.forEach((row) => {
          if (row.check_in && row.fare_accommodation_adjusted) {
            const monthKey = row.check_in.substring(0, 7);
            monthlyActuals[monthKey] = (monthlyActuals[monthKey] || 0) + row.fare_accommodation_adjusted;
            yearTotal += row.fare_accommodation_adjusted;
          }
        });
      }

      setActualRevenue({ yearTotal, monthlyActuals });
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
          insights: data.insights as any
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
          insights: data.insights as any
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
            <circle
              cx="48"
              cy="48"
              r="40"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              className="text-muted"
            />
            <circle
              cx="48"
              cy="48"
              r="40"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              strokeDasharray={`${2 * Math.PI * 40}`}
              strokeDashoffset={`${2 * Math.PI * 40 * (1 - probability / 100)}`}
              className={getColor(probability)}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold ${getColor(probability)}`}>
              {probability.toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            ${target.toLocaleString()}
          </p>
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Revenue Forecast
            </CardTitle>
            <CardDescription>
              AI-powered year-end revenue projection
            </CardDescription>
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
              <Button 
                onClick={generateForecast} 
                variant="outline" 
                size="sm"
                disabled={refreshing}
              >
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

        {forecast && !loading && (
          <>
            {/* Main Forecast Display */}
            {selectedYear === lastYear ? (
              <div className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 rounded-lg p-6 text-center">
                <div className="flex justify-between items-start mb-4">
                  <div className="text-left">
                    <p className="text-xs text-muted-foreground">
                      Historical Performance
                    </p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  {selectedYear} Actual Revenue
                </p>
                <p className="text-4xl font-bold mb-2">
                  ${Math.round(actualRevenue.yearTotal).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">
                  Completed Year
                </p>
              </div>
            ) : (
              <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-6 text-center">
                <div className="flex justify-between items-start mb-4">
                  <div className="text-left">
                    <p className="text-xs text-muted-foreground">
                      Last updated: {forecast.generated_at ? formatDistanceToNow(new Date(forecast.generated_at)) : 'N/A'} ago
                    </p>
                  </div>
                  {forecast.forecastMethod && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        Method: <span className="font-medium capitalize">{forecast.forecastMethod}</span>
                      </p>
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  Projected End-of-Year Revenue
                </p>
                <p className="text-4xl font-bold mb-2">
                  ${Number(forecast.totalForecast?.p50 ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {((forecast.totalForecast as any)?.p10 !== undefined && (forecast.totalForecast as any)?.p90 !== undefined) ? (
                    `80% Confidence: $${Number((forecast.totalForecast as any).p10).toLocaleString()} - $${Number((forecast.totalForecast as any).p90).toLocaleString()}`
                  ) : (
                    'Confidence interval not available'
                  )}
                </p>
                <div className="mt-4 pt-4 border-t">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    {selectedYear === currentYear && (
                      <div className="text-center">
                        <p className="text-muted-foreground">YTD Actuals</p>
                        <p className="font-semibold">
                          ${Math.round(actualRevenue.yearTotal).toLocaleString()}
                        </p>
                      </div>
                    )}
                    <div className="text-center">
                      <p className="text-muted-foreground">On Books (Year)</p>
                      <p className="font-semibold">
                        ${Number(forecast.revenueOnBooks || 0).toLocaleString()}
                      </p>
                    </div>
                    {selectedYear === currentYear ? (
                      <div className="text-center">
                        <p className="text-muted-foreground">Forecasted Add'l</p>
                        <p className="font-semibold">
                          ${Number((forecast.totalForecast?.p50 ?? 0) - (forecast.revenueOnBooks ?? 0)).toLocaleString()}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="text-center">
                          <p className="text-muted-foreground">P10–P90 Range</p>
                          <p className="font-semibold">
                            {((forecast.totalForecast as any)?.p10 !== undefined && (forecast.totalForecast as any)?.p90 !== undefined)
                              ? `$${Number((forecast.totalForecast as any).p10).toLocaleString()} - $${Number((forecast.totalForecast as any).p90).toLocaleString()}`
                              : '—'}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Forecasted Add'l</p>
                          <p className="font-semibold">
                            ${Number((forecast.totalForecast?.p50 ?? 0) - (forecast.revenueOnBooks ?? 0)).toLocaleString()}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Pace-Aware Metrics */}
                {(forecast.paceFactor !== null && forecast.paceFactor !== undefined) || 
                 (forecast.capacityUtilization !== null && forecast.capacityUtilization !== undefined) ? (
                  <div className="mt-4 pt-4 border-t">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {forecast.paceFactor !== null && forecast.paceFactor !== undefined && (
                        <div className="text-center">
                          <p className="text-muted-foreground">Avg Pace Factor</p>
                          <p className="font-semibold">
                            {forecast.paceFactor.toFixed(2)}x
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {forecast.paceFactor > 1.1 ? '↑ Ahead of last year' : 
                             forecast.paceFactor < 0.9 ? '↓ Behind last year' : 
                             '→ On pace'}
                          </p>
                        </div>
                      )}
                      {forecast.capacityUtilization !== null && forecast.capacityUtilization !== undefined && (
                        <div className="text-center">
                          <p className="text-muted-foreground">Capacity Utilization</p>
                          <p className="font-semibold">
                            {forecast.capacityUtilization.toFixed(1)}%
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {forecast.capacityUtilization > 80 ? '⚠️ High utilization' : 
                             forecast.capacityUtilization > 60 ? '✓ Good utilization' : 
                             '○ Room to grow'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Goal Probabilities */}
            <div>
              <h4 className="text-sm font-medium mb-4">Probability of Hitting Targets</h4>
              <div className="grid grid-cols-3 gap-4">
                <ProbabilityGauge 
                  label="Budget" 
                  probability={forecast.goalProbabilities.budget} 
                  target={forecast.goalTargets?.budget || 0}
                />
                <ProbabilityGauge 
                  label="Projection" 
                  probability={forecast.goalProbabilities.projection} 
                  target={forecast.goalTargets?.projection || 0}
                />
                <ProbabilityGauge 
                  label="Goal" 
                  probability={forecast.goalProbabilities.goal} 
                  target={forecast.goalTargets?.goal || 0}
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
                      <th className="pb-2 text-right">Additional</th>
                      <th className="pb-2 text-right">Total</th>
                      <th className="pb-2 text-center">Pace</th>
                      <th className="pb-2 text-center">Window</th>
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
                      const isPast = monthDate < monthStartThisRender && y <= today.getFullYear();
                      const daysUntil = Math.floor((monthDate.getTime() - monthStartThisRender.getTime()) / (1000 * 60 * 60 * 24));
                      const windowStatus = daysUntil < 0 ? 'closed' : daysUntil <= 90 ? 'closing' : 'open';
                      const pace = m.velocity_factor;
                      const actualForMonth = actualRevenue.monthlyActuals[m.month] || 0;
                      
                      return (
                        <tr key={m.month} className="border-b">
                          <td className="py-2 font-medium">{monthLabel}</td>
                          <td className="py-2 text-right">
                            {isPast && actualForMonth > 0 ? (
                              `$${Math.round(actualForMonth).toLocaleString()}`
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {!isPast ? (
                              `$${Math.round(Number(m.revenue_on_books || 0)).toLocaleString()}`
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {!isPast ? (
                              `$${Math.round(Number(m.additional_forecast || 0)).toLocaleString()}`
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2 text-right font-semibold">
                            {isPast && actualForMonth > 0 ? (
                              `$${Math.round(actualForMonth).toLocaleString()}`
                            ) : (
                              `$${Math.round(Number(m.total_forecast_p50 || 0)).toLocaleString()}`
                            )}
                          </td>
                          <td className="py-2 text-center">
                            {!isPast && pace !== undefined ? (
                              <span className={`text-xs font-medium ${pace > 1.1 ? 'text-green-600' : pace < 0.9 ? 'text-red-600' : 'text-muted-foreground'}`}>
                                {(pace * 100).toFixed(0)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2 text-center">
                            {!isPast ? getWindowIcon(windowStatus) : <span className="text-muted-foreground text-xs">Past</span>}
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
                      {forecast.insights.drivers.map((driver, i) => (
                        <li key={i}>{driver}</li>
                      ))}
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
                      {forecast.insights.risks.map((risk, i) => (
                        <li key={i}>{risk}</li>
                      ))}
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
                      {forecast.insights.opportunities.map((opp, i) => (
                        <li key={i}>{opp}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Last updated: {forecast.generated_at ? formatDistanceToNow(new Date(forecast.generated_at), { addSuffix: true }) : 'Unknown'}
              </p>
              <p className="text-xs text-muted-foreground">
                Forecasts regenerate weekly
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

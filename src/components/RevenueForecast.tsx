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
  asOfDate: string;
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
    confidence: { lower: number; upper: number };
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
    month: number;
    monthName: string;
    isPast?: boolean;
    actualRevenue?: number;
    revenueOnBooks: number;
    forecastedAdditional: { p50: number; p10: number; p90: number };
    totalForecast: { p50: number; p10: number; p90: number };
    bookingVelocity: number;
    bookingWindowStatus: string;
  }>;
  insights: {
    keyDrivers: string[];
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
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const { toast } = useToast();

  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  useEffect(() => {
    loadForecast();
  }, [listingId, selectedYear]);

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
          asOfDate: data.generated_at,
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

      setForecast(data);
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
              AI-powered year-end revenue projection using Monte Carlo simulation
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))}>
              <TabsList>
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
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-6 text-center">
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Projected End-of-Year Revenue
              </p>
              <p className="text-4xl font-bold mb-2">
                ${Number(forecast.totalForecast?.p50 ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
              <p className="text-sm text-muted-foreground">
                {forecast.totalForecast.confidence?.lower && forecast.totalForecast.confidence?.upper ? (
                  `80% Confidence: $${forecast.totalForecast.confidence.lower.toLocaleString()} - $${forecast.totalForecast.confidence.upper.toLocaleString()}`
                ) : (
                  'Confidence interval not available'
                )}
              </p>
              <div className="mt-4 pt-4 border-t">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <p className="text-muted-foreground">Past Revenue</p>
                    <p className="font-semibold">
                      ${((forecast.totalForecast as any).pastRevenue || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Future Confirmed</p>
                    <p className="font-semibold">
                      ${((forecast.totalForecast as any).futureConfirmed || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Forecasted Add'l</p>
                    <p className="font-semibold">
                      ${Number((forecast.totalForecast?.p50 ?? 0) - (forecast.revenueOnBooks ?? 0)).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

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
                    {forecast.monthlyForecasts.map((month) => (
                      <tr key={month.month} className="border-b">
                        <td className="py-2 font-medium">{month.monthName}</td>
                        <td className="py-2 text-right">
                          {month.isPast ? (
                            <span className="font-semibold">${(month.actualRevenue || 0).toLocaleString()}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {!month.isPast ? (
                            `$${Number(month.revenueOnBooks ?? 0).toLocaleString()}`
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {!month.isPast ? (
                            `$${Number(month.forecastedAdditional?.p50 ?? 0).toLocaleString()}`
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2 text-right font-semibold">
                          ${Number(month.totalForecast?.p50 ?? 0).toLocaleString()}
                        </td>
                        <td className="py-2 text-center">
                          {!month.isPast ? (
                            <span className={month.bookingVelocity >= 1 ? "text-green-600" : "text-red-600"}>
                              {(month.bookingVelocity * 100).toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2 text-center">
                          {!month.isPast ? getWindowIcon(month.bookingWindowStatus) : <span className="text-muted-foreground">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Insights */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Key Insights</h4>
              
              {forecast.insights.keyDrivers.length > 0 && (
                <div className="flex gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-green-600">Drivers</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {forecast.insights.keyDrivers.map((driver, i) => (
                        <li key={i}>{driver}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {forecast.insights.risks.length > 0 && (
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

              {forecast.insights.opportunities.length > 0 && (
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
                Last updated: {forecast.asOfDate ? formatDistanceToNow(new Date(forecast.asOfDate), { addSuffix: true }) : 'Unknown'}
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

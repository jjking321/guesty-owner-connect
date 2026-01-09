import { useState, useMemo, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, Target, Zap, DollarSign, Clock, AlertTriangle } from "lucide-react";
import {
  ProbabilityData,
  recalculateProbability,
  generateRateSuggestions,
  getProbabilityColor,
  getBookingWindowStatus,
  RateSuggestion,
} from "@/lib/probabilityCalculator";

interface RateSimulatorProps {
  probabilityData: ProbabilityData;
  currency?: string;
  onRateChange?: (newRate: number) => void;
}

export function RateSimulator({ probabilityData, currency = "USD", onRateChange }: RateSimulatorProps) {
  const currentRate = probabilityData.your_price || 0;
  const [simulatedRate, setSimulatedRate] = useState(currentRate);
  const avgAvailableRate = probabilityData.avg_available_rate || currentRate;

  // Reset simulated rate when the probability data changes
  useEffect(() => {
    setSimulatedRate(probabilityData.your_price || 0);
  }, [probabilityData.your_price]);

  // Calculate min/max for slider
  const minRate = Math.max(50, Math.round(avgAvailableRate * 0.5));
  const maxRate = Math.round(Math.max(currentRate, avgAvailableRate) * 1.5);

  // Recalculate probability with simulated rate
  const { probability: simulatedProbability, pricePositionScore: simulatedPriceScore, factors } = useMemo(
    () => recalculateProbability(simulatedRate, probabilityData),
    [simulatedRate, probabilityData]
  );

  const originalProbability = probabilityData.probability;
  const probabilityDelta = simulatedProbability - originalProbability;

  // Generate rate suggestions
  const suggestions = useMemo(
    () => generateRateSuggestions(currentRate, avgAvailableRate, probabilityData),
    [currentRate, avgAvailableRate, probabilityData]
  );

  // Get colors
  const originalColors = getProbabilityColor(originalProbability);
  const simulatedColors = getProbabilityColor(simulatedProbability);

  // Booking window status
  const bookingWindowStatus = getBookingWindowStatus(
    probabilityData.current_dba,
    probabilityData.expected_booking_window
  );

  // Format price
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  // Handle slider change
  const handleSliderChange = (value: number[]) => {
    setSimulatedRate(value[0]);
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(value) && value >= minRate && value <= maxRate) {
      setSimulatedRate(value);
    }
  };

  // Apply suggestion
  const applySuggestion = (suggestion: RateSuggestion) => {
    setSimulatedRate(suggestion.rate);
  };

  // Market position text
  const marketPosition = avgAvailableRate > 0
    ? ((simulatedRate - avgAvailableRate) / avgAvailableRate) * 100
    : 0;

  return (
    <div className="space-y-5">
      {/* Rate Simulator Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Rate Simulator
        </h4>

        {/* Current vs Simulated Rate Display */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Current Rate</div>
            <div className="text-xl font-bold">{formatPrice(currentRate)}</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-3 border border-primary/20">
            <div className="text-xs text-primary">Simulated Rate</div>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={formatPrice(simulatedRate)}
                onChange={handleInputChange}
                className="h-8 text-xl font-bold w-24 px-1 border-0 bg-transparent focus-visible:ring-0"
              />
            </div>
          </div>
        </div>

        {/* Rate Slider */}
        <div className="space-y-2">
          <Slider
            value={[simulatedRate]}
            onValueChange={handleSliderChange}
            min={minRate}
            max={maxRate}
            step={5}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatPrice(minRate)}</span>
            <span className="text-primary font-medium">
              Avg Market: {formatPrice(avgAvailableRate)}
            </span>
            <span>{formatPrice(maxRate)}</span>
          </div>
        </div>

        {/* Market Position */}
        <div className={`flex items-center gap-2 p-3 rounded-lg ${
          marketPosition > 10 ? "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400" :
          marketPosition < -10 ? "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400" :
          "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400"
        }`}>
          <span className="text-sm">
            {formatPrice(simulatedRate)} is
          </span>
          <Badge variant="secondary" className={`font-semibold ${
            marketPosition > 10 ? "bg-red-600 text-white" :
            marketPosition < -10 ? "bg-emerald-600 text-white" :
            "bg-amber-600 text-white"
          }`}>
            {marketPosition > 0 ? "+" : ""}{marketPosition.toFixed(1)}%
          </Badge>
          <span className="text-sm">
            {marketPosition > 10 ? "above market" : marketPosition < -10 ? "below market" : "at market"}
          </span>
        </div>
      </div>

      <Separator />

      {/* Probability Impact Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Target className="h-4 w-4" />
          Probability Impact
        </h4>

        {/* Original vs Simulated Probability */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-20">At {formatPrice(currentRate)}:</span>
            <div className="flex-1 bg-muted/30 rounded-full h-5 overflow-hidden">
              <div
                className={`h-full ${originalColors.badge} transition-all`}
                style={{ width: `${originalProbability}%` }}
              />
            </div>
            <span className={`text-sm font-semibold w-12 text-right ${originalColors.text}`}>
              {Math.round(originalProbability)}%
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-primary w-20">At {formatPrice(simulatedRate)}:</span>
            <div className="flex-1 bg-muted/30 rounded-full h-5 overflow-hidden">
              <div
                className={`h-full ${simulatedColors.badge} transition-all`}
                style={{ width: `${simulatedProbability}%` }}
              />
            </div>
            <div className="flex items-center gap-1 w-24 justify-end">
              <span className={`text-sm font-semibold ${simulatedColors.text}`}>
                {Math.round(simulatedProbability)}%
              </span>
              {probabilityDelta !== 0 && (
                <Badge variant="outline" className={`text-xs ${
                  probabilityDelta > 0 ? "text-emerald-600 border-emerald-300" : "text-red-600 border-red-300"
                }`}>
                  {probabilityDelta > 0 ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                  {probabilityDelta > 0 ? "+" : ""}{Math.round(probabilityDelta)}%
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Factor Breakdown at Simulated Rate */}
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground mb-2">Breakdown at {formatPrice(simulatedRate)}:</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Compset Demand:</span>
              <span className="font-medium">{Math.round(factors.compsetDemandScore)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Price Position:</span>
              <span className={`font-medium ${
                simulatedPriceScore > probabilityData.price_position_score ? "text-emerald-600" :
                simulatedPriceScore < probabilityData.price_position_score ? "text-red-600" : ""
              }`}>
                {Math.round(simulatedPriceScore)}%
                {simulatedPriceScore !== probabilityData.price_position_score && (
                  <span className="text-xs ml-1">
                    ({simulatedPriceScore > probabilityData.price_position_score ? "↑" : "↓"} was {Math.round(probabilityData.price_position_score)}%)
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Historical:</span>
              <span className="font-medium">{Math.round(factors.historicalScore)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Booking Window:</span>
              <span className="font-medium">{Math.round(factors.bookingWindowScore)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Rate Suggestions */}
      {suggestions.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Suggested Rates
            </h4>
            <div className="space-y-2">
              {suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => applySuggestion(suggestion)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors hover:bg-muted/50 ${
                    simulatedRate === suggestion.rate ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{formatPrice(suggestion.rate)}</span>
                      <Badge variant="outline" className="text-xs">
                        {suggestion.label}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{suggestion.description}</div>
                  </div>
                  <div className={`text-lg font-bold ${getProbabilityColor(suggestion.probability).text}`}>
                    {Math.round(suggestion.probability)}%
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Booking Window Analysis */}
      <Separator />
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Booking Window Analysis
        </h4>

        <div className="bg-muted/30 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Days until date:</span>
            <span className="font-semibold">{probabilityData.current_dba} days</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Expected window:</span>
            <span className="font-semibold">{probabilityData.expected_booking_window} days</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status:</span>
            <span className={`font-semibold ${bookingWindowStatus.color}`}>
              {bookingWindowStatus.status}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{bookingWindowStatus.description}</div>

          {/* Last Year Comparison */}
          {probabilityData.historical_date && (
            <div className="pt-2 border-t border-border/50">
              <div className="text-xs text-muted-foreground mb-1">
                Same week last year: {probabilityData.historical_date}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={probabilityData.historical_was_booked ? "default" : "secondary"}>
                  {probabilityData.historical_was_booked ? "Booked" : "Not Booked"}
                </Badge>
                {probabilityData.historical_was_booked && probabilityData.historical_rate && (
                  <span className="text-sm">
                    at {formatPrice(probabilityData.historical_rate)}/night
                  </span>
                )}
                {probabilityData.historical_dba && (
                  <span className="text-xs text-muted-foreground">
                    ({probabilityData.historical_dba}d out)
                  </span>
                )}
              </div>
              {probabilityData.is_dba_outlier && (
                <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  Last year's booking timing was unusual (outlier)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

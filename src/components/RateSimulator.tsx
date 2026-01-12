import { useState, useMemo, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  TrendingUp, TrendingDown, Target, Zap, DollarSign, Clock, 
  AlertTriangle, Info, History, BarChart3, RotateCcw 
} from "lucide-react";
import {
  ProbabilityData,
  recalculateProbability,
  generateRateSuggestions,
  getProbabilityColor,
  getBookingWindowStatus,
  getModeDisplayInfo,
  RateSuggestion,
  WeightMode,
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

  // Calculate min/max for slider - more flexible range
  const baseMin = Math.max(25, Math.round(Math.min(currentRate, avgAvailableRate) * 0.3));
  const baseMax = Math.round(Math.max(currentRate, avgAvailableRate) * 2);
  // Expand range if simulated rate is outside, but never below 1
  const minRate = Math.max(1, Math.min(baseMin, simulatedRate - 50));
  const maxRate = Math.max(baseMax, simulatedRate + 50);

  // Get currency symbol
  const getCurrencySymbol = (curr: string) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: curr,
        minimumFractionDigits: 0,
      }).format(0).replace(/\d/g, "").trim();
    } catch {
      return "$";
    }
  };
  const currencySymbol = getCurrencySymbol(currency);

  // Recalculate probability with simulated rate (now includes mode and weights)
  const { probability: simulatedProbability, pricePositionScore: simulatedPriceScore, factors, mode, weights } = useMemo(
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

  // Mode display info
  const modeInfo = getModeDisplayInfo(mode);

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

  // Handle input change - now accepts any positive number
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value > 0) {
      setSimulatedRate(Math.round(value));
    }
  };

  // Reset to current rate
  const handleReset = () => {
    setSimulatedRate(currentRate);
  };

  // Check if rate has been modified
  const isModified = simulatedRate !== currentRate;

  // Apply suggestion
  const applySuggestion = (suggestion: RateSuggestion) => {
    setSimulatedRate(suggestion.rate);
  };

  // Market position text
  const marketPosition = avgAvailableRate > 0
    ? ((simulatedRate - avgAvailableRate) / avgAvailableRate) * 100
    : 0;

  // Mode icon
  const ModeIcon = mode === 'far_out' ? History : mode === 'close_in' ? Zap : BarChart3;

  return (
    <div className="space-y-5">
      {/* Mode Indicator */}
      {mode !== 'standard' && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${modeInfo.bgColor} ${modeInfo.color} cursor-help`}>
                <ModeIcon className="h-4 w-4" />
                <span>Based on {modeInfo.label}</span>
                <Info className="h-3.5 w-3.5 opacity-60" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-sm">{modeInfo.description}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Rate Simulator Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Rate Simulator
        </h4>

        {/* Current Rate Display */}
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Current Rate</div>
          <div className="text-xl font-bold">{formatPrice(currentRate)}</div>
        </div>

        {/* Test Rate Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="testRate" className="text-sm font-medium">
              Test a different rate
            </Label>
            {isModified && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleReset}
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </Button>
            )}
          </div>
          <div className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
            isModified 
              ? "border-primary bg-primary/5" 
              : "border-border bg-background"
          }`}>
            <span className="text-lg text-muted-foreground font-medium">{currencySymbol}</span>
            <Input
              id="testRate"
              type="number"
              value={simulatedRate}
              onChange={handleInputChange}
              className="h-10 text-2xl font-bold border-0 bg-transparent focus-visible:ring-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              min={1}
              step={5}
            />
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

        {/* Factor Breakdown with Dynamic Weights */}
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground mb-2">
            <span>Breakdown at {formatPrice(simulatedRate)}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`flex items-center gap-1 cursor-help ${modeInfo.color}`}>
                    <ModeIcon className="h-3 w-3" />
                    {mode === 'far_out' ? 'Far Out' : mode === 'close_in' ? 'Close-In' : 'Standard'} weights
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs">{modeInfo.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Compset <span className="text-xs opacity-60">({Math.round(weights.compsetDemand * 100)}%)</span>:
              </span>
              <span className="font-medium">{Math.round(factors.compsetDemandScore)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Price <span className="text-xs opacity-60">({Math.round(weights.pricePosition * 100)}%)</span>:
              </span>
              <span className={`font-medium ${
                simulatedPriceScore > probabilityData.price_position_score ? "text-emerald-600" :
                simulatedPriceScore < probabilityData.price_position_score ? "text-red-600" : ""
              }`}>
                {Math.round(simulatedPriceScore)}%
                {simulatedPriceScore !== probabilityData.price_position_score && (
                  <span className="text-xs ml-1">
                    ({simulatedPriceScore > probabilityData.price_position_score ? "↑" : "↓"})
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Historical <span className="text-xs opacity-60">({Math.round(weights.historical * 100)}%)</span>:
              </span>
              <span className="font-medium">{Math.round(factors.historicalScore)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Window <span className="text-xs opacity-60">({Math.round(weights.bookingWindow * 100)}%)</span>:
              </span>
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

          {/* Historical Monthly Occupancy (show in far_out mode) */}
          {mode === 'far_out' && probabilityData.historical_monthly_occupancy !== undefined && (
            <div className="pt-2 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last year's occupancy (this month):</span>
                <span className="font-semibold">{probabilityData.historical_monthly_occupancy}%</span>
              </div>
            </div>
          )}

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

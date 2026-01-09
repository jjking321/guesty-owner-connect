import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronLeft, ChevronRight, Moon, Users, BarChart3 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday, isBefore } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CalendarDateDetail } from "./CalendarDateDetail";
import { ComparableMetricsDialog } from "./ComparableMetricsDialog";
import { ProbabilityData, getProbabilityColor } from "@/lib/probabilityCalculator";

interface ListingCalendarProps {
  listingId: string;
}

interface CalendarDay {
  id: string;
  date: string;
  price: number | null;
  currency: string | null;
  min_nights: number | null;
  status: string | null;
  is_available: boolean;
  cta: boolean | null;
  ctd: boolean | null;
  block_reason: string | null;
  synced_from_guesty_at: string | null;
}

interface FutureRate {
  date: string;
  available: boolean;
  rate: number;
}

interface ComparableWithRates {
  listing_name: string | null;
  cover_photo_url: string | null;
  airroi_listing_id: string;
  future_rates: { rates: FutureRate[] } | null;
}

interface CompsetDayDetail {
  airroi_listing_id: string;
  name: string;
  thumbnail: string | null;
  rate: number;
  available: boolean;
  diffFromYou: number | null;
  diffPercent: number | null;
}

interface CompsetDailyInfo {
  totalCount: number;
  bookedCount: number;
  avgRate: number;
  comparables: CompsetDayDetail[];
}

export function ListingCalendar({ listingId }: ListingCalendarProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [legendOpen, setLegendOpen] = useState(false);
  const [compareToCompset, setCompareToCompset] = useState(true);
  const [showProbability, setShowProbability] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedComparableId, setSelectedComparableId] = useState<string | null>(null);
  const [metricsDialogOpen, setMetricsDialogOpen] = useState(false);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  // Fetch calendar data
  const { data: calendarData, isLoading, error } = useQuery({
    queryKey: ['listing-calendar', listingId, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('capacity_calendar')
        .select('*')
        .eq('listing_id', listingId)
        .gte('date', format(monthStart, 'yyyy-MM-dd'))
        .lte('date', format(monthEnd, 'yyyy-MM-dd'))
        .order('date');
      
      if (error) throw error;
      return data as CalendarDay[];
    },
  });

  // Fetch booking probabilities
  const { data: probabilityData, isLoading: probabilitiesLoading } = useQuery({
    queryKey: ['booking-probabilities', listingId, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_probabilities')
        .select('*')
        .eq('listing_id', listingId)
        .gte('date', format(monthStart, 'yyyy-MM-dd'))
        .lte('date', format(monthEnd, 'yyyy-MM-dd'));
      if (error) throw error;
      return (data || []).map(d => ({
        ...d,
        weights_used: d.weights_used as unknown as ProbabilityData['weights_used'],
      })) as ProbabilityData[];
    },
    enabled: showProbability,
  });

  // Calculate probabilities mutation
  const calculateProbabilitiesMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('calculate-booking-probabilities', {
        body: { listingId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-probabilities', listingId] });
      toast({ title: "Probabilities calculated", description: "Booking probabilities updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Calculation failed",
        description: error.message || "Failed to calculate probabilities",
        variant: "destructive",
      });
    },
  });

  // Build probability map for quick lookup
  const probabilityMap = useMemo(() => {
    if (!probabilityData) return new Map<string, ProbabilityData>();
    const map = new Map<string, ProbabilityData>();
    probabilityData.forEach(prob => {
      map.set(prob.date, prob);
    });
    return map;
  }, [probabilityData]);

  // Fetch selected comparables' future rates with names and thumbnails
  const { data: compsetData } = useQuery({
    queryKey: ['compset-future-rates', listingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_comparables')
        .select('listing_name, cover_photo_url, airroi_listing_id, future_rates')
        .eq('listing_id', listingId)
        .eq('is_selected', true)
        .not('future_rates', 'is', null);
      
      if (error) throw error;
      return data as unknown as ComparableWithRates[];
    },
    enabled: compareToCompset,
  });

  // Calculate daily compset averages
  const compsetAverages = useMemo(() => {
    if (!compsetData || compsetData.length === 0) return new Map<string, number>();
    
    const dailyRates = new Map<string, number[]>();
    
    compsetData.forEach(comp => {
      if (comp.future_rates?.rates) {
        comp.future_rates.rates.forEach(rate => {
          if (rate.rate > 0) {
            const existing = dailyRates.get(rate.date) || [];
            existing.push(rate.rate);
            dailyRates.set(rate.date, existing);
          }
        });
      }
    });
    
    const averages = new Map<string, number>();
    dailyRates.forEach((rates, date) => {
      averages.set(date, rates.reduce((sum, r) => sum + r, 0) / rates.length);
    });
    
    return averages;
  }, [compsetData]);

  // Check if compset data is available
  const hasCompsetData = compsetData && compsetData.length > 0 && compsetAverages.size > 0;

  // Calculate detailed compset info per date (for flyout and booked count)
  const compsetDailyDetails = useMemo(() => {
    if (!compsetData || compsetData.length === 0) return new Map<string, CompsetDailyInfo>();
    
    const details = new Map<string, CompsetDailyInfo>();
    
    // Build a map of date -> array of comp details
    const dateToComps = new Map<string, CompsetDayDetail[]>();
    
    compsetData.forEach(comp => {
      if (comp.future_rates?.rates) {
        comp.future_rates.rates.forEach(rate => {
          if (rate.rate > 0) {
            const existing = dateToComps.get(rate.date) || [];
            existing.push({
              airroi_listing_id: comp.airroi_listing_id,
              name: comp.listing_name || 'Unknown Property',
              thumbnail: comp.cover_photo_url,
              rate: rate.rate,
              available: rate.available,
              diffFromYou: null, // Will be calculated when we have myPrice
              diffPercent: null,
            });
            dateToComps.set(rate.date, existing);
          }
        });
      }
    });
    
    // Now aggregate into CompsetDailyInfo
    dateToComps.forEach((comps, date) => {
      const bookedCount = comps.filter(c => !c.available).length;
      const avgRate = comps.reduce((sum, c) => sum + c.rate, 0) / comps.length;
      
      details.set(date, {
        totalCount: comps.length,
        bookedCount,
        avgRate,
        comparables: comps.sort((a, b) => b.rate - a.rate), // Sort by rate desc
      });
    });
    
    return details;
  }, [compsetData]);

  // Get compset info for a specific date with price differences calculated
  const getCompsetInfoForDate = (dateStr: string, myPrice: number | null): CompsetDailyInfo | undefined => {
    const info = compsetDailyDetails.get(dateStr);
    if (!info) return undefined;
    
    // Calculate price differences if we have myPrice
    if (myPrice) {
      return {
        ...info,
        comparables: info.comparables.map(comp => ({
          ...comp,
          diffFromYou: comp.rate - myPrice,
          diffPercent: ((comp.rate - myPrice) / myPrice) * 100,
        })),
      };
    }
    
    return info;
  };

  // Fetch full comparable data for the metrics dialog
  const { data: selectedComparableForMetrics } = useQuery({
    queryKey: ['comparable-for-metrics', listingId, selectedComparableId],
    queryFn: async () => {
      if (!selectedComparableId) return null;
      const { data, error } = await supabase
        .from('property_comparables')
        .select('*')
        .eq('listing_id', listingId)
        .eq('airroi_listing_id', selectedComparableId)
        .single();
      
      if (error) throw error;
      // Cast JSON fields to the expected types for ComparableMetricsDialog
      return {
        ...data,
        id: data.id,
        listing_name: data.listing_name,
        cover_photo_url: data.cover_photo_url,
        superhost: data.superhost ?? false,
        location_info: data.location_info as { locality?: string; region?: string } | null,
        ratings: data.ratings as { rating_overall?: number; num_reviews?: number } | null,
        historical_metrics: data.historical_metrics as { results?: Array<{ date: string; occupancy: number; average_daily_rate: number; rev_par: number; revenue: number }> } | null,
        metrics_fetched_at: data.metrics_fetched_at,
        ttm_revenue: data.ttm_revenue,
        ttm_adr: data.ttm_adr,
        ttm_occupancy: data.ttm_occupancy,
        ttm_revpar: data.ttm_revpar,
        prior_ttm_revenue: data.prior_ttm_revenue,
        prior_ttm_adr: data.prior_ttm_adr,
        prior_ttm_occupancy: data.prior_ttm_occupancy,
        prior_ttm_revpar: data.prior_ttm_revpar,
        rollups_calculated_at: data.rollups_calculated_at,
        future_rates: data.future_rates as { rates?: Array<{ date: string; available: boolean; rate: number }> } | null,
        future_rates_fetched_at: data.future_rates_fetched_at,
      };
    },
    enabled: !!selectedComparableId,
  });

  // Handle comparable click from calendar date detail
  const handleComparableClick = (airroiListingId: string) => {
    setSelectedComparableId(airroiListingId);
    setMetricsDialogOpen(true);
  };

  // Sync calendar mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sync-listing-calendar', {
        body: { listingId },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Calendar synced",
        description: data.message || `Successfully synced calendar data`,
      });
      queryClient.invalidateQueries({ queryKey: ['listing-calendar', listingId] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync calendar",
        variant: "destructive",
      });
    },
  });

  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = monthStart.getDay();

  // Create a map for quick lookup
  const calendarMap = new Map<string, CalendarDay>();
  calendarData?.forEach(day => {
    calendarMap.set(day.date, day);
  });

  // Get comparison ring style based on price difference
  const getComparisonStyle = (myPrice: number | null, compsetAvg: number | undefined) => {
    if (!myPrice || !compsetAvg || !compareToCompset) return '';
    
    const percentDiff = ((myPrice - compsetAvg) / compsetAvg) * 100;
    
    // Green: 10%+ below compset (opportunity to raise prices)
    if (percentDiff <= -10) {
      return 'ring-2 ring-emerald-500 ring-inset';
    }
    // Red: 10%+ above compset (priced higher than market)
    if (percentDiff >= 10) {
      return 'ring-2 ring-red-500 ring-inset';
    }
    // Yellow: within ±10% (competitive)
    return 'ring-2 ring-amber-400 ring-inset';
  };

  // Calculate comparison summary stats
  const comparisonStats = useMemo(() => {
    if (!compareToCompset || !hasCompsetData || !calendarData) {
      return { daysAbove: 0, daysBelow: 0, daysAt: 0, avgDiff: 0 };
    }
    
    let daysAbove = 0;
    let daysBelow = 0;
    let daysAt = 0;
    let totalDiff = 0;
    let count = 0;
    
    calendarData.forEach(day => {
      if (day.price && day.is_available) {
        const compsetAvg = compsetAverages.get(day.date);
        if (compsetAvg) {
          const percentDiff = ((day.price - compsetAvg) / compsetAvg) * 100;
          totalDiff += percentDiff;
          count++;
          
          if (percentDiff >= 10) daysAbove++;
          else if (percentDiff <= -10) daysBelow++;
          else daysAt++;
        }
      }
    });
    
    return {
      daysAbove,
      daysBelow,
      daysAt,
      avgDiff: count > 0 ? totalDiff / count : 0,
    };
  }, [compareToCompset, hasCompsetData, calendarData, compsetAverages]);

  // Get status styling - color-coded cells
  const getStatusStyle = (day: CalendarDay | undefined, date: Date) => {
    const isPast = isBefore(date, new Date()) && !isToday(date);
    const baseStyle = isPast ? 'opacity-50' : '';
    
    if (!day) return `bg-muted/30 border-border ${baseStyle}`;
    
    // Booked - solid teal/green background
    if (day.status === 'booked' || day.block_reason === 'reservation') {
      return `bg-teal-500 dark:bg-teal-600 border-teal-600 dark:border-teal-700 ${baseStyle}`;
    }
    
    // Blocked - grey striped pattern
    if (day.status === 'unavailable' || day.block_reason === 'blocked') {
      return `blocked-stripe border-slate-300 dark:border-slate-600 ${baseStyle}`;
    }
    
    // Available - white/light background
    if (day.is_available) {
      return `bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 ${baseStyle}`;
    }
    
    return `bg-muted/30 border-border ${baseStyle}`;
  };

  // Get text color based on status
  const getTextColors = (day: CalendarDay | undefined) => {
    if (!day) return { day: 'text-muted-foreground', price: 'text-muted-foreground' };
    
    if (day.status === 'booked' || day.block_reason === 'reservation') {
      return { day: 'text-white/80', price: 'text-white' };
    }
    
    return { day: 'text-slate-500 dark:text-slate-400', price: 'text-emerald-600 dark:text-emerald-400' };
  };

  // Format price
  const formatPrice = (price: number | null, currency: string | null) => {
    if (price === null) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  // Get last sync time
  const lastSyncTime = calendarData?.[0]?.synced_from_guesty_at 
    ? new Date(calendarData[0].synced_from_guesty_at).toLocaleString()
    : null;

  // Go to today
  const goToToday = () => {
    setCurrentMonth(new Date());
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Calendar & Rates
            </CardTitle>
            <CardDescription>
              {lastSyncTime ? `Last synced: ${lastSyncTime}` : 'Not synced yet'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Checkbox 
                id="compareToCompset" 
                checked={compareToCompset}
                onCheckedChange={(checked) => setCompareToCompset(checked === true)}
              />
              <Label htmlFor="compareToCompset" className="text-sm cursor-pointer">
                Compare to Compset
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox 
                id="showProbability" 
                checked={showProbability}
                onCheckedChange={(checked) => setShowProbability(checked === true)}
              />
              <Label htmlFor="showProbability" className="text-sm cursor-pointer">
                Booking Probability
              </Label>
            </div>
            {showProbability && (
              <Button 
                onClick={() => calculateProbabilitiesMutation.mutate()}
                disabled={calculateProbabilitiesMutation.isPending}
                variant="outline"
                size="sm"
              >
                <BarChart3 className={`h-3 w-3 mr-1.5 ${calculateProbabilitiesMutation.isPending ? 'animate-pulse' : ''}`} />
                {calculateProbabilitiesMutation.isPending ? 'Calculating...' : 'Calculate'}
              </Button>
            )}
            <Button 
              onClick={() => syncMutation.mutate()} 
              disabled={syncMutation.isPending}
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing...' : 'Sync Calendar'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Month Navigation */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold min-w-[160px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToToday}
            className="ml-2"
          >
            Today
          </Button>
        </div>

        {/* Collapsible Legend */}
        <Collapsible open={legendOpen} onOpenChange={setLegendOpen} className="mb-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
              {legendOpen ? '▼' : '▶'} Calendar legend
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="flex flex-wrap gap-4 text-sm p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-teal-500" />
                <span className="text-muted-foreground">Booked</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-white border border-slate-200" />
                <span className="text-muted-foreground">Available</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded blocked-stripe border border-slate-300" />
                <span className="text-muted-foreground">Blocked</span>
              </div>
              <div className="flex items-center gap-2">
                <Moon className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Min nights</span>
              </div>
              {compareToCompset && (
                <>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-white ring-2 ring-emerald-500 ring-inset" />
                    <span className="text-muted-foreground">Below market (10%+)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-white ring-2 ring-amber-400 ring-inset" />
                    <span className="text-muted-foreground">At market (±10%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-white ring-2 ring-red-500 ring-inset" />
                    <span className="text-muted-foreground">Above market (10%+)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Comps booked</span>
                  </div>
                </>
              )}
              {showProbability && (
                <>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold">%</div>
                    <span className="text-muted-foreground">High (70%+)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-amber-500 flex items-center justify-center text-[8px] text-white font-bold">%</div>
                    <span className="text-muted-foreground">Medium (40-69%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-500 flex items-center justify-center text-[8px] text-white font-bold">%</div>
                    <span className="text-muted-foreground">Low (&lt;40%)</span>
                  </div>
                </>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading calendar...</div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">Failed to load calendar</div>
        ) : (
          <div className="relative">
            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
              {/* Day headers */}
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2 bg-muted/30">
                  {day}
                </div>
              ))}
              
              {/* Empty cells for days before month starts */}
              {Array.from({ length: startDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="h-20 bg-muted/20" />
              ))}
              
              {/* Calendar days */}
              {daysInMonth.map((date) => {
                const dateStr = format(date, 'yyyy-MM-dd');
                const dayData = calendarMap.get(dateStr);
                const textColors = getTextColors(dayData);
                const compsetAvg = compsetAverages.get(dateStr);
                const showComparison = compareToCompset && hasCompsetData && dayData?.price && dayData.is_available && compsetAvg;
                const compsetInfo = compsetDailyDetails.get(dateStr);
                
                return (
                  <div
                    key={dateStr}
                    onClick={() => setSelectedDate(dateStr)}
                    className={`
                      relative h-20 p-1.5 border flex flex-col cursor-pointer hover:opacity-90 transition-opacity
                      ${getStatusStyle(dayData, date)}
                      ${isToday(date) && !showComparison ? 'ring-2 ring-primary ring-inset' : ''}
                      ${showComparison ? getComparisonStyle(dayData?.price ?? null, compsetAvg) : ''}
                    `}
                  >
                    {/* Day number - top left */}
                    <div className={`text-xs font-medium ${textColors.day}`}>
                      {format(date, 'd')}
                    </div>
                    
                    {/* Price - centered */}
                    {dayData?.price && (
                      <div className={`text-base font-bold ${textColors.price} flex-1 flex flex-col items-center justify-center`}>
                        {formatPrice(dayData.price, dayData.currency)}
                        {/* Compset average - smaller, below */}
                        {showComparison && compsetAvg && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            avg {formatPrice(compsetAvg, dayData.currency)}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Compset booked count - bottom left */}
                    {compareToCompset && compsetInfo && compsetInfo.totalCount > 0 && (
                      <div className={`absolute bottom-1 left-1 flex items-center gap-0.5 text-[10px] ${textColors.day}`}>
                        <Users className="h-2.5 w-2.5" />
                        <span>{compsetInfo.bookedCount}/{compsetInfo.totalCount}</span>
                      </div>
                    )}
                    
                    {/* Probability badge - top right */}
                    {showProbability && dayData?.is_available && (() => {
                      const prob = probabilityMap.get(dateStr);
                      if (!prob || prob.probability === null) return null;
                      const colors = getProbabilityColor(prob.probability);
                      return (
                        <div className={`absolute top-1 right-1 px-1 py-0.5 rounded text-[9px] font-bold text-white ${colors.badge}`}>
                          {Math.round(prob.probability)}%
                        </div>
                      );
                    })()}
                    
                    {/* Min nights - bottom right */}
                    {dayData?.min_nights && dayData.min_nights > 1 && !showProbability && (
                      <div className={`absolute bottom-1 right-1 flex items-center gap-0.5 text-xs ${textColors.day}`}>
                        <Moon className="h-3 w-3" />
                        <span>{dayData.min_nights}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Calendar Stats */}
        {calendarData && calendarData.length > 0 && (
          <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Available Days</div>
              <div className="text-lg font-semibold">
                {calendarData.filter(d => d.is_available).length}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Booked Days</div>
              <div className="text-lg font-semibold">
                {calendarData.filter(d => d.status === 'booked' || d.block_reason === 'reservation').length}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Avg Rate</div>
              <div className="text-lg font-semibold">
                {formatPrice(
                  calendarData.reduce((sum, d) => sum + (d.price || 0), 0) / calendarData.filter(d => d.price).length || 0,
                  calendarData[0]?.currency
                )}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Occupancy</div>
              <div className="text-lg font-semibold">
                {((calendarData.filter(d => d.status === 'booked' || d.block_reason === 'reservation').length / calendarData.length) * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        )}

        {/* Compset Comparison Stats */}
        {compareToCompset && hasCompsetData && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium mb-3">Compset Comparison</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Below Market</div>
                <div className="text-lg font-semibold text-emerald-600">{comparisonStats.daysBelow} days</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">At Market</div>
                <div className="text-lg font-semibold text-amber-500">{comparisonStats.daysAt} days</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Above Market</div>
                <div className="text-lg font-semibold text-red-500">{comparisonStats.daysAbove} days</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Avg Difference</div>
                <div className={`text-lg font-semibold ${comparisonStats.avgDiff >= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                  {comparisonStats.avgDiff >= 0 ? '+' : ''}{comparisonStats.avgDiff.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Probability Summary Stats */}
        {showProbability && probabilityData && probabilityData.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium mb-3">Booking Probability Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">High (70%+)</div>
                <div className="text-lg font-semibold text-emerald-600">
                  {probabilityData.filter(p => p.probability !== null && p.probability >= 70).length} days
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Medium (40-69%)</div>
                <div className="text-lg font-semibold text-amber-500">
                  {probabilityData.filter(p => p.probability !== null && p.probability >= 40 && p.probability < 70).length} days
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Low (&lt;40%)</div>
                <div className="text-lg font-semibold text-red-500">
                  {probabilityData.filter(p => p.probability !== null && p.probability < 40).length} days
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Avg Probability</div>
                <div className="text-lg font-semibold">
                  {probabilityData.length > 0 
                    ? Math.round(probabilityData.filter(p => p.probability !== null).reduce((sum, p) => sum + (p.probability || 0), 0) / probabilityData.filter(p => p.probability !== null).length)
                    : 0}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No compset data message */}
        {compareToCompset && !hasCompsetData && (
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-400">
            No compset data available. Select comparables and fetch their future rates in the Comparables tab first.
          </div>
        )}
      </CardContent>

      {/* Date Detail Flyout */}
      <CalendarDateDetail
        selectedDate={selectedDate}
        onClose={() => setSelectedDate(null)}
        myDayData={selectedDate ? calendarMap.get(selectedDate) : undefined}
        compsetInfo={selectedDate ? getCompsetInfoForDate(selectedDate, calendarMap.get(selectedDate)?.price ?? null) : undefined}
        compareToCompset={compareToCompset}
        onComparableClick={handleComparableClick}
        probabilityData={selectedDate && showProbability ? probabilityMap.get(selectedDate) : undefined}
      />

      {/* Comparable Metrics Dialog */}
      <ComparableMetricsDialog
        comparable={selectedComparableForMetrics}
        open={metricsDialogOpen}
        onOpenChange={(open) => {
          setMetricsDialogOpen(open);
          if (!open) setSelectedComparableId(null);
        }}
      />
    </Card>
  );
}

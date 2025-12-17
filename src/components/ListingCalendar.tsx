import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday, isBefore } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

export function ListingCalendar({ listingId }: ListingCalendarProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [legendOpen, setLegendOpen] = useState(false);

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
          <Button 
            onClick={() => syncMutation.mutate()} 
            disabled={syncMutation.isPending}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? 'Syncing...' : 'Sync Calendar'}
          </Button>
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
                
                return (
                  <div
                    key={dateStr}
                    className={`
                      relative h-20 p-1.5 border flex flex-col
                      ${getStatusStyle(dayData, date)}
                      ${isToday(date) ? 'ring-2 ring-primary ring-inset' : ''}
                    `}
                  >
                    {/* Day number - top left */}
                    <div className={`text-xs font-medium ${textColors.day}`}>
                      {format(date, 'd')}
                    </div>
                    
                    {/* Price - centered, large */}
                    {dayData?.price && (
                      <div className={`text-base font-bold ${textColors.price} flex-1 flex items-center justify-center`}>
                        {formatPrice(dayData.price, dayData.currency)}
                      </div>
                    )}
                    
                    {/* Min nights - bottom right */}
                    {dayData?.min_nights && dayData.min_nights > 1 && (
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
      </CardContent>
    </Card>
  );
}

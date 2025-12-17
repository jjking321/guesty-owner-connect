import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday, isBefore, parseISO, differenceInDays, isSameDay } from "date-fns";
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

interface Reservation {
  id: string;
  check_in: string | null;
  check_out: string | null;
  confirmation_code: string | null;
  source: string | null;
  status: string | null;
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

  // Fetch reservations for this month
  const { data: reservations } = useQuery({
    queryKey: ['listing-reservations', listingId, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reservations')
        .select('id, check_in, check_out, confirmation_code, source, status')
        .eq('listing_id', listingId)
        .lte('check_in', format(monthEnd, 'yyyy-MM-dd'))
        .gte('check_out', format(monthStart, 'yyyy-MM-dd'))
        .in('status', ['confirmed', 'reserved', 'checked_in', 'inquiry'])
        .order('check_in');
      
      if (error) throw error;
      return data as Reservation[];
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

  // Calculate reservation bars for each row
  const reservationBars = useMemo(() => {
    if (!reservations) return [];
    
    const bars: Array<{
      reservation: Reservation;
      startCol: number;
      endCol: number;
      row: number;
      label: string;
    }> = [];

    reservations.forEach(res => {
      if (!res.check_in || !res.check_out) return;
      
      const checkIn = parseISO(res.check_in);
      const checkOut = parseISO(res.check_out);
      
      // Find which days of the month this reservation covers
      daysInMonth.forEach((date, index) => {
        const dayPosition = index + startDayOfWeek;
        const row = Math.floor(dayPosition / 7);
        const col = dayPosition % 7;
        
        // Check if this is the check-in day or first day of the month for ongoing reservation
        const isCheckInDay = isSameDay(date, checkIn);
        const isFirstDayOfMonthAndOngoing = index === 0 && isBefore(checkIn, monthStart);
        
        if (isCheckInDay || isFirstDayOfMonthAndOngoing) {
          // Calculate how many days this bar spans in this row
          let endDate = checkOut;
          let barEndCol = col;
          
          // Find the end of this bar (either end of row or checkout)
          for (let d = col; d < 7; d++) {
            const dayIndex = row * 7 + d - startDayOfWeek;
            if (dayIndex >= daysInMonth.length) break;
            
            const currentDate = daysInMonth[dayIndex];
            if (!currentDate) break;
            
            // Check if we've reached checkout (exclusive - checkout day is not included)
            if (isSameDay(currentDate, checkOut) || isBefore(checkOut, currentDate)) {
              break;
            }
            
            barEndCol = d;
          }
          
          bars.push({
            reservation: res,
            startCol: col,
            endCol: barEndCol,
            row,
            label: res.confirmation_code || res.source || 'Booked',
          });
        }
        
        // Handle bars that continue to next row
        if (col === 0 && !isCheckInDay && !isFirstDayOfMonthAndOngoing) {
          // Check if there's an ongoing reservation
          if (isBefore(checkIn, date) && isBefore(date, checkOut)) {
            let barEndCol = 0;
            
            for (let d = 0; d < 7; d++) {
              const dayIndex = row * 7 + d - startDayOfWeek;
              if (dayIndex >= daysInMonth.length) break;
              
              const currentDate = daysInMonth[dayIndex];
              if (!currentDate) break;
              
              if (isSameDay(currentDate, checkOut) || isBefore(checkOut, currentDate)) {
                break;
              }
              
              barEndCol = d;
            }
            
            bars.push({
              reservation: res,
              startCol: 0,
              endCol: barEndCol,
              row,
              label: res.confirmation_code || res.source || 'Booked',
            });
          }
        }
      });
    });

    return bars;
  }, [reservations, daysInMonth, monthStart, startDayOfWeek]);

  // Get status styling
  const getStatusStyle = (day: CalendarDay | undefined, date: Date) => {
    const isPast = isBefore(date, new Date()) && !isToday(date);
    const baseStyle = isPast ? 'opacity-60' : '';
    
    if (!day) return `bg-muted/50 border-border ${baseStyle}`;
    
    // Blocked (yellow)
    if (day.status === 'unavailable' || (day.block_reason === 'blocked' && day.status !== 'booked')) {
      return `bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 ${baseStyle}`;
    }
    
    // Booked - will show reservation bar overlay, so keep white/transparent
    if (day.status === 'booked' || day.block_reason === 'reservation') {
      return `bg-background border-border ${baseStyle}`;
    }
    
    // Available (white/background)
    if (day.is_available) {
      return `bg-background border-border ${baseStyle}`;
    }
    
    return `bg-muted/50 border-border ${baseStyle}`;
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

  // Check if a day has a reservation bar
  const getDayReservation = (date: Date) => {
    if (!reservations) return null;
    return reservations.find(res => {
      if (!res.check_in || !res.check_out) return false;
      const checkIn = parseISO(res.check_in);
      const checkOut = parseISO(res.check_out);
      return !isBefore(date, checkIn) && isBefore(date, checkOut);
    });
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
                <div className="w-4 h-4 rounded bg-background border border-border" />
                <span className="text-muted-foreground">Available</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-4 rounded bg-emerald-500 dark:bg-emerald-600" />
                <span className="text-muted-foreground">Booked</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700" />
                <span className="text-muted-foreground">Blocked</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-muted/50 border border-border" />
                <span className="text-muted-foreground">No data</span>
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
              {daysInMonth.map((date, index) => {
                const dateStr = format(date, 'yyyy-MM-dd');
                const dayData = calendarMap.get(dateStr);
                const reservation = getDayReservation(date);
                const isCheckIn = reservation && isSameDay(date, parseISO(reservation.check_in!));
                const isLastNight = reservation && isSameDay(date, parseISO(reservation.check_out!)) === false && 
                  differenceInDays(parseISO(reservation.check_out!), date) === 1;
                
                return (
                  <div
                    key={dateStr}
                    className={`
                      relative h-20 p-1.5 border flex flex-col
                      ${getStatusStyle(dayData, date)}
                      ${isToday(date) ? 'ring-2 ring-primary ring-inset' : ''}
                    `}
                  >
                    {/* Content area with bottom padding for bar */}
                    <div className="flex flex-col flex-1 pb-4">
                      {/* Day number */}
                      <div className="text-xs text-muted-foreground font-medium">
                        {format(date, 'd')}
                      </div>
                      
                      {/* Price - larger */}
                      {dayData?.price && (
                        <div className="text-sm font-bold text-foreground mt-auto">
                          {formatPrice(dayData.price, dayData.currency)}
                        </div>
                      )}
                      
                      {/* Min nights with moon icon */}
                      {dayData?.min_nights && dayData.min_nights > 1 && (
                        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Moon className="h-3 w-3" />
                          <span>{dayData.min_nights}</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Reservation bar overlay - at bottom */}
                    {reservation && (
                      <div 
                        className={`
                          absolute bottom-0 h-4 bg-emerald-500 dark:bg-emerald-600 
                          flex items-center text-white text-[10px] font-medium overflow-hidden z-10
                          ${isCheckIn ? 'left-1 rounded-l' : 'left-0'}
                          ${isLastNight ? 'right-1 rounded-r' : 'right-0'}
                        `}
                      >
                        {isCheckIn && (
                          <span className="px-1 truncate">
                            {reservation.confirmation_code || reservation.source || 'Booked'}
                          </span>
                        )}
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

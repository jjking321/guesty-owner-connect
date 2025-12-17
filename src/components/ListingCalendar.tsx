import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, addMonths, subMonths, isToday, isBefore } from "date-fns";

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

  // Fetch calendar data
  const { data: calendarData, isLoading, error } = useQuery({
    queryKey: ['listing-calendar', listingId, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);
      
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

  // Get calendar days for current month view
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Create a map for quick lookup
  const calendarMap = new Map<string, CalendarDay>();
  calendarData?.forEach(day => {
    calendarMap.set(day.date, day);
  });

  // Get the day of week the month starts on (0 = Sunday)
  const startDayOfWeek = monthStart.getDay();

  // Get status color
  const getStatusColor = (day: CalendarDay | undefined) => {
    if (!day) return 'bg-muted';
    if (day.status === 'booked' || day.block_reason === 'reservation') return 'bg-red-500/20 border-red-500/50';
    if (day.status === 'unavailable' || day.block_reason === 'blocked') return 'bg-orange-500/20 border-orange-500/50';
    if (day.is_available) return 'bg-green-500/20 border-green-500/50';
    return 'bg-muted';
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

  return (
    <Card>
      <CardHeader>
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
        <div className="flex items-center justify-between mb-4">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Legend */}
        <div className="flex gap-4 mb-4 text-sm">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/50" />
            <span className="text-muted-foreground">Available</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500/20 border border-red-500/50" />
            <span className="text-muted-foreground">Booked</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-orange-500/20 border border-orange-500/50" />
            <span className="text-muted-foreground">Blocked</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-muted" />
            <span className="text-muted-foreground">No data</span>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading calendar...</div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">Failed to load calendar</div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {/* Day headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
            
            {/* Empty cells for days before month starts */}
            {Array.from({ length: startDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            
            {/* Calendar days */}
            {daysInMonth.map(date => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const dayData = calendarMap.get(dateStr);
              const isPast = isBefore(date, new Date()) && !isToday(date);
              
              return (
                <div
                  key={dateStr}
                  className={`
                    aspect-square p-1 rounded border text-xs flex flex-col justify-between
                    ${getStatusColor(dayData)}
                    ${isToday(date) ? 'ring-2 ring-primary' : ''}
                    ${isPast ? 'opacity-50' : ''}
                  `}
                >
                  <div className="font-medium">{format(date, 'd')}</div>
                  {dayData?.price && (
                    <div className="text-[10px] font-semibold truncate">
                      {formatPrice(dayData.price, dayData.currency)}
                    </div>
                  )}
                  {dayData?.min_nights && dayData.min_nights > 1 && (
                    <div className="text-[9px] text-muted-foreground">
                      {dayData.min_nights}n min
                    </div>
                  )}
                </div>
              );
            })}
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

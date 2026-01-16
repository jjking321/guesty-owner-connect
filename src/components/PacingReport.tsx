import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Moon, Percent, Target, ChevronDown, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, getDaysInMonth } from "date-fns";
import { parseLocalDate } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

interface PacingReportProps {
  reservations: any[];
  listingId?: string;      // For single listing views (PropertyDetail)
  listingIds?: string[];   // For multi-listing views (OwnerDetail, GroupDetail)
}

interface PacingMetrics {
  occupancy: { current: number; last: number; change: number };
  adjustedOccupancy: { current: number; last: number; change: number };
  revenue: { current: number; last: number; change: number };
  revPAR: { current: number; last: number; change: number };
  nights: { current: number; last: number; change: number };
  bookableDays: { current: number; last: number };
}

type PeriodType = 'ytd' | 'monthly';

export function PacingReport({ reservations, listingId, listingIds }: PacingReportProps) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const [periodType, setPeriodType] = useState<PeriodType>('ytd');
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedMonthYear, setSelectedMonthYear] = useState<number>(currentYear);
  const [isTableOpen, setIsTableOpen] = useState(false);

  // Resolve listing IDs for queries
  const effectiveListingIds = listingId ? [listingId] : (listingIds || []);

  // Generate month options for the next 12 months
  const monthOptions = [];
  for (let i = 0; i < 12; i++) {
    const date = new Date(currentYear, currentMonth + i, 1);
    monthOptions.push({
      value: `${date.getFullYear()}-${date.getMonth()}`,
      label: format(date, 'MMMM yyyy'),
      month: date.getMonth(),
      year: date.getFullYear(),
    });
  }

  // Calculate period boundaries based on selected period type
  const getPeriodBoundaries = (year: number): { start: Date; end: Date } => {
    switch (periodType) {
      case 'ytd':
        // Full year boundaries for booking pace comparison
        // Compare all bookings for the full year, filtered by when they were created
        return {
          start: new Date(year, 0, 1),    // Jan 1
          end: new Date(year, 11, 31),    // Dec 31
        };
      case 'monthly':
        return {
          start: new Date(year === currentYear ? selectedMonthYear : year - 1, selectedMonth, 1),
          end: endOfMonth(new Date(year === currentYear ? selectedMonthYear : year - 1, selectedMonth, 1)),
        };
      default:
        return {
          start: new Date(year, 0, 1),
          end: new Date(year, currentMonth, currentDate.getDate()),
        };
    }
  };

  // Fetch blocked dates from capacity_calendar
  const { data: capacityCalendar } = useQuery({
    queryKey: ['capacity-calendar-blocks', effectiveListingIds, periodType, selectedMonth, selectedMonthYear],
    queryFn: async () => {
      if (effectiveListingIds.length === 0) return [];

      const currentPeriod = getPeriodBoundaries(currentYear);
      const lastYearPeriod = periodType === 'monthly' 
        ? { start: new Date(selectedMonthYear - 1, selectedMonth, 1), end: endOfMonth(new Date(selectedMonthYear - 1, selectedMonth, 1)) }
        : getPeriodBoundaries(currentYear - 1);

      // Calculate the overall date range we need
      const startDate = format(lastYearPeriod.start, 'yyyy-MM-dd');
      const endDate = format(currentPeriod.end, 'yyyy-MM-dd');

      // Paginate to fetch all blocked dates
      const pageSize = 1000;
      let from = 0;
      const results: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from('capacity_calendar')
          .select('date, status, block_reason, listing_id')
          .in('listing_id', effectiveListingIds)
          .eq('block_reason', 'blocked')
          .eq('status', 'unavailable')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return results;
    },
    enabled: effectiveListingIds.length > 0,
  });

  // Calculate booked revenue for a period (actual + future bookings)
  // bookedAsOf: Only count reservations created on or before this date (for booking pace)
  const calculateBookedRevenue = (
    periodStart: Date,
    periodEnd: Date,
    reservationList: any[],
    bookedAsOf?: Date
  ): { revenue: number; nights: number } => {
    let totalRevenue = 0;
    let totalNights = 0;

    reservationList.forEach((r) => {
      if (!r.check_in || !r.check_out || !r.fare_accommodation_adjusted) return;
      if (!["confirmed", "checked_in", "checked_out"].includes(r.status)) return;
      if (r.source === "owner") return;

      // If bookedAsOf is provided, only include reservations created before that date
      // IMPORTANT: Skip reservations without created_at_guesty when using booking pace mode
      // This ensures we're comparing apples-to-apples (only reservations we know the booking date for)
      if (bookedAsOf) {
        if (!r.created_at_guesty) {
          return; // Skip - we don't know when this was booked, can't use for pace comparison
        }
        const createdAt = new Date(r.created_at_guesty);
        if (createdAt > bookedAsOf) {
          return; // Skip - this reservation was booked after the cutoff
        }
      }

      const checkIn = parseLocalDate(r.check_in)!;
      const checkOut = parseLocalDate(r.check_out)!;

      // Check if reservation overlaps with the period
      if (checkIn <= periodEnd && checkOut > periodStart) {
        // Count nights that fall within the period
        let nightsInPeriod = 0;
        let currentNight = new Date(checkIn);
        while (currentNight < checkOut) {
          if (currentNight >= periodStart && currentNight <= periodEnd) {
            nightsInPeriod++;
          }
          currentNight.setDate(currentNight.getDate() + 1);
        }

        // Allocate revenue proportionally based on nights in period
        const totalReservationNights = r.nights_count || 1;
        const revenueInPeriod =
          (parseFloat(r.fare_accommodation_adjusted) / totalReservationNights) * nightsInPeriod;

        totalRevenue += revenueInPeriod;
        totalNights += nightsInPeriod;
      }
    });

    return { revenue: totalRevenue, nights: totalNights };
  };

  // Calculate owner stay nights for a period
  const calculateOwnerNights = (
    periodStart: Date,
    periodEnd: Date,
    reservationList: any[],
    bookedAsOf?: Date
  ): number => {
    let totalNights = 0;

    reservationList.forEach((r) => {
      if (!r.check_in || !r.check_out) return;
      if (!["confirmed", "checked_in", "checked_out"].includes(r.status)) return;
      if (r.source !== "owner") return; // Only count owner stays

      // Apply bookedAsOf filter if provided
      if (bookedAsOf) {
        if (!r.created_at_guesty) return;
        const createdAt = new Date(r.created_at_guesty);
        if (createdAt > bookedAsOf) return;
      }

      const checkIn = parseLocalDate(r.check_in)!;
      const checkOut = parseLocalDate(r.check_out)!;

      // Check if reservation overlaps with the period
      if (checkIn <= periodEnd && checkOut > periodStart) {
        let currentNight = new Date(checkIn);
        while (currentNight < checkOut) {
          if (currentNight >= periodStart && currentNight <= periodEnd) {
            totalNights++;
          }
          currentNight.setDate(currentNight.getDate() + 1);
        }
      }
    });

    return totalNights;
  };

  // Calculate blocked nights from capacity calendar data
  const calculateBlockedNights = (periodStart: Date, periodEnd: Date): number => {
    if (!capacityCalendar || capacityCalendar.length === 0) return 0;

    return capacityCalendar.filter(day => {
      const date = parseLocalDate(day.date);
      if (!date) return false;
      return date >= periodStart && date <= periodEnd;
    }).length;
  };

  const calculatePacingMetrics = (): PacingMetrics => {
    const currentPeriod = getPeriodBoundaries(currentYear);
    const lastYearPeriod = getPeriodBoundaries(currentYear - 1);

    // For monthly mode, we need to adjust the last year period
    let adjustedLastYearPeriod = lastYearPeriod;
    if (periodType === 'monthly') {
      adjustedLastYearPeriod = {
        start: new Date(selectedMonthYear - 1, selectedMonth, 1),
        end: endOfMonth(new Date(selectedMonthYear - 1, selectedMonth, 1)),
      };
    }

    // For both YTD and monthly modes, use booking pace logic (filter by when bookings were created)
    // YTD: "Full year 2026 bookings as of today" vs "Full year 2025 bookings as of same date last year"
    // Monthly: "Feb 2026 bookings as of today" vs "Feb 2025 bookings as of same date last year"
    let currentCutoff: Date | undefined;
    let lastYearCutoff: Date | undefined;
    
    if (periodType === 'ytd' || periodType === 'monthly') {
      currentCutoff = currentDate;
      lastYearCutoff = new Date(currentYear - 1, currentMonth, currentDate.getDate());
    }

    const currentData = calculateBookedRevenue(
      currentPeriod.start,
      currentPeriod.end,
      reservations,
      currentCutoff
    );

    const lastData = calculateBookedRevenue(
      adjustedLastYearPeriod.start,
      adjustedLastYearPeriod.end,
      reservations,
      lastYearCutoff
    );

    const currentRevenue = currentData.revenue;
    const lastRevenue = lastData.revenue;
    const revenueChange =
      lastRevenue > 0 ? ((currentRevenue - lastRevenue) / lastRevenue) * 100 : 0;

    const currentNights = currentData.nights;
    const lastNights = lastData.nights;
    const nightsChange =
      lastNights > 0 ? ((currentNights - lastNights) / lastNights) * 100 : 0;

    // Calculate total days in period for occupancy
    const getTotalDays = (start: Date, end: Date) => {
      return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    };

    // Account for multiple properties in groups - multiply days by number of listings
    const propertyCount = effectiveListingIds.length || 1;
    const currentTotalDays = getTotalDays(currentPeriod.start, currentPeriod.end) * propertyCount;
    const lastTotalDays = getTotalDays(adjustedLastYearPeriod.start, adjustedLastYearPeriod.end) * propertyCount;

    // Standard Occupancy (guest nights / total available nights across all properties)
    const currentOccupancy =
      currentTotalDays > 0 ? (currentNights / currentTotalDays) * 100 : 0;
    const lastOccupancy =
      lastTotalDays > 0 ? (lastNights / lastTotalDays) * 100 : 0;
    const occupancyChange =
      lastOccupancy > 0
        ? ((currentOccupancy - lastOccupancy) / lastOccupancy) * 100
        : 0;

    // Calculate owner nights and blocked nights for adjusted occupancy
    const currentOwnerNights = calculateOwnerNights(currentPeriod.start, currentPeriod.end, reservations, currentCutoff);
    const lastOwnerNights = calculateOwnerNights(adjustedLastYearPeriod.start, adjustedLastYearPeriod.end, reservations, lastYearCutoff);

    const currentBlockedNights = calculateBlockedNights(currentPeriod.start, currentPeriod.end);
    const lastBlockedNights = calculateBlockedNights(adjustedLastYearPeriod.start, adjustedLastYearPeriod.end);

    // Bookable days = Total days - Owner stays - Blocked days
    const currentBookableDays = Math.max(0, currentTotalDays - currentOwnerNights - currentBlockedNights);
    const lastBookableDays = Math.max(0, lastTotalDays - lastOwnerNights - lastBlockedNights);

    // Adjusted Occupancy = Guest nights / Bookable days (capped at 100%)
    const currentAdjustedOccupancy = currentBookableDays > 0 
      ? Math.min(100, (currentNights / currentBookableDays) * 100) 
      : 0;
    const lastAdjustedOccupancy = lastBookableDays > 0 
      ? Math.min(100, (lastNights / lastBookableDays) * 100) 
      : 0;
    const adjustedOccupancyChange = lastAdjustedOccupancy > 0
      ? ((currentAdjustedOccupancy - lastAdjustedOccupancy) / lastAdjustedOccupancy) * 100
      : 0;

    // Calculate RevPAR (Revenue / Total Available Nights)
    const currentRevPAR = currentTotalDays > 0 ? currentRevenue / currentTotalDays : 0;
    const lastRevPAR = lastTotalDays > 0 ? lastRevenue / lastTotalDays : 0;
    const revPARChange =
      lastRevPAR > 0 ? ((currentRevPAR - lastRevPAR) / lastRevPAR) * 100 : 0;

    return {
      occupancy: {
        current: currentOccupancy,
        last: lastOccupancy,
        change: occupancyChange,
      },
      adjustedOccupancy: {
        current: currentAdjustedOccupancy,
        last: lastAdjustedOccupancy,
        change: adjustedOccupancyChange,
      },
      revenue: { current: currentRevenue, last: lastRevenue, change: revenueChange },
      revPAR: { current: currentRevPAR, last: lastRevPAR, change: revPARChange },
      nights: { current: currentNights, last: lastNights, change: nightsChange },
      bookableDays: { current: currentBookableDays, last: lastBookableDays },
    };
  };

  const metrics = calculatePacingMetrics();

  // Calculate monthly data for the table
  const monthlyData = useMemo(() => {
    const data: Array<{
      month: string;
      monthIndex: number;
      year: number;
      currentRevenue: number;
      lastRevenue: number;
      revenueChange: number;
      currentNights: number;
      lastNights: number;
      nightsChange: number;
      currentOccupancy: number;
      lastOccupancy: number;
      occupancyChange: number;
      currentRevPAR: number;
      lastRevPAR: number;
      revPARChange: number;
    }> = [];

    // Generate data for 12 months from current month
    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(currentYear, currentMonth + i, 1);
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      
      const periodStart = startOfMonth(monthDate);
      const periodEnd = endOfMonth(monthDate);
      const lastYearPeriodStart = new Date(year - 1, month, 1);
      const lastYearPeriodEnd = endOfMonth(lastYearPeriodStart);

      const currentCutoff = currentDate;
      const lastYearCutoff = new Date(currentYear - 1, currentMonth, currentDate.getDate());

      const currentData = calculateBookedRevenue(periodStart, periodEnd, reservations, currentCutoff);
      const lastData = calculateBookedRevenue(lastYearPeriodStart, lastYearPeriodEnd, reservations, lastYearCutoff);

      // Account for multiple properties in groups - multiply days by number of listings
      const numberOfProperties = effectiveListingIds.length || 1;
      const totalDaysCurrent = getDaysInMonth(monthDate) * numberOfProperties;
      const totalDaysLast = getDaysInMonth(lastYearPeriodStart) * numberOfProperties;

      const currentOccupancy = totalDaysCurrent > 0 ? (currentData.nights / totalDaysCurrent) * 100 : 0;
      const lastOccupancy = totalDaysLast > 0 ? (lastData.nights / totalDaysLast) * 100 : 0;

      const currentRevPAR = totalDaysCurrent > 0 ? currentData.revenue / totalDaysCurrent : 0;
      const lastRevPAR = totalDaysLast > 0 ? lastData.revenue / totalDaysLast : 0;

      data.push({
        month: format(monthDate, 'MMM yyyy'),
        monthIndex: month,
        year: year,
        currentRevenue: currentData.revenue,
        lastRevenue: lastData.revenue,
        revenueChange: lastData.revenue > 0 ? ((currentData.revenue - lastData.revenue) / lastData.revenue) * 100 : 0,
        currentNights: currentData.nights,
        lastNights: lastData.nights,
        nightsChange: lastData.nights > 0 ? ((currentData.nights - lastData.nights) / lastData.nights) * 100 : 0,
        currentOccupancy,
        lastOccupancy,
        occupancyChange: lastOccupancy > 0 ? ((currentOccupancy - lastOccupancy) / lastOccupancy) * 100 : 0,
        currentRevPAR,
        lastRevPAR,
        revPARChange: lastRevPAR > 0 ? ((currentRevPAR - lastRevPAR) / lastRevPAR) * 100 : 0,
      });
    }

    return data;
  }, [reservations, currentYear, currentMonth, currentDate, effectiveListingIds.length]);

  // Get period description for display
  const getPeriodDescription = (): string => {
    switch (periodType) {
      case 'ytd':
        return `Full Year ${currentYear} bookings as of ${format(currentDate, 'MMM d')} vs same point ${currentYear - 1}`;
      case 'monthly':
        const monthDate = new Date(selectedMonthYear, selectedMonth, 1);
        return `${format(monthDate, 'MMMM yyyy')} bookings as of ${format(currentDate, 'MMM d')} vs same point last year`;
      default:
        return '';
    }
  };

  const getComparisonLabel = (): { current: string; previous: string } => {
    switch (periodType) {
      case 'ytd':
        return { current: String(currentYear), previous: String(currentYear - 1) };
      case 'monthly':
        return {
          current: format(new Date(selectedMonthYear, selectedMonth, 1), 'MMM yyyy'),
          previous: format(new Date(selectedMonthYear - 1, selectedMonth, 1), 'MMM yyyy'),
        };
      default:
        return { current: '', previous: '' };
    }
  };

  const labels = getComparisonLabel();

  const MetricCard = ({
    title,
    icon: Icon,
    current,
    last,
    change,
    format: formatFn,
    tooltip,
  }: {
    title: string;
    icon: any;
    current: number;
    last: number;
    change: number;
    format: (val: number) => string;
    tooltip?: string;
  }) => {
    const isPositive = change >= 0;
    const TrendIcon = isPositive ? TrendingUp : TrendingDown;

    const cardContent = (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <div className="text-2xl font-bold">{formatFn(current)}</div>
            <div className="text-xs text-muted-foreground">
              {labels.current} vs {formatFn(last)} ({labels.previous})
            </div>
          </div>
          <div
            className={`flex items-center gap-1 text-sm font-medium ${
              isPositive
                ? "text-status-success"
                : "text-status-danger"
            }`}
          >
            <TrendIcon className="h-4 w-4" />
            {Math.abs(change).toFixed(1)}% {isPositive ? "ahead" : "behind"}
          </div>
        </CardContent>
      </Card>
    );

    if (tooltip) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {cardContent}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p>{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return cardContent;
  };

  const handleMonthChange = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    setSelectedMonth(month);
    setSelectedMonthYear(year);
  };

  // Check if we have listing data for adjusted occupancy
  const hasListingData = effectiveListingIds.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold tracking-tight">Pacing Report</h3>
          <p className="text-muted-foreground mt-1">{getPeriodDescription()}</p>
        </div>

        <div className="flex items-center gap-3">
          <ToggleGroup
            type="single"
            value={periodType}
            onValueChange={(value) => value && setPeriodType(value as PeriodType)}
            className="bg-muted/50 p-1 rounded-lg"
          >
            <ToggleGroupItem value="ytd" className="text-xs px-3">
              YTD
            </ToggleGroupItem>
            <ToggleGroupItem value="monthly" className="text-xs px-3">
              Monthly
            </ToggleGroupItem>
          </ToggleGroup>

          {periodType === 'monthly' && (
            <Select
              value={`${selectedMonthYear}-${selectedMonth}`}
              onValueChange={handleMonthChange}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Occupancy Rate"
          icon={Percent}
          current={metrics.occupancy.current}
          last={metrics.occupancy.last}
          change={metrics.occupancy.change}
          format={(val) => `${val.toFixed(1)}%`}
          tooltip="Standard occupancy: Guest booked nights ÷ Total calendar days"
        />
        {hasListingData && (
          <MetricCard
            title="Adjusted Occupancy"
            icon={Target}
            current={metrics.adjustedOccupancy.current}
            last={metrics.adjustedOccupancy.last}
            change={metrics.adjustedOccupancy.change}
            format={(val) => `${val.toFixed(1)}%`}
            tooltip="Adjusted occupancy: Guest booked nights ÷ Bookable days (excludes owner stays and blocked dates)"
          />
        )}
        <MetricCard
          title="Booked Revenue"
          icon={DollarSign}
          current={metrics.revenue.current}
          last={metrics.revenue.last}
          change={metrics.revenue.change}
          format={(val) =>
            `$${val.toLocaleString("en-US", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}`
          }
        />
        <MetricCard
          title="RevPAR"
          icon={TrendingUp}
          current={metrics.revPAR.current}
          last={metrics.revPAR.last}
          change={metrics.revPAR.change}
          format={(val) =>
            `$${val.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`
          }
        />
        <MetricCard
          title="Nights Booked"
          icon={Moon}
          current={metrics.nights.current}
          last={metrics.nights.last}
          change={metrics.nights.change}
          format={(val) => val.toFixed(0)}
        />
      </div>

      {/* Monthly Data Table - Only visible in monthly mode */}
      {periodType === 'monthly' && (
        <Collapsible open={isTableOpen} onOpenChange={setIsTableOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 w-full justify-start p-0 h-auto hover:bg-transparent">
              {isTableOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">Monthly Breakdown</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">vs LY</TableHead>
                        <TableHead className="text-right">Nights</TableHead>
                        <TableHead className="text-right">vs LY</TableHead>
                        <TableHead className="text-right">Occupancy</TableHead>
                        <TableHead className="text-right">vs LY</TableHead>
                        <TableHead className="text-right">RevPAR</TableHead>
                        <TableHead className="text-right">vs LY</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyData.map((row) => (
                        <TableRow 
                          key={row.month}
                          className={row.month === format(new Date(selectedMonthYear, selectedMonth, 1), 'MMM yyyy') ? 'bg-muted/50' : ''}
                        >
                          <TableCell className="font-medium">{row.month}</TableCell>
                          <TableCell className="text-right">
                            ${row.currentRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className={`text-right ${row.revenueChange >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                            {row.revenueChange >= 0 ? '+' : ''}{row.revenueChange.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">{row.currentNights}</TableCell>
                          <TableCell className={`text-right ${row.nightsChange >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                            {row.nightsChange >= 0 ? '+' : ''}{row.nightsChange.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">{row.currentOccupancy.toFixed(1)}%</TableCell>
                          <TableCell className={`text-right ${row.occupancyChange >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                            {row.occupancyChange >= 0 ? '+' : ''}{row.occupancyChange.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">
                            ${row.currentRevPAR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className={`text-right ${row.revPARChange >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                            {row.revPARChange >= 0 ? '+' : ''}{row.revPARChange.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

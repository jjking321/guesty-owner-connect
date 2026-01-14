import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Moon, Percent } from "lucide-react";
import { format, startOfMonth, endOfMonth, getDaysInMonth } from "date-fns";
import { parseLocalDate } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PacingReportProps {
  reservations: any[];
}

interface PacingMetrics {
  occupancy: { current: number; last: number; change: number };
  revenue: { current: number; last: number; change: number };
  revPAR: { current: number; last: number; change: number };
  nights: { current: number; last: number; change: number };
}

type PeriodType = 'ytd' | 'monthly';

export function PacingReport({ reservations }: PacingReportProps) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const [periodType, setPeriodType] = useState<PeriodType>('ytd');
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedMonthYear, setSelectedMonthYear] = useState<number>(currentYear);

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
      if (bookedAsOf && r.created_at_guesty) {
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

    const currentTotalDays = getTotalDays(currentPeriod.start, currentPeriod.end);
    const lastTotalDays = getTotalDays(adjustedLastYearPeriod.start, adjustedLastYearPeriod.end);

    const currentOccupancy =
      currentTotalDays > 0 ? (currentNights / currentTotalDays) * 100 : 0;
    const lastOccupancy =
      lastTotalDays > 0 ? (lastNights / lastTotalDays) * 100 : 0;
    const occupancyChange =
      lastOccupancy > 0
        ? ((currentOccupancy - lastOccupancy) / lastOccupancy) * 100
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
      revenue: { current: currentRevenue, last: lastRevenue, change: revenueChange },
      revPAR: { current: currentRevPAR, last: lastRevPAR, change: revPARChange },
      nights: { current: currentNights, last: lastNights, change: nightsChange },
    };
  };

  const metrics = calculatePacingMetrics();

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
  }: {
    title: string;
    icon: any;
    current: number;
    last: number;
    change: number;
    format: (val: number) => string;
  }) => {
    const isPositive = change >= 0;
    const TrendIcon = isPositive ? TrendingUp : TrendingDown;

    return (
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
                ? "text-green-600 dark:text-green-500"
                : "text-red-600 dark:text-red-500"
            }`}
          >
            <TrendIcon className="h-4 w-4" />
            {Math.abs(change).toFixed(1)}% {isPositive ? "ahead" : "behind"}
          </div>
        </CardContent>
      </Card>
    );
  };

  const handleMonthChange = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    setSelectedMonth(month);
    setSelectedMonthYear(year);
  };

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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Occupancy Rate"
          icon={Percent}
          current={metrics.occupancy.current}
          last={metrics.occupancy.last}
          change={metrics.occupancy.change}
          format={(val) => `${val.toFixed(1)}%`}
        />
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
    </div>
  );
}

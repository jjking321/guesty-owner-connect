import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Moon, Percent } from "lucide-react";
import { format, parseISO } from "date-fns";

interface PacingReportProps {
  reservations: any[];
}

interface PacingMetrics {
  ytdOccupancy: { current: number; last: number; change: number };
  ytdRevenue: { current: number; last: number; change: number };
  ytdRevPAR: { current: number; last: number; change: number };
  ytdNights: { current: number; last: number; change: number };
}

export function PacingReport({ reservations }: PacingReportProps) {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const lastYear = currentYear - 1;
  const currentMonth = currentDate.getMonth(); // 0-indexed

  // Helper function to calculate night-based revenue for a specific year/month range
  const calculateNightBasedRevenue = (
    targetYear: number,
    endMonth: number,
    endDay: number,
    reservationList: any[]
  ): { revenue: number; nights: number } => {
    let totalRevenue = 0;
    let totalNights = 0;
    
    reservationList.forEach(r => {
      if (!r.check_in || !r.check_out || !r.fare_accommodation_adjusted) return;
      if (!["confirmed", "checked_in", "checked_out"].includes(r.status)) return;
      if (r.source === 'owner') return;
      
      const revenueTotal = parseFloat(r.fare_accommodation_adjusted || 0);
      const nightsCount = r.nights_count || 0;
      if (nightsCount === 0) return;
      
      const revenuePerNight = revenueTotal / nightsCount;
      const checkIn = parseISO(r.check_in);
      const checkOut = parseISO(r.check_out);
      const cutoffDate = new Date(targetYear, endMonth, endDay);
      
      // Iterate through each night
      let currentNight = new Date(checkIn);
      while (currentNight < checkOut) {
        // Only count nights in target year up to cutoff date
        if (currentNight.getFullYear() === targetYear && currentNight < cutoffDate) {
          totalRevenue += revenuePerNight;
          totalNights += 1;
        }
        currentNight.setDate(currentNight.getDate() + 1);
      }
    });
    
    return { revenue: totalRevenue, nights: totalNights };
  };

  const calculatePacingMetrics = (): PacingMetrics => {
    const today = new Date();
    
    // Calculate YTD revenue and nights using night-based allocation
    const currentYearData = calculateNightBasedRevenue(
      currentYear,
      today.getMonth(),
      today.getDate(),
      reservations
    );
    
    const lastYearData = calculateNightBasedRevenue(
      lastYear,
      today.getMonth(),
      today.getDate(),
      reservations
    );

    const currentRevenue = currentYearData.revenue;
    const lastRevenue = lastYearData.revenue;
    const revenueChange = lastRevenue > 0 ? ((currentRevenue - lastRevenue) / lastRevenue) * 100 : 0;

    const currentNights = currentYearData.nights;
    const lastNights = lastYearData.nights;
    const nightsChange = lastNights > 0 ? ((currentNights - lastNights) / lastNights) * 100 : 0;

    // Calculate occupancy (nights booked / total available nights in YTD)
    const daysYTD = (currentMonth + 1) * 30; // Approximate days in YTD
    const currentOccupancy = daysYTD > 0 ? (currentNights / daysYTD) * 100 : 0;
    const lastOccupancy = daysYTD > 0 ? (lastNights / daysYTD) * 100 : 0;
    const occupancyChange = lastOccupancy > 0 ? ((currentOccupancy - lastOccupancy) / lastOccupancy) * 100 : 0;

    // Calculate RevPAR (Revenue / Total Available Nights)
    const currentRevPAR = daysYTD > 0 ? currentRevenue / daysYTD : 0;
    const lastRevPAR = daysYTD > 0 ? lastRevenue / daysYTD : 0;
    const revPARChange = lastRevPAR > 0 ? ((currentRevPAR - lastRevPAR) / lastRevPAR) * 100 : 0;

    return {
      ytdOccupancy: { current: currentOccupancy, last: lastOccupancy, change: occupancyChange },
      ytdRevenue: { current: currentRevenue, last: lastRevenue, change: revenueChange },
      ytdRevPAR: { current: currentRevPAR, last: lastRevPAR, change: revPARChange },
      ytdNights: { current: currentNights, last: lastNights, change: nightsChange },
    };
  };

  const metrics = calculatePacingMetrics();

  const MetricCard = ({ 
    title, 
    icon: Icon, 
    current, 
    last, 
    change, 
    format: formatFn 
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
              YTD {currentYear} vs {formatFn(last)} ({lastYear})
            </div>
          </div>
          <div className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
            <TrendIcon className="h-4 w-4" />
            {Math.abs(change).toFixed(1)}% {isPositive ? 'ahead' : 'behind'}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold tracking-tight">Pacing Report</h3>
        <p className="text-muted-foreground mt-1">
          Year-to-date performance compared to same period last year (through {format(currentDate, 'MMMM yyyy')})
        </p>
      </div>

      {/* YTD Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Occupancy Rate"
          icon={Percent}
          current={metrics.ytdOccupancy.current}
          last={metrics.ytdOccupancy.last}
          change={metrics.ytdOccupancy.change}
          format={(val) => `${val.toFixed(1)}%`}
        />
        <MetricCard
          title="Total Revenue"
          icon={DollarSign}
          current={metrics.ytdRevenue.current}
          last={metrics.ytdRevenue.last}
          change={metrics.ytdRevenue.change}
          format={(val) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        />
        <MetricCard
          title="RevPAR"
          icon={TrendingUp}
          current={metrics.ytdRevPAR.current}
          last={metrics.ytdRevPAR.last}
          change={metrics.ytdRevPAR.change}
          format={(val) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        />
        <MetricCard
          title="Nights Booked"
          icon={Moon}
          current={metrics.ytdNights.current}
          last={metrics.ytdNights.last}
          change={metrics.ytdNights.change}
          format={(val) => val.toString()}
        />
      </div>
    </div>
  );
}

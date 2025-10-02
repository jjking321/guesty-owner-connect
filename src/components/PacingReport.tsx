import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, Calendar, Moon, ArrowRight } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, parseISO, startOfYear, endOfYear, isBefore, isAfter } from "date-fns";
import { useState } from "react";

interface PacingReportProps {
  reservations: any[];
}

interface PacingMetrics {
  ytdBookings: { current: number; last: number; change: number };
  ytdRevenue: { current: number; last: number; change: number };
  ytdNights: { current: number; last: number; change: number };
  avgBookingValue: { current: number; last: number; change: number };
}

interface CumulativeDataPoint {
  month: string;
  currentYear: number;
  lastYear: number;
}

export function PacingReport({ reservations }: PacingReportProps) {
  const [activeTab, setActiveTab] = useState<'occupancy' | 'revenue'>('occupancy');
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const lastYear = currentYear - 1;
  const currentMonth = currentDate.getMonth(); // 0-indexed

  const calculatePacingMetrics = (): PacingMetrics => {
    const currentYearStart = startOfYear(new Date(currentYear, 0, 1));
    const lastYearStart = startOfYear(new Date(lastYear, 0, 1));
    
    // Filter reservations for current year YTD
    const currentYearReservations = reservations.filter((r) => {
      if (!r.check_in) return false;
      const checkIn = parseISO(r.check_in);
      return (
        checkIn.getFullYear() === currentYear &&
        checkIn.getMonth() <= currentMonth
      );
    });

    // Filter reservations for last year same period
    const lastYearReservations = reservations.filter((r) => {
      if (!r.check_in) return false;
      const checkIn = parseISO(r.check_in);
      return (
        checkIn.getFullYear() === lastYear &&
        checkIn.getMonth() <= currentMonth
      );
    });

    // Calculate metrics
    const currentBookings = currentYearReservations.length;
    const lastBookings = lastYearReservations.length;
    const bookingsChange = lastBookings > 0 ? ((currentBookings - lastBookings) / lastBookings) * 100 : 0;

    const currentRevenue = currentYearReservations.reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
    const lastRevenue = lastYearReservations.reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
    const revenueChange = lastRevenue > 0 ? ((currentRevenue - lastRevenue) / lastRevenue) * 100 : 0;

    const currentNights = currentYearReservations.reduce((sum, r) => sum + (r.nights_count || 0), 0);
    const lastNights = lastYearReservations.reduce((sum, r) => sum + (r.nights_count || 0), 0);
    const nightsChange = lastNights > 0 ? ((currentNights - lastNights) / lastNights) * 100 : 0;

    const currentAvgValue = currentBookings > 0 ? currentRevenue / currentBookings : 0;
    const lastAvgValue = lastBookings > 0 ? lastRevenue / lastBookings : 0;
    const avgValueChange = lastAvgValue > 0 ? ((currentAvgValue - lastAvgValue) / lastAvgValue) * 100 : 0;

    return {
      ytdBookings: { current: currentBookings, last: lastBookings, change: bookingsChange },
      ytdRevenue: { current: currentRevenue, last: lastRevenue, change: revenueChange },
      ytdNights: { current: currentNights, last: lastNights, change: nightsChange },
      avgBookingValue: { current: currentAvgValue, last: lastAvgValue, change: avgValueChange },
    };
  };

  const calculateCumulativeOccupancy = (): CumulativeDataPoint[] => {
    const data: CumulativeDataPoint[] = [];
    
    for (let month = 0; month <= currentMonth; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      
      // Calculate total days from Jan to current month
      let totalDays = 0;
      for (let m = 0; m <= month; m++) {
        totalDays += new Date(currentYear, m + 1, 0).getDate();
      }
      
      // Current year booked nights YTD
      const currentYearNights = reservations
        .filter((r) => {
          if (!r.check_in) return false;
          const checkIn = parseISO(r.check_in);
          return checkIn.getFullYear() === currentYear && checkIn.getMonth() <= month;
        })
        .reduce((sum, r) => sum + (r.nights_count || 0), 0);
      
      // Last year booked nights YTD
      const lastYearNights = reservations
        .filter((r) => {
          if (!r.check_in) return false;
          const checkIn = parseISO(r.check_in);
          return checkIn.getFullYear() === lastYear && checkIn.getMonth() <= month;
        })
        .reduce((sum, r) => sum + (r.nights_count || 0), 0);
      
      const currentYearOccupancy = totalDays > 0 ? (currentYearNights / totalDays) * 100 : 0;
      const lastYearOccupancy = totalDays > 0 ? (lastYearNights / totalDays) * 100 : 0;
      
      data.push({
        month: monthName,
        currentYear: Math.round(currentYearOccupancy * 10) / 10,
        lastYear: Math.round(lastYearOccupancy * 10) / 10,
      });
    }

    return data;
  };

  const calculateCumulativeRevenue = (): CumulativeDataPoint[] => {
    const data: CumulativeDataPoint[] = [];
    
    for (let month = 0; month <= currentMonth; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      
      // Current year revenue YTD
      const currentYearRevenue = reservations
        .filter((r) => {
          if (!r.check_in) return false;
          const checkIn = parseISO(r.check_in);
          return checkIn.getFullYear() === currentYear && checkIn.getMonth() <= month;
        })
        .reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
      
      // Last year revenue YTD
      const lastYearRevenue = reservations
        .filter((r) => {
          if (!r.check_in) return false;
          const checkIn = parseISO(r.check_in);
          return checkIn.getFullYear() === lastYear && checkIn.getMonth() <= month;
        })
        .reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
      
      data.push({
        month: monthName,
        currentYear: Math.round(currentYearRevenue),
        lastYear: Math.round(lastYearRevenue),
      });
    }

    return data;
  };

  const metrics = calculatePacingMetrics();
  const occupancyData = calculateCumulativeOccupancy();
  const revenueData = calculateCumulativeRevenue();

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

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const formatValue = (val: number) => {
      if (activeTab === 'occupancy') {
        return `${val}%`;
      }
      return `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    };

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
        <p className="font-medium text-sm mb-2">{payload[0].payload.month}</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-muted-foreground">{currentYear}:</span>
            <span className="font-medium">{formatValue(payload[0].value)}</span>
          </div>
          {payload[1] && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-secondary" />
              <span className="text-muted-foreground">{lastYear}:</span>
              <span className="font-medium">{formatValue(payload[1].value)}</span>
            </div>
          )}
        </div>
      </div>
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
          title="Total Bookings"
          icon={Calendar}
          current={metrics.ytdBookings.current}
          last={metrics.ytdBookings.last}
          change={metrics.ytdBookings.change}
          format={(val) => val.toString()}
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
          title="Nights Booked"
          icon={Moon}
          current={metrics.ytdNights.current}
          last={metrics.ytdNights.last}
          change={metrics.ytdNights.change}
          format={(val) => val.toString()}
        />
        <MetricCard
          title="Avg Booking Value"
          icon={ArrowRight}
          current={metrics.avgBookingValue.current}
          last={metrics.avgBookingValue.last}
          change={metrics.avgBookingValue.change}
          format={(val) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        />
      </div>

      {/* Cumulative Pacing Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Year-to-Date Performance Trends</CardTitle>
          <CardDescription>
            Cumulative comparison: {currentYear} vs {lastYear}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'occupancy' | 'revenue')}>
            <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
              <TabsTrigger value="occupancy">Occupancy %</TabsTrigger>
              <TabsTrigger value="revenue">Revenue $</TabsTrigger>
            </TabsList>
            
            <TabsContent value="occupancy">
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={occupancyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="month" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    label={{ value: 'Occupancy %', angle: -90, position: 'insideLeft', style: { fill: 'hsl(var(--muted-foreground))' } }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="currentYear"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={{ fill: "hsl(var(--primary))", r: 5 }}
                    activeDot={{ r: 7 }}
                    name={`${currentYear}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="lastYear"
                    stroke="hsl(var(--secondary))"
                    strokeWidth={3}
                    dot={{ fill: "hsl(var(--secondary))", r: 5 }}
                    activeDot={{ r: 7 }}
                    name={`${lastYear}`}
                  />
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
            
            <TabsContent value="revenue">
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={revenueData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="month" 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis 
                    className="text-xs"
                    tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    label={{ value: 'Revenue ($)', angle: -90, position: 'insideLeft', style: { fill: 'hsl(var(--muted-foreground))' } }}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="currentYear"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={{ fill: "hsl(var(--primary))", r: 5 }}
                    activeDot={{ r: 7 }}
                    name={`${currentYear}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="lastYear"
                    stroke="hsl(var(--secondary))"
                    strokeWidth={3}
                    dot={{ fill: "hsl(var(--secondary))", r: 5 }}
                    activeDot={{ r: 7 }}
                    name={`${lastYear}`}
                  />
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

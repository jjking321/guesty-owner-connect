import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, Calendar, Moon, Percent } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, parseISO, startOfYear, endOfYear, isBefore, isAfter } from "date-fns";
import { useState } from "react";

interface PacingReportProps {
  reservations: any[];
}

interface PacingMetrics {
  ytdOccupancy: { current: number; last: number; change: number };
  ytdRevenue: { current: number; last: number; change: number };
  ytdRevPAR: { current: number; last: number; change: number };
  ytdNights: { current: number; last: number; change: number };
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
    const today = new Date();
    const currentYearStart = startOfYear(new Date(currentYear, 0, 1));
    const lastYearStart = startOfYear(new Date(lastYear, 0, 1));
    
    // Filter reservations for current year YTD (check-out YTD up to today)
    const currentYearReservations = reservations.filter((r) => {
      if (!r.check_out) return false;
      if (!["confirmed", "checked_out"].includes(r.status)) return false;
      const checkOut = parseISO(r.check_out);
      const todayThisYear = new Date(currentYear, today.getMonth(), today.getDate());
      return (
        checkOut.getFullYear() === currentYear &&
        checkOut <= todayThisYear
      );
    });

    // Filter reservations for last year same period (check-out YTD up to same date last year)
    const lastYearReservations = reservations.filter((r) => {
      if (!r.check_out) return false;
      if (!["confirmed", "checked_out"].includes(r.status)) return false;
      const checkOut = parseISO(r.check_out);
      const todayLastYear = new Date(lastYear, today.getMonth(), today.getDate());
      return (
        checkOut.getFullYear() === lastYear &&
        checkOut <= todayLastYear
      );
    });

    // Calculate basic metrics
    const currentRevenue = currentYearReservations.reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
    const lastRevenue = lastYearReservations.reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
    const revenueChange = lastRevenue > 0 ? ((currentRevenue - lastRevenue) / lastRevenue) * 100 : 0;

    const currentNights = currentYearReservations.reduce((sum, r) => sum + (r.nights_count || 0), 0);
    const lastNights = lastYearReservations.reduce((sum, r) => sum + (r.nights_count || 0), 0);
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

  const calculateCumulativeOccupancy = (): CumulativeDataPoint[] => {
    const data: CumulativeDataPoint[] = [];
    const today = new Date();
    
    // Start from 12 months ago
    const startDate = new Date(today.getFullYear(), today.getMonth() - 12, 1);
    
    // Generate 18 months of data (past 12 + next 6)
    for (let i = 0; i < 18; i++) {
      const targetDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const monthName = format(targetDate, 'MMM yy');
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      
      // Calculate days in this month
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      
      // Current period booked nights for this specific month (check-in in this month, confirmed by today)
      const currentNights = reservations
        .filter((r) => {
          if (!r.check_in || !r.created_at_guesty) return false;
          if (!["confirmed", "checked_in", "checked_out"].includes(r.status)) return false;
          const checkIn = parseISO(r.check_in);
          const createdAt = parseISO(r.created_at_guesty);
          const todayThisYear = new Date(year, today.getMonth(), today.getDate());
          return checkIn.getFullYear() === year && 
                 checkIn.getMonth() === month &&
                 createdAt <= todayThisYear;
        })
        .reduce((sum, r) => sum + (r.nights_count || 0), 0);
      
      // Last year same month booked nights (check-in in same month last year, confirmed by same date last year)
      const lastYearNights = reservations
        .filter((r) => {
          if (!r.check_in || !r.created_at_guesty) return false;
          if (!["confirmed", "checked_in", "checked_out"].includes(r.status)) return false;
          const checkIn = parseISO(r.check_in);
          const createdAt = parseISO(r.created_at_guesty);
          const todayLastYear = new Date(year - 1, today.getMonth(), today.getDate());
          return checkIn.getFullYear() === year - 1 && 
                 checkIn.getMonth() === month &&
                 createdAt <= todayLastYear;
        })
        .reduce((sum, r) => sum + (r.nights_count || 0), 0);
      
      const currentOccupancy = daysInMonth > 0 ? (currentNights / daysInMonth) * 100 : 0;
      const lastYearOccupancy = daysInMonth > 0 ? (lastYearNights / daysInMonth) * 100 : 0;
      
      data.push({
        month: monthName,
        currentYear: Math.round(currentOccupancy * 10) / 10,
        lastYear: Math.round(lastYearOccupancy * 10) / 10,
      });
    }

    return data;
  };

  const calculateCumulativeRevenue = (): CumulativeDataPoint[] => {
    const data: CumulativeDataPoint[] = [];
    const today = new Date();
    
    // Start from 12 months ago
    const startDate = new Date(today.getFullYear(), today.getMonth() - 12, 1);
    
    // Generate 18 months of data (past 12 + next 6)
    for (let i = 0; i < 18; i++) {
      const targetDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const monthName = format(targetDate, 'MMM yy');
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      
      // Current period revenue for this specific month (check-in in this month, confirmed by today)
      const currentRevenue = reservations
        .filter((r) => {
          if (!r.check_in || !r.created_at_guesty) return false;
          if (!["confirmed", "checked_in", "checked_out"].includes(r.status)) return false;
          const checkIn = parseISO(r.check_in);
          const createdAt = parseISO(r.created_at_guesty);
          const todayThisYear = new Date(year, today.getMonth(), today.getDate());
          return checkIn.getFullYear() === year && 
                 checkIn.getMonth() === month &&
                 createdAt <= todayThisYear;
        })
        .reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
      
      // Last year same month revenue (check-in in same month last year, confirmed by same date last year)
      const lastYearRevenue = reservations
        .filter((r) => {
          if (!r.check_in || !r.created_at_guesty) return false;
          if (!["confirmed", "checked_in", "checked_out"].includes(r.status)) return false;
          const checkIn = parseISO(r.check_in);
          const createdAt = parseISO(r.created_at_guesty);
          const todayLastYear = new Date(year - 1, today.getMonth(), today.getDate());
          return checkIn.getFullYear() === year - 1 && 
                 checkIn.getMonth() === month &&
                 createdAt <= todayLastYear;
        })
        .reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);
      
      data.push({
        month: monthName,
        currentYear: Math.round(currentRevenue),
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

      {/* Cumulative Pacing Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Rolling 18-Month Performance</CardTitle>
          <CardDescription>
            Past 12 months + Next 6 months: Current vs Last Year
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

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Target, TrendingUp, TrendingDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { format, parseISO, getDaysInMonth, addDays } from "date-fns";

interface GoalsComparisonProps {
  listingId?: string | null;
  reservations: any[];
  goals?: any[];
  forecasts?: any[];
}

interface GoalData {
  month: string;
  actual: number;
  budget: number;
  projection: number;
  goal: number;
  forecastP25?: number;
  forecastP50?: number;
  forecastP75?: number;
  compsetAverage?: number;
  lastYearActual?: number;
}

interface TrendDataPoint {
  month: string;
  monthKey: string;
  currentYear: number;
  lastYear: number;
}

interface CompsetMonthlyAverage {
  month: string;
  revenue: number;
  adr: number;
  occupancy: number;
  revpar: number;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GoalsComparison({ listingId, reservations, goals: externalGoals, forecasts: externalForecasts }: GoalsComparisonProps) {
  const [activeMetric, setActiveMetric] = useState<'revenue' | 'occupancy' | 'revpar'>('revenue');
  const [activeTab, setActiveTab] = useState<'monthly' | 'cumulative'>('monthly');
  const [monthlyData, setMonthlyData] = useState<GoalData[]>([]);
  const [cumulativeData, setCumulativeData] = useState<GoalData[]>([]);
  const [showForecast, setShowForecast] = useState(false);
  const [showGoals, setShowGoals] = useState(true);
  const [showCompset, setShowCompset] = useState(false);
  const [showComparison, setShowComparison] = useState(true);
  const [compsetMonthlyAverages, setCompsetMonthlyAverages] = useState<CompsetMonthlyAverage[]>([]);
  const { toast } = useToast();

  const currentYear = new Date().getFullYear();
  
  // For single property (listingId provided), use internal year selection
  // For group/owner view (externalGoals provided), derive from external data
  const [selectedYear, setSelectedYear] = useState(currentYear);
  
  // When external goals are provided, derive year from them
  const year = externalGoals ? (externalGoals[0]?.year || currentYear) : selectedYear;
  
  // Available years for selection
  const availableYears = [2024, 2025, 2026];

  // Calculate year-over-year occupancy data
  const occupancyData = useMemo((): TrendDataPoint[] => {
    if (reservations.length === 0) return [];

    const lastYear = currentYear - 1;

    // Initialize data structures for both years
    const currentYearData = new Map<string, { nightsBooked: number; totalDays: number }>();
    const lastYearData = new Map<string, { nightsBooked: number; totalDays: number }>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      currentYearData.set(currentKey, { nightsBooked: 0, totalDays: getDaysInMonth(currentDate) });
      lastYearData.set(lastKey, { nightsBooked: 0, totalDays: getDaysInMonth(lastDate) });
    }

    // Process each reservation (excluding owner reservations)
    reservations.filter(r => r.source !== 'owner').forEach((reservation) => {
      if (!reservation.check_in || !reservation.check_out) return;

      const checkIn = parseISO(reservation.check_in);
      const checkOut = parseISO(reservation.check_out);
      
      // Iterate through each night of the reservation
      let currentNight = checkIn;
      while (currentNight < checkOut) {
        const monthKey = format(currentNight, 'yyyy-MM');
        const year = currentNight.getFullYear();
        
        if (year === currentYear && currentYearData.has(monthKey)) {
          const data = currentYearData.get(monthKey)!;
          data.nightsBooked++;
        } else if (year === lastYear && lastYearData.has(monthKey)) {
          const data = lastYearData.get(monthKey)!;
          data.nightsBooked++;
        }
        
        currentNight = addDays(currentNight, 1);
      }
    });

    // Combine data by month name
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      const currentData = currentYearData.get(currentKey) || { nightsBooked: 0, totalDays: getDaysInMonth(currentDate) };
      const lastData = lastYearData.get(lastKey) || { nightsBooked: 0, totalDays: getDaysInMonth(lastDate) };
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: (currentData.nightsBooked / currentData.totalDays) * 100,
        lastYear: (lastData.nightsBooked / lastData.totalDays) * 100,
      });
    }

    return result;
  }, [reservations, currentYear]);

  // Calculate year-over-year RevPAR data
  const revparData = useMemo((): TrendDataPoint[] => {
    if (reservations.length === 0) return [];

    const lastYear = currentYear - 1;

    // Initialize data structures for both years - tracking revenue and nights
    const currentYearData = new Map<string, { revenue: number; nightsBooked: number; totalDays: number }>();
    const lastYearData = new Map<string, { revenue: number; nightsBooked: number; totalDays: number }>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      currentYearData.set(currentKey, { revenue: 0, nightsBooked: 0, totalDays: getDaysInMonth(currentDate) });
      lastYearData.set(lastKey, { revenue: 0, nightsBooked: 0, totalDays: getDaysInMonth(lastDate) });
    }

    // Process each reservation (excluding owner reservations)
    reservations.filter(r => r.source !== 'owner').forEach((reservation) => {
      if (!reservation.check_in || !reservation.check_out) return;

      const resCheckIn = parseISO(reservation.check_in);
      const resCheckOut = parseISO(reservation.check_out);
      const resRevenue = parseFloat(reservation.fare_accommodation_adjusted || 0);
      const resNightsCount = reservation.nights_count || 0;
      const resRevenuePerNight = resNightsCount > 0 ? resRevenue / resNightsCount : 0;
      
      // Allocate revenue and count nights for each day
      let nightCursor = resCheckIn;
      while (nightCursor < resCheckOut) {
        const monthKey = format(nightCursor, 'yyyy-MM');
        const year = nightCursor.getFullYear();
        
        if (year === currentYear && currentYearData.has(monthKey)) {
          const data = currentYearData.get(monthKey)!;
          data.revenue += resRevenuePerNight;
          data.nightsBooked++;
        } else if (year === lastYear && lastYearData.has(monthKey)) {
          const data = lastYearData.get(monthKey)!;
          data.revenue += resRevenuePerNight;
          data.nightsBooked++;
        }
        
        nightCursor = addDays(nightCursor, 1);
      }
    });

    // Calculate RevPAR for each month
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDate = new Date(currentYear, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      const currentData = currentYearData.get(currentKey)!;
      const lastData = lastYearData.get(lastKey)!;
      
      // Calculate ADR and Occupancy, then RevPAR = ADR × Occupancy
      const currentADR = currentData.nightsBooked > 0 ? currentData.revenue / currentData.nightsBooked : 0;
      const currentOccupancy = (currentData.nightsBooked / currentData.totalDays) * 100;
      const currentRevPAR = currentADR * (currentOccupancy / 100);
      
      const lastADR = lastData.nightsBooked > 0 ? lastData.revenue / lastData.nightsBooked : 0;
      const lastOccupancy = (lastData.nightsBooked / lastData.totalDays) * 100;
      const lastRevPAR = lastADR * (lastOccupancy / 100);
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: currentRevPAR,
        lastYear: lastRevPAR,
      });
    }

    return result;
  }, [reservations, currentYear]);

  useEffect(() => {
    loadGoalsComparison();
  }, [listingId, year, reservations, externalGoals, externalForecasts]);

  const loadGoalsComparison = async () => {
    try {
      let goalsData;

      // If external goals provided (group-level), use them
      if (externalGoals) {
        goalsData = externalGoals.filter(g => g.year === year);
      } else if (listingId) {
        // Otherwise fetch for specific listing
        const { data, error } = await supabase
          .from('property_goals')
          .select('*')
          .eq('listing_id', listingId)
          .eq('year', year)
          .order('month');

        if (error) throw error;
        goalsData = data;
      } else {
        goalsData = [];
      }

      // Get forecast data for this year
      let forecastData;
      if (externalForecasts) {
        forecastData = externalForecasts.filter(f => f.year === year);
      } else if (listingId) {
        const { data } = await supabase
          .from('revenue_forecasts')
          .select('*')
          .eq('listing_id', listingId)
          .eq('year', year)
          .order('generated_at', { ascending: false })
          .limit(1)
          .single();
        forecastData = data ? [data] : [];
      } else {
        forecastData = [];
      }

      // Fetch compset monthly averages if viewing single property
      let compsetAverages: CompsetMonthlyAverage[] = [];
      if (listingId && !externalGoals) {
        const { data: compsetData } = await supabase
          .from('property_compset_summary')
          .select('monthly_averages')
          .eq('listing_id', listingId)
          .single();
        
        if (compsetData?.monthly_averages && Array.isArray(compsetData.monthly_averages)) {
          compsetAverages = compsetData.monthly_averages as unknown as CompsetMonthlyAverage[];
        }
      }
      setCompsetMonthlyAverages(compsetAverages);

      // Create a map for quick lookup of compset averages by month
      const compsetMap = new Map<string, number>();
      compsetAverages.forEach(avg => {
        compsetMap.set(avg.month, avg.revenue);
      });

      // Calculate actual revenue per month
      const monthly: GoalData[] = [];
      const cumulative: GoalData[] = [];
      let cumulativeActual = 0;
      let cumulativeBudget = 0;
      let cumulativeProjection = 0;
      let cumulativeGoal = 0;
      let cumulativeForecastP25 = 0;
      let cumulativeForecastP50 = 0;
      let cumulativeForecastP75 = 0;
      let cumulativeCompset = 0;
      let cumulativeLastYearActual = 0;
      const currentMonth = new Date().getMonth();
      const currentYearActual = new Date().getFullYear();
      const lastYear = year - 1;

      for (let month = 0; month < 12; month++) {
        // For group-level, aggregate goals for this month
        const monthGoals = externalGoals 
          ? goalsData?.filter(g => g.month === month + 1) || []
          : [goalsData?.find(g => g.month === month + 1)].filter(Boolean);
        
        // Calculate actual revenue for this month (excluding owner reservations)
        const actualRevenue = reservations
          .filter(r => {
            if (!r.check_in) return false;
            if (r.source === 'owner') return false;
            return ["confirmed", "checked_in", "checked_out"].includes(r.status);
          })
          .reduce((sum, r) => {
            const revenue = Number(r.fare_accommodation_adjusted) || 0;
            const nightsCount = r.nights_count || 0;
            const revenuePerNight = nightsCount > 0 ? revenue / nightsCount : 0;
            
            // Calculate how many nights fall in this month
            const checkIn = new Date(r.check_in);
            const checkOut = new Date(r.check_out);
            let nightsInMonth = 0;
            let currentDate = new Date(checkIn);
            
            while (currentDate < checkOut) {
              if (currentDate.getFullYear() === year && currentDate.getMonth() === month) {
                nightsInMonth++;
              }
              currentDate = new Date(currentDate);
              currentDate.setDate(currentDate.getDate() + 1);
            }
            
            return sum + (revenuePerNight * nightsInMonth);
          }, 0);

        // Calculate last year's actual revenue for this month
        const lastYearActualRevenue = reservations
          .filter(r => {
            if (!r.check_in) return false;
            if (r.source === 'owner') return false;
            return ["confirmed", "checked_in", "checked_out"].includes(r.status);
          })
          .reduce((sum, r) => {
            const revenue = Number(r.fare_accommodation_adjusted) || 0;
            const nightsCount = r.nights_count || 0;
            const revenuePerNight = nightsCount > 0 ? revenue / nightsCount : 0;
            
            // Calculate how many nights fall in this month of last year
            const checkIn = new Date(r.check_in);
            const checkOut = new Date(r.check_out);
            let nightsInMonth = 0;
            let currentDate = new Date(checkIn);
            
            while (currentDate < checkOut) {
              if (currentDate.getFullYear() === lastYear && currentDate.getMonth() === month) {
                nightsInMonth++;
              }
              currentDate = new Date(currentDate);
              currentDate.setDate(currentDate.getDate() + 1);
            }
            
            return sum + (revenuePerNight * nightsInMonth);
          }, 0);

        // Aggregate goals for group-level or use single goal
        const budget = monthGoals.reduce((sum, g) => sum + (Number(g?.budget_revenue) || 0), 0);
        const projection = monthGoals.reduce((sum, g) => sum + (Number(g?.projection_revenue) || 0), 0);
        const goal = monthGoals.reduce((sum, g) => sum + (Number(g?.goal_revenue) || 0), 0);

        // Aggregate forecast for this month with confidence intervals
        let forecastP25 = 0, forecastP50 = 0, forecastP75 = 0;
        if (forecastData && forecastData.length > 0) {
          const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
          forecastData.forEach(f => {
            const monthlyForecasts = Array.isArray(f.monthly_forecasts) ? f.monthly_forecasts : [];
            const monthForecast = monthlyForecasts.find((mf: any) =>
              mf?.month === monthKey || mf?.month === month || mf?.month === month + 1
            );
            forecastP25 += (monthForecast?.totalForecast?.p25 ?? monthForecast?.total_forecast_p25 ?? 0);
            forecastP50 += (monthForecast?.totalForecast?.p50 ?? monthForecast?.total_forecast_p50 ?? 0);
            forecastP75 += (monthForecast?.totalForecast?.p75 ?? monthForecast?.total_forecast_p75 ?? 0);
          });
        }

        // Only show forecast for future months based on selected year
        // If viewing past year: no forecast
        // If viewing future year: all months show forecast  
        // If viewing current year: only months after current month
        const isFutureMonth = year > currentYearActual || 
          (year === currentYearActual && month > currentMonth);

        // Get compset average for this month
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const compsetAvg = compsetMap.get(monthKey);
        
        // Monthly data
        monthly.push({
          month: monthNames[month],
          actual: Math.round(actualRevenue),
          budget: Math.round(budget),
          projection: Math.round(projection),
          goal: Math.round(goal),
          forecastP25: isFutureMonth ? Math.round(forecastP25) : undefined,
          forecastP50: isFutureMonth ? Math.round(forecastP50) : undefined,
          forecastP75: isFutureMonth ? Math.round(forecastP75) : undefined,
          compsetAverage: compsetAvg !== undefined ? Math.round(compsetAvg) : undefined,
          lastYearActual: Math.round(lastYearActualRevenue),
        });

        // Cumulative data
        cumulativeActual += actualRevenue;
        cumulativeBudget += budget;
        cumulativeProjection += projection;
        cumulativeGoal += goal;
        cumulativeForecastP25 += forecastP25;
        cumulativeForecastP50 += forecastP50;
        cumulativeForecastP75 += forecastP75;
        if (compsetAvg !== undefined) cumulativeCompset += compsetAvg;
        cumulativeLastYearActual += lastYearActualRevenue;

        cumulative.push({
          month: monthNames[month],
          actual: Math.round(cumulativeActual),
          budget: Math.round(cumulativeBudget),
          projection: Math.round(cumulativeProjection),
          goal: Math.round(cumulativeGoal),
          forecastP25: isFutureMonth ? Math.round(cumulativeForecastP25) : undefined,
          forecastP50: isFutureMonth ? Math.round(cumulativeForecastP50) : undefined,
          forecastP75: isFutureMonth ? Math.round(cumulativeForecastP75) : undefined,
          compsetAverage: compsetAvg !== undefined ? Math.round(cumulativeCompset) : undefined,
          lastYearActual: Math.round(cumulativeLastYearActual),
        });
      }

      setMonthlyData(monthly);
      setCumulativeData(cumulative);
    } catch (error: any) {
      toast({
        title: "Error loading goals",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const RevenueTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    const hasForecast = data.forecastP25 !== undefined;

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
        <p className="font-medium text-sm mb-2">{data.month}</p>
        <div className="space-y-1">
          {payload
            .filter((entry: any) => entry.name && !entry.name.includes('Range') && entry.name !== 'Last Year')
            .map((entry: any, index: number) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-muted-foreground capitalize">{entry.name}:</span>
                <span className="font-medium">${entry.value.toLocaleString()}</span>
              </div>
            ))}
          {hasForecast && showForecast && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="text-xs text-muted-foreground mb-1">Forecast Range:</div>
              <div className="text-xs space-y-0.5">
                <div>P25 (Low): ${data.forecastP25?.toLocaleString()}</div>
                <div>P50 (Mid): ${data.forecastP50?.toLocaleString()}</div>
                <div>P75 (High): ${data.forecastP75?.toLocaleString()}</div>
              </div>
            </div>
          )}
          {data.compsetAverage !== undefined && showCompset && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#8b5cf6' }} />
                <span className="text-muted-foreground">Compset Avg:</span>
                <span className="font-medium">${data.compsetAverage.toLocaleString()}</span>
              </div>
            </div>
          )}
          {showComparison && data.lastYearActual !== undefined && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
                <span className="text-muted-foreground">Last Year:</span>
                <span className="font-medium">${data.lastYearActual.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const TrendTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const isOccupancy = activeMetric === 'occupancy';
    const isRevPAR = activeMetric === 'revpar';
    
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-4">
        <p className="font-medium text-sm mb-2">{label}</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-muted-foreground">Current Year:</span>
            <span className="font-medium">
              {isOccupancy
                ? `${payload[0].value.toFixed(1)}%`
                : `$${payload[0].value.toFixed(2)}`}
            </span>
          </div>
          {showComparison && payload[1] && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
              <span className="text-muted-foreground">Last Year:</span>
              <span className="font-medium">
                {isOccupancy
                  ? `${payload[1].value.toFixed(1)}%`
                  : `$${payload[1].value.toFixed(2)}`}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const calculateYTDComparison = () => {
    const currentMonth = new Date().getMonth();
    const ytdData = activeTab === 'cumulative' ? cumulativeData[currentMonth] : 
      monthlyData.slice(0, currentMonth + 1).reduce((acc, curr) => ({
        month: 'YTD',
        actual: acc.actual + curr.actual,
        budget: acc.budget + curr.budget,
        projection: acc.projection + curr.projection,
        goal: acc.goal + curr.goal,
      }), { month: 'YTD', actual: 0, budget: 0, projection: 0, goal: 0 });

    return {
      vsBudget: ytdData.budget > 0 ? ((ytdData.actual - ytdData.budget) / ytdData.budget) * 100 : 0,
      vsProjection: ytdData.projection > 0 ? ((ytdData.actual - ytdData.projection) / ytdData.projection) * 100 : 0,
      vsGoal: ytdData.goal > 0 ? ((ytdData.actual - ytdData.goal) / ytdData.goal) * 100 : 0,
    };
  };

  const ytdComparison = calculateYTDComparison();

  // Get chart title based on active metric
  const getChartTitle = () => {
    switch (activeMetric) {
      case 'revenue': return `Revenue Performance - ${year}`;
      case 'occupancy': return `Occupancy Performance - ${currentYear}`;
      case 'revpar': return `RevPAR Performance - ${currentYear}`;
    }
  };

  const getChartDescription = () => {
    switch (activeMetric) {
      case 'revenue': return 'Track actual revenue against goals';
      case 'occupancy': return 'Monthly occupancy rates year-over-year';
      case 'revpar': return 'Revenue per available room year-over-year';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold tracking-tight">Performance Metrics</h3>
        <p className="text-muted-foreground mt-1">
          Track revenue, occupancy, and RevPAR performance
        </p>
      </div>

      {/* YTD Summary Cards - Only show for revenue metric */}
      {activeMetric === 'revenue' && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                vs Budget (Low)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`flex items-center gap-2 text-2xl font-bold ${ytdComparison.vsBudget >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                {ytdComparison.vsBudget >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {Math.abs(ytdComparison.vsBudget).toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {ytdComparison.vsBudget >= 0 ? 'Above' : 'Below'} budget target
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                vs Projection (Expected)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`flex items-center gap-2 text-2xl font-bold ${ytdComparison.vsProjection >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                {ytdComparison.vsProjection >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {Math.abs(ytdComparison.vsProjection).toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {ytdComparison.vsProjection >= 0 ? 'Above' : 'Below'} projection
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                vs Goal (High)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`flex items-center gap-2 text-2xl font-bold ${ytdComparison.vsGoal >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                {ytdComparison.vsGoal >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {Math.abs(ytdComparison.vsGoal).toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {ytdComparison.vsGoal >= 0 ? 'Above' : 'Below'} goal target
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>{getChartTitle()}</CardTitle>
            <CardDescription>{getChartDescription()}</CardDescription>
          </div>
          {/* Year selector - only show for revenue metric when viewing single property */}
          {activeMetric === 'revenue' && !externalGoals && listingId && (
            <Tabs value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))}>
              <TabsList>
                {availableYears.map((yr) => (
                  <TabsTrigger key={yr} value={yr.toString()} className="px-3">
                    {yr}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </CardHeader>
        <CardContent>
          {/* Metric selector tabs */}
          <Tabs value={activeMetric} onValueChange={(v) => setActiveMetric(v as 'revenue' | 'occupancy' | 'revpar')}>
            <TabsList className="mb-4">
              <TabsTrigger value="revenue">Revenue</TabsTrigger>
              <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
              <TabsTrigger value="revpar">RevPAR</TabsTrigger>
            </TabsList>
          </Tabs>

          {activeMetric === 'revenue' ? (
            // Revenue chart with existing functionality
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'monthly' | 'cumulative')}>
              <div className="flex items-center justify-between mb-6">
                <TabsList className="grid w-full max-w-md grid-cols-2">
                  <TabsTrigger value="monthly">Monthly</TabsTrigger>
                  <TabsTrigger value="cumulative">Cumulative</TabsTrigger>
                </TabsList>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-goals"
                      checked={showGoals}
                      onCheckedChange={(checked) => setShowGoals(checked as boolean)}
                    />
                    <Label htmlFor="show-goals" className="text-sm cursor-pointer">
                      Show Goals
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-forecast"
                      checked={showForecast}
                      onCheckedChange={(checked) => setShowForecast(checked as boolean)}
                    />
                    <Label htmlFor="show-forecast" className="text-sm cursor-pointer">
                      Show Forecast Range
                    </Label>
                  </div>
                  {listingId && !externalGoals && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="show-compset"
                        checked={showCompset}
                        onCheckedChange={(checked) => setShowCompset(checked as boolean)}
                        disabled={compsetMonthlyAverages.length === 0}
                      />
                      <Label 
                        htmlFor="show-compset" 
                        className={`text-sm cursor-pointer ${compsetMonthlyAverages.length === 0 ? 'text-muted-foreground' : ''}`}
                        title={compsetMonthlyAverages.length === 0 ? 'No compset data available. Fetch historical metrics from selected comparables first.' : ''}
                      >
                        Show Compset Average
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-comparison-revenue"
                      checked={showComparison}
                      onCheckedChange={(checked) => setShowComparison(checked as boolean)}
                    />
                    <Label htmlFor="show-comparison-revenue" className="text-sm cursor-pointer">
                      Compare with Last Year
                    </Label>
                  </div>
                </div>
              </div>

              <TabsContent value="monthly">
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={monthlyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="month" 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={3} name="Actual" />
                    {showGoals && (
                      <>
                        <Line type="monotone" dataKey="budget" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" name="Budget" />
                        <Line type="monotone" dataKey="projection" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Projection" />
                        <Line type="monotone" dataKey="goal" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" name="Goal" />
                      </>
                    )}
                    {showForecast && (
                      <>
                        <Area 
                          type="monotone" 
                          dataKey="forecastP75" 
                          stroke="none" 
                          fill="#0ea5e9" 
                          fillOpacity={0.25}
                          name="Forecast Range"
                          connectNulls={false}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="forecastP25" 
                          stroke="none" 
                          fill="#ffffff" 
                          fillOpacity={1}
                          legendType="none"
                          connectNulls={false}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="forecastP50" 
                          stroke="#0ea5e9" 
                          strokeWidth={2} 
                          strokeDasharray="4 4"
                          name="Forecast"
                          connectNulls={false}
                        />
                      </>
                    )}
                    {showCompset && (
                      <Line 
                        type="monotone" 
                        dataKey="compsetAverage" 
                        stroke="#8b5cf6" 
                        strokeWidth={2} 
                        strokeDasharray="3 3"
                        name="Compset Avg"
                        connectNulls={false}
                      />
                    )}
                    {showComparison && (
                      <Line 
                        type="monotone" 
                        dataKey="lastYearActual" 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeWidth={2.5} 
                        name="Last Year"
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </TabsContent>

              <TabsContent value="cumulative">
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={cumulativeData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="month" 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={3} name="Actual" />
                    {showGoals && (
                      <>
                        <Line type="monotone" dataKey="budget" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" name="Budget" />
                        <Line type="monotone" dataKey="projection" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Projection" />
                        <Line type="monotone" dataKey="goal" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" name="Goal" />
                      </>
                    )}
                    {showForecast && (
                      <>
                        <Area 
                          type="monotone" 
                          dataKey="forecastP75" 
                          stroke="none" 
                          fill="#0ea5e9" 
                          fillOpacity={0.25}
                          name="Forecast Range"
                          connectNulls={false}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="forecastP25" 
                          stroke="none" 
                          fill="#ffffff" 
                          fillOpacity={1}
                          legendType="none"
                          connectNulls={false}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="forecastP50" 
                          stroke="#0ea5e9" 
                          strokeWidth={2} 
                          strokeDasharray="4 4"
                          name="Forecast"
                          connectNulls={false}
                        />
                      </>
                    )}
                    {showCompset && (
                      <Line 
                        type="monotone" 
                        dataKey="compsetAverage" 
                        stroke="#8b5cf6" 
                        strokeWidth={2} 
                        strokeDasharray="3 3"
                        name="Compset Avg"
                        connectNulls={false}
                      />
                    )}
                    {showComparison && (
                      <Line 
                        type="monotone" 
                        dataKey="lastYearActual" 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeWidth={2.5} 
                        name="Last Year"
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </TabsContent>
            </Tabs>
          ) : (
            // Occupancy or RevPAR chart
            <div>
              <div className="flex items-center justify-end mb-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="compare-yoy"
                    checked={showComparison}
                    onCheckedChange={(checked) => setShowComparison(checked as boolean)}
                  />
                  <Label htmlFor="compare-yoy" className="text-sm cursor-pointer">
                    Compare with Last Year
                  </Label>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart 
                  data={activeMetric === 'occupancy' ? occupancyData : revparData} 
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) =>
                      activeMetric === 'occupancy' ? `${value}%` : `$${value.toFixed(0)}`
                    }
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="currentYear"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    dot={{ fill: "hsl(var(--primary))", r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Current Year"
                    connectNulls
                  />
                  {showComparison && (
                    <Line
                      type="monotone"
                      dataKey="lastYear"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2.5}
                      dot={{ fill: "hsl(var(--muted-foreground))", r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Last Year"
                      connectNulls
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

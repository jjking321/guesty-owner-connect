import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Target, TrendingUp, TrendingDown, Download, BarChart3, TableIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, parseISO, getDaysInMonth, addDays } from "date-fns";

interface GoalsComparisonProps {
  listingId?: string | null;
  reservations: any[];
  goals?: any[];
  forecasts?: any[];
  propertyCount?: number;
}

interface GoalData {
  month: string;
  actual: number;
  projection: number;
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
  compsetAverage?: number;
}

interface CompsetMonthlyAverage {
  month: string;
  revenue: number;
  adr: number;
  occupancy: number;
  revpar: number;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GoalsComparison({ listingId, reservations, goals: externalGoals, forecasts: externalForecasts, propertyCount = 1 }: GoalsComparisonProps) {
  const [activeMetric, setActiveMetric] = useState<'revenue' | 'occupancy' | 'revpar' | 'adr'>('revenue');
  const [activeTab, setActiveTab] = useState<'monthly' | 'cumulative'>('monthly');
  const [monthlyData, setMonthlyData] = useState<GoalData[]>([]);
  const [cumulativeData, setCumulativeData] = useState<GoalData[]>([]);
  const [showForecast, setShowForecast] = useState(false);
  const [showGoals, setShowGoals] = useState(true);
  const [showCompset, setShowCompset] = useState(false);
  const [showComparison, setShowComparison] = useState(true);
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [compsetMonthlyAverages, setCompsetMonthlyAverages] = useState<CompsetMonthlyAverage[]>([]);
  const [calendarRates, setCalendarRates] = useState<Map<string, { avgRate: number; totalDays: number; availableDays: number }>>(new Map());
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

    const lastYear = year - 1;

    // Initialize data structures for both years
    const currentYearData = new Map<string, { nightsBooked: number; totalDays: number }>();
    const lastYearData = new Map<string, { nightsBooked: number; totalDays: number }>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentDate = new Date(year, month, 1);
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
        const nightYear = currentNight.getFullYear();
        
        if (nightYear === year && currentYearData.has(monthKey)) {
          const data = currentYearData.get(monthKey)!;
          data.nightsBooked++;
        } else if (nightYear === lastYear && lastYearData.has(monthKey)) {
          const data = lastYearData.get(monthKey)!;
          data.nightsBooked++;
        }
        
        currentNight = addDays(currentNight, 1);
      }
    });

    // Create compset occupancy map
    const compsetOccupancyMap = new Map<string, number>();
    compsetMonthlyAverages.forEach(avg => {
      compsetOccupancyMap.set(avg.month, avg.occupancy);
    });

    // Combine data by month name
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDate = new Date(year, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      const currentData = currentYearData.get(currentKey) || { nightsBooked: 0, totalDays: getDaysInMonth(currentDate) };
      const lastData = lastYearData.get(lastKey) || { nightsBooked: 0, totalDays: getDaysInMonth(lastDate) };
      
      // Get compset average for this month (format: "2024-01")
      const compsetAvg = compsetOccupancyMap.get(currentKey);
      
      // For groups (propertyCount > 1), divide by total available nights across all properties
      const currentTotalAvailable = currentData.totalDays * propertyCount;
      const lastTotalAvailable = lastData.totalDays * propertyCount;
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: currentTotalAvailable > 0 ? (currentData.nightsBooked / currentTotalAvailable) * 100 : 0,
        lastYear: lastTotalAvailable > 0 ? (lastData.nightsBooked / lastTotalAvailable) * 100 : 0,
        compsetAverage: compsetAvg !== undefined ? compsetAvg * 100 : undefined, // Convert from decimal to percentage
      });
    }

    return result;
  }, [reservations, year, compsetMonthlyAverages, propertyCount]);

  // Calculate year-over-year RevPAR data
  const revparData = useMemo((): TrendDataPoint[] => {
    if (reservations.length === 0) return [];

    const lastYear = year - 1;

    // Initialize data structures for both years - tracking revenue and nights
    const currentYearData = new Map<string, { revenue: number; nightsBooked: number; totalDays: number }>();
    const lastYearData = new Map<string, { revenue: number; nightsBooked: number; totalDays: number }>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentDate = new Date(year, month, 1);
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
        const nightYear = nightCursor.getFullYear();
        
        if (nightYear === year && currentYearData.has(monthKey)) {
          const data = currentYearData.get(monthKey)!;
          data.revenue += resRevenuePerNight;
          data.nightsBooked++;
        } else if (nightYear === lastYear && lastYearData.has(monthKey)) {
          const data = lastYearData.get(monthKey)!;
          data.revenue += resRevenuePerNight;
          data.nightsBooked++;
        }
        
        nightCursor = addDays(nightCursor, 1);
      }
    });

    // Create compset revpar map
    const compsetRevparMap = new Map<string, number>();
    compsetMonthlyAverages.forEach(avg => {
      compsetRevparMap.set(avg.month, avg.revpar);
    });

    // Calculate RevPAR for each month
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDate = new Date(year, month, 1);
      const lastDate = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDate, 'yyyy-MM');
      const lastKey = format(lastDate, 'yyyy-MM');
      
      const currentData = currentYearData.get(currentKey)!;
      const lastData = lastYearData.get(lastKey)!;
      
      // Calculate ADR and Occupancy, then RevPAR = ADR × Occupancy
      // For groups (propertyCount > 1), divide by total available nights across all properties
      const currentTotalAvailable = currentData.totalDays * propertyCount;
      const lastTotalAvailable = lastData.totalDays * propertyCount;
      
      const currentADR = currentData.nightsBooked > 0 ? currentData.revenue / currentData.nightsBooked : 0;
      const currentOccupancy = currentTotalAvailable > 0 ? (currentData.nightsBooked / currentTotalAvailable) * 100 : 0;
      const currentRevPAR = currentADR * (currentOccupancy / 100);
      
      const lastADR = lastData.nightsBooked > 0 ? lastData.revenue / lastData.nightsBooked : 0;
      const lastOccupancy = lastTotalAvailable > 0 ? (lastData.nightsBooked / lastTotalAvailable) * 100 : 0;
      const lastRevPAR = lastADR * (lastOccupancy / 100);
      
      // Get compset average for this month
      const compsetAvg = compsetRevparMap.get(currentKey);
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: currentRevPAR,
        lastYear: lastRevPAR,
        compsetAverage: compsetAvg,
      });
    }

    return result;
  }, [reservations, year, compsetMonthlyAverages, propertyCount]);

  // Calculate year-over-year ADR data - uses calendar asking rates for future months
  const adrData = useMemo((): TrendDataPoint[] => {
    const lastYear = year - 1;
    const currentDate = new Date();
    const currentMonthKey = format(currentDate, 'yyyy-MM');

    // Initialize data structures for both years - tracking revenue and nights
    const currentYearData = new Map<string, { revenue: number; nightsBooked: number }>();
    const lastYearData = new Map<string, { revenue: number; nightsBooked: number }>();

    // Get all 12 months for both years
    for (let month = 0; month < 12; month++) {
      const currentDateObj = new Date(year, month, 1);
      const lastDateObj = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDateObj, 'yyyy-MM');
      const lastKey = format(lastDateObj, 'yyyy-MM');
      
      currentYearData.set(currentKey, { revenue: 0, nightsBooked: 0 });
      lastYearData.set(lastKey, { revenue: 0, nightsBooked: 0 });
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
        const nightYear = nightCursor.getFullYear();
        
        if (nightYear === year && currentYearData.has(monthKey)) {
          const data = currentYearData.get(monthKey)!;
          data.revenue += resRevenuePerNight;
          data.nightsBooked++;
        } else if (nightYear === lastYear && lastYearData.has(monthKey)) {
          const data = lastYearData.get(monthKey)!;
          data.revenue += resRevenuePerNight;
          data.nightsBooked++;
        }
        
        nightCursor = addDays(nightCursor, 1);
      }
    });

    // Create compset ADR map (uses future asking rates for future months)
    const compsetAdrMap = new Map<string, number>();
    compsetMonthlyAverages.forEach(avg => {
      compsetAdrMap.set(avg.month, avg.adr);
    });

    // Calculate ADR for each month
    const result = [];
    for (let month = 0; month < 12; month++) {
      const monthName = format(new Date(2000, month, 1), 'MMM');
      const currentDateObj = new Date(year, month, 1);
      const lastDateObj = new Date(lastYear, month, 1);
      
      const currentKey = format(currentDateObj, 'yyyy-MM');
      const lastKey = format(lastDateObj, 'yyyy-MM');
      
      const currentData = currentYearData.get(currentKey)!;
      const lastData = lastYearData.get(lastKey)!;
      
      // Check if this is a future month
      const isFutureMonth = currentKey > currentMonthKey;
      
      // For future months, use calendar asking rates; for past months, use realized ADR
      let currentADR: number;
      if (isFutureMonth && calendarRates.has(currentKey)) {
        const calData = calendarRates.get(currentKey)!;
        currentADR = calData.avgRate;
      } else {
        // Use realized ADR from reservations
        currentADR = currentData.nightsBooked > 0 ? currentData.revenue / currentData.nightsBooked : 0;
      }
      
      const lastADR = lastData.nightsBooked > 0 ? lastData.revenue / lastData.nightsBooked : 0;
      
      // Get compset average for this month
      const compsetAvg = compsetAdrMap.get(currentKey);
      
      result.push({
        month: monthName,
        monthKey: currentKey,
        currentYear: currentADR,
        lastYear: lastADR,
        compsetAverage: compsetAvg,
      });
    }

    return result;
  }, [reservations, year, compsetMonthlyAverages, calendarRates]);

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
          .maybeSingle();
        forecastData = data ? [data] : [];
      } else {
        forecastData = [];
      }

      // Fetch compset monthly averages if viewing single property
      // This includes both historical (monthly_averages) and future (future_monthly_averages) data
      let compsetAverages: CompsetMonthlyAverage[] = [];
      if (listingId && !externalGoals) {
        const { data: compsetData } = await supabase
          .from('property_compset_summary')
          .select('monthly_averages, future_monthly_averages')
          .eq('listing_id', listingId)
          .maybeSingle();

        const normalizeCompsetAverage = (raw: any): CompsetMonthlyAverage | null => {
          if (!raw || typeof raw !== 'object') return null;

          const month = raw.month ?? raw.year_month;
          if (typeof month !== 'string' || !month) return null;

          const revenueRaw = raw.revenue ?? raw.avg_revenue;
          const adrRaw = raw.adr ?? raw.avg_adr;
          const occupancyRaw = raw.occupancy ?? raw.avg_occupancy;
          const revparRaw = raw.revpar ?? raw.avg_revpar;

          const revenue = typeof revenueRaw === 'number' ? revenueRaw : Number.NaN;
          const adr = typeof adrRaw === 'number' ? adrRaw : Number.NaN;
          const occupancy = typeof occupancyRaw === 'number' ? occupancyRaw : Number.NaN;
          const revpar = typeof revparRaw === 'number' ? revparRaw : Number.NaN;

          return { month, revenue, adr, occupancy, revpar };
        };

        const normalizeArray = (arr: unknown): CompsetMonthlyAverage[] => {
          if (!Array.isArray(arr)) return [];
          return arr
            .map(normalizeCompsetAverage)
            .filter((x): x is CompsetMonthlyAverage => Boolean(x));
        };

        const historicalAverages = normalizeArray(compsetData?.monthly_averages);
        const futureAverages = normalizeArray(compsetData?.future_monthly_averages);

        // Merge (future takes precedence), then sort
        const merged = new Map<string, CompsetMonthlyAverage>();
        for (const avg of historicalAverages) merged.set(avg.month, avg);
        for (const avg of futureAverages) merged.set(avg.month, avg);

        compsetAverages = Array.from(merged.values()).sort((a, b) => a.month.localeCompare(b.month));
      }
      setCompsetMonthlyAverages(compsetAverages);

      // Fetch calendar rates for property's future asking rates (ADR chart)
      if (listingId && !externalGoals) {
        const startOfYear = `${year}-01-01`;
        const endOfYear = `${year}-12-31`;
        
        const { data: calendarData } = await supabase
          .from('capacity_calendar')
          .select('date, price')
          .eq('listing_id', listingId)
          .gte('date', startOfYear)
          .lte('date', endOfYear)
          .not('price', 'is', null);

        // Aggregate calendar rates by month
        const calendarRatesMap = new Map<string, { totalPrice: number; count: number; availableDays: number; totalDays: number }>();
        
        if (calendarData) {
          calendarData.forEach((day: any) => {
            const monthKey = format(parseISO(day.date), 'yyyy-MM');
            if (!calendarRatesMap.has(monthKey)) {
              calendarRatesMap.set(monthKey, { totalPrice: 0, count: 0, availableDays: 0, totalDays: 0 });
            }
            const monthData = calendarRatesMap.get(monthKey)!;
            if (day.price && day.price > 0) {
              monthData.totalPrice += day.price;
              monthData.count++;
            }
            monthData.totalDays++;
          });
        }

        // Convert to average rates
        const processedCalendarRates = new Map<string, { avgRate: number; totalDays: number; availableDays: number }>();
        calendarRatesMap.forEach((data, monthKey) => {
          processedCalendarRates.set(monthKey, {
            avgRate: data.count > 0 ? data.totalPrice / data.count : 0,
            totalDays: data.totalDays,
            availableDays: data.count,
          });
        });
        setCalendarRates(processedCalendarRates);
      }

      // Create a map for quick lookup of compset averages by month
      // For future months, revenue may not exist - calculate from revpar * days in month
      const compsetMap = new Map<string, number>();
      compsetAverages.forEach((avg) => {
        if (Number.isFinite(avg.revenue) && avg.revenue > 0) {
          compsetMap.set(avg.month, avg.revenue);
        } else if (Number.isFinite(avg.revpar)) {
          // Calculate estimated revenue from revpar for future months
          const [yearStr, monthStr] = avg.month.split('-');
          const daysInMonth = getDaysInMonth(new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1));
          const estimatedRevenue = avg.revpar * daysInMonth;
          if (estimatedRevenue > 0) {
            compsetMap.set(avg.month, estimatedRevenue);
          }
        }
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
        const projection = monthGoals.reduce((sum, g) => sum + (Number(g?.projection_revenue) || 0), 0);

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
          projection: Math.round(projection),
          forecastP25: isFutureMonth ? Math.round(forecastP25) : undefined,
          forecastP50: isFutureMonth ? Math.round(forecastP50) : undefined,
          forecastP75: isFutureMonth ? Math.round(forecastP75) : undefined,
          compsetAverage: compsetAvg !== undefined ? Math.round(compsetAvg) : undefined,
          lastYearActual: Math.round(lastYearActualRevenue),
        });

        // Cumulative data
        cumulativeActual += actualRevenue;
        cumulativeProjection += projection;
        cumulativeForecastP25 += forecastP25;
        cumulativeForecastP50 += forecastP50;
        cumulativeForecastP75 += forecastP75;
        if (compsetAvg !== undefined) cumulativeCompset += compsetAvg;
        cumulativeLastYearActual += lastYearActualRevenue;

        cumulative.push({
          month: monthNames[month],
          actual: Math.round(cumulativeActual),
          projection: Math.round(cumulativeProjection),
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
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
              <span className="text-muted-foreground">Last Year:</span>
              <span className="font-medium">${data.lastYearActual.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const TrendTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const isOccupancy = activeMetric === 'occupancy';
    const isCurrency = activeMetric === 'revpar' || activeMetric === 'adr';
    
    // Find values by dataKey to handle variable ordering
    const currentYearValue = payload.find((p: any) => p.dataKey === 'currentYear')?.value;
    const lastYearValue = payload.find((p: any) => p.dataKey === 'lastYear')?.value;
    const compsetValue = payload.find((p: any) => p.dataKey === 'compsetAverage')?.value;
    
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-4">
        <p className="font-medium text-sm mb-2">{label}</p>
        <div className="space-y-1">
          {currentYearValue !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-primary" />
              <span className="text-muted-foreground">Current Year:</span>
              <span className="font-medium">
                {isOccupancy
                  ? `${currentYearValue.toFixed(1)}%`
                  : `$${currentYearValue.toFixed(2)}`}
              </span>
            </div>
          )}
          {showComparison && lastYearValue !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
              <span className="text-muted-foreground">Last Year:</span>
              <span className="font-medium">
                {isOccupancy
                  ? `${lastYearValue.toFixed(1)}%`
                  : `$${lastYearValue.toFixed(2)}`}
              </span>
            </div>
          )}
          {showCompset && compsetValue !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#8b5cf6' }} />
              <span className="text-muted-foreground">Compset Avg:</span>
              <span className="font-medium">
                {isOccupancy
                  ? `${compsetValue.toFixed(1)}%`
                  : `$${compsetValue.toFixed(2)}`}
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
        projection: acc.projection + curr.projection,
      }), { month: 'YTD', actual: 0, projection: 0 });

    return {
      vsProjection: ytdData.projection > 0 ? ((ytdData.actual - ytdData.projection) / ytdData.projection) * 100 : 0,
    };
  };

  const ytdComparison = calculateYTDComparison();

  // Get chart title based on active metric
  const getChartTitle = () => {
    switch (activeMetric) {
      case 'revenue': return `Revenue Performance - ${year}`;
      case 'occupancy': return `Occupancy Performance - ${year}`;
      case 'revpar': return `RevPAR Performance - ${year}`;
      case 'adr': return `ADR Performance - ${year}`;
    }
  };

  const getChartDescription = () => {
    switch (activeMetric) {
      case 'revenue': return 'Track actual revenue against goals';
      case 'occupancy': return 'Monthly occupancy rates year-over-year';
      case 'revpar': return 'Revenue per available room year-over-year';
      case 'adr': return 'Average daily rate year-over-year';
    }
  };

  // ---------- Table / CSV helpers ----------
  type TableColumn = { key: string; label: string; format: 'text' | 'currency' | 'percent' | 'integer' };

  const buildTableConfig = (): { columns: TableColumn[]; rows: Record<string, any>[] } => {
    if (activeMetric === 'revenue') {
      const source = activeTab === 'cumulative' ? cumulativeData : monthlyData;
      const cols: TableColumn[] = [
        { key: 'month', label: 'Month', format: 'text' },
        { key: 'actual', label: 'Actual', format: 'currency' },
      ];
      if (showGoals) cols.push({ key: 'projection', label: 'Goal', format: 'currency' });
      if (showComparison) cols.push({ key: 'lastYearActual', label: 'Last Year', format: 'currency' });
      if (showForecast) {
        cols.push(
          { key: 'forecastP25', label: 'Forecast P25', format: 'currency' },
          { key: 'forecastP50', label: 'Forecast P50', format: 'currency' },
          { key: 'forecastP75', label: 'Forecast P75', format: 'currency' },
        );
      }
      if (showCompset) cols.push({ key: 'compsetAverage', label: 'Compset Avg', format: 'currency' });
      return { columns: cols, rows: source };
    }

    const source =
      activeMetric === 'occupancy' ? occupancyData :
      activeMetric === 'revpar' ? revparData : adrData;
    const valueFormat: TableColumn['format'] = activeMetric === 'occupancy' ? 'percent' : 'currency';
    const cols: TableColumn[] = [
      { key: 'month', label: 'Month', format: 'text' },
      { key: 'currentYear', label: 'Current Year', format: valueFormat },
    ];
    if (showComparison) cols.push({ key: 'lastYear', label: 'Last Year', format: valueFormat });
    if (showCompset) cols.push({ key: 'compsetAverage', label: 'Compset Avg', format: valueFormat });
    return { columns: cols, rows: source };
  };

  const formatCellDisplay = (value: any, fmt: TableColumn['format']) => {
    if (value === null || value === undefined || value === '') return '—';
    if (fmt === 'text') return String(value);
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    if (fmt === 'currency') return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    if (fmt === 'percent') return `${num.toFixed(1)}%`;
    if (fmt === 'integer') return num.toLocaleString();
    return String(num);
  };

  const formatCellCsv = (value: any, fmt: TableColumn['format']) => {
    if (value === null || value === undefined || value === '') return '';
    if (fmt === 'text') {
      const s = String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    if (fmt === 'currency') return num.toFixed(2);
    if (fmt === 'percent') return num.toFixed(1);
    return String(num);
  };

  const renderMetricTable = () => {
    const { columns, rows } = buildTableConfig();
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.format === 'text' ? '' : 'text-right'}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                  No data available
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.format === 'text' ? 'font-medium' : 'text-right tabular-nums'}>
                      {formatCellDisplay((row as any)[c.key], c.format)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  const handleExportCSV = () => {
    const { columns, rows } = buildTableConfig();
    const headerLine = columns.map((c) => c.label).join(',');
    const dataLines = rows.map((row) =>
      columns.map((c) => formatCellCsv((row as any)[c.key], c.format)).join(',')
    );
    const csv = [headerLine, ...dataLines].join('\n');

    const slugSource = listingId || 'portfolio';
    const slug = slugSource.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'portfolio';
    const metricSlug = activeMetric === 'revenue' ? `revenue-${activeTab}` : activeMetric;
    const today = format(new Date(), 'yyyy-MM-dd');
    const filename = `performance-${metricSlug}-${year}-${slug}-${today}.csv`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({ title: 'CSV exported', description: filename });
  };

  const viewControls = (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-md border bg-background p-0.5">
        <Button
          type="button"
          variant={viewMode === 'chart' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 px-2"
          onClick={() => setViewMode('chart')}
          aria-label="Chart view"
        >
          <BarChart3 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={viewMode === 'table' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 px-2"
          onClick={() => setViewMode('table')}
          aria-label="Table view"
        >
          <TableIcon className="h-4 w-4" />
        </Button>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={handleExportCSV}>
        <Download className="h-4 w-4" />
        Export CSV
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold tracking-tight">Performance Metrics</h3>
        <p className="text-muted-foreground mt-1">
          Track revenue, occupancy, and RevPAR performance
        </p>
      </div>


      {/* Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>{getChartTitle()}</CardTitle>
            <CardDescription>{getChartDescription()}</CardDescription>
          </div>
          {/* Year selector - show when viewing single property */}
          {!externalGoals && listingId && (
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
          <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
            <Tabs value={activeMetric} onValueChange={(v) => setActiveMetric(v as 'revenue' | 'occupancy' | 'revpar' | 'adr')}>
              <TabsList>
                <TabsTrigger value="revenue">Revenue</TabsTrigger>
                <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
                <TabsTrigger value="revpar">RevPAR</TabsTrigger>
                <TabsTrigger value="adr">ADR</TabsTrigger>
              </TabsList>
            </Tabs>
            {viewControls}
          </div>

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
                      <Line type="monotone" dataKey="projection" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Goal" />
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
                      <Line type="monotone" dataKey="projection" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Goal" />
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
              <div className="flex items-center justify-end gap-4 mb-4">
                {listingId && !externalGoals && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="compare-compset-trend"
                      checked={showCompset}
                      onCheckedChange={(checked) => setShowCompset(checked as boolean)}
                      disabled={compsetMonthlyAverages.length === 0}
                    />
                    <Label 
                      htmlFor="compare-compset-trend" 
                      className={`text-sm cursor-pointer ${compsetMonthlyAverages.length === 0 ? 'text-muted-foreground' : ''}`}
                      title={compsetMonthlyAverages.length === 0 ? 'No compset data available. Fetch historical metrics from selected comparables first.' : ''}
                    >
                      Show Compset Average
                    </Label>
                  </div>
                )}
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
                  data={activeMetric === 'occupancy' ? occupancyData : activeMetric === 'revpar' ? revparData : adrData} 
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
                      activeMetric === 'occupancy' ? `${value.toFixed(0)}%` : `$${value.toFixed(0)}`
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
                  {showCompset && (
                    <Line
                      type="monotone"
                      dataKey="compsetAverage"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                      dot={{ fill: "#8b5cf6", r: 3 }}
                      activeDot={{ r: 5 }}
                      name="Compset Avg"
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

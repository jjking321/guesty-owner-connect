import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Target, TrendingUp, TrendingDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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
  forecast?: number;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GoalsComparison({ listingId, reservations, goals: externalGoals, forecasts: externalForecasts }: GoalsComparisonProps) {
  const [activeTab, setActiveTab] = useState<'monthly' | 'cumulative'>('monthly');
  const [monthlyData, setMonthlyData] = useState<GoalData[]>([]);
  const [cumulativeData, setCumulativeData] = useState<GoalData[]>([]);
  const [showForecast, setShowForecast] = useState(false);
  const { toast } = useToast();

  // Derive year from the data instead of maintaining separate state
  const year = externalGoals?.[0]?.year || new Date().getFullYear();

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

      // Calculate actual revenue per month
      const monthly: GoalData[] = [];
      const cumulative: GoalData[] = [];
      let cumulativeActual = 0;
      let cumulativeBudget = 0;
      let cumulativeProjection = 0;
      let cumulativeGoal = 0;
      let cumulativeForecast = 0;

      for (let month = 0; month < 12; month++) {
        // For group-level, aggregate goals for this month
        const monthGoals = externalGoals 
          ? goalsData?.filter(g => g.month === month + 1) || []
          : [goalsData?.find(g => g.month === month + 1)].filter(Boolean);
        
        // Calculate actual revenue for this month
        const actualRevenue = reservations
          .filter(r => {
            if (!r.check_in) return false;
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

        // Aggregate goals for group-level or use single goal
        const budget = monthGoals.reduce((sum, g) => sum + (Number(g?.budget_revenue) || 0), 0);
        const projection = monthGoals.reduce((sum, g) => sum + (Number(g?.projection_revenue) || 0), 0);
        const goal = monthGoals.reduce((sum, g) => sum + (Number(g?.goal_revenue) || 0), 0);

        // Aggregate forecast for this month
        let forecastRevenue = 0;
        if (forecastData && forecastData.length > 0) {
          forecastRevenue = forecastData.reduce((sum, f) => {
            const monthlyForecasts = f.monthly_forecasts as any[];
            const monthForecast = monthlyForecasts?.find(mf => mf.month === month);
            return sum + (monthForecast?.totalForecast?.p50 || 0);
          }, 0);
        }

        // Monthly data
        monthly.push({
          month: monthNames[month],
          actual: Math.round(actualRevenue),
          budget: Math.round(budget),
          projection: Math.round(projection),
          goal: Math.round(goal),
          forecast: Math.round(forecastRevenue),
        });

        // Cumulative data
        cumulativeActual += actualRevenue;
        cumulativeBudget += budget;
        cumulativeProjection += projection;
        cumulativeGoal += goal;
        cumulativeForecast += forecastRevenue;

        cumulative.push({
          month: monthNames[month],
          actual: Math.round(cumulativeActual),
          budget: Math.round(cumulativeBudget),
          projection: Math.round(cumulativeProjection),
          goal: Math.round(cumulativeGoal),
          forecast: Math.round(cumulativeForecast),
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

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
        <p className="font-medium text-sm mb-2">{payload[0].payload.month}</p>
        <div className="space-y-1">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground capitalize">{entry.name}:</span>
              <span className="font-medium">${entry.value.toLocaleString()}</span>
            </div>
          ))}
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold tracking-tight">Goals vs Actuals</h3>
        <p className="text-muted-foreground mt-1">
          Compare actual revenue performance against Budget, Projection, and Goal targets
        </p>
      </div>

      {/* YTD Summary Cards */}
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

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Performance - {year}</CardTitle>
          <CardDescription>Track actual revenue against goals</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'monthly' | 'cumulative')}>
            <div className="flex items-center justify-between mb-6">
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="cumulative">Cumulative</TabsTrigger>
              </TabsList>
              
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-forecast"
                  checked={showForecast}
                  onCheckedChange={(checked) => setShowForecast(checked as boolean)}
                />
                <Label htmlFor="show-forecast" className="text-sm cursor-pointer">
                  Show Forecast
                </Label>
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
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={3} name="Actual" />
                  <Line type="monotone" dataKey="budget" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" name="Budget" />
                  <Line type="monotone" dataKey="projection" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Projection" />
                  <Line type="monotone" dataKey="goal" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" name="Goal" />
                  {showForecast && <Line type="monotone" dataKey="forecast" stroke="#06b6d4" strokeWidth={2} name="Forecast" />}
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
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="hsl(var(--primary))" strokeWidth={3} name="Actual" />
                  <Line type="monotone" dataKey="budget" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" name="Budget" />
                  <Line type="monotone" dataKey="projection" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" name="Projection" />
                  <Line type="monotone" dataKey="goal" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" name="Goal" />
                  {showForecast && <Line type="monotone" dataKey="forecast" stroke="#06b6d4" strokeWidth={2} name="Forecast" />}
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Target, TrendingUp, TrendingDown } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { parseISO } from "date-fns";

interface GoalsComparisonProps {
  listingId: string;
  reservations: any[];
}

interface MonthData {
  month: string;
  monthIndex: number;
  actual: number;
  budget: number;
  projection: number;
  goal: number;
}

interface CumulativeData {
  month: string;
  actual: number;
  budget: number;
  projection: number;
  goal: number;
}

export function GoalsComparison({ listingId, reservations }: GoalsComparisonProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [monthlyData, setMonthlyData] = useState<MonthData[]>([]);
  const [cumulativeData, setCumulativeData] = useState<CumulativeData[]>([]);
  const [loading, setLoading] = useState(false);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  useEffect(() => {
    loadGoalsAndCalculate();
  }, [year, listingId, reservations]);

  const loadGoalsAndCalculate = async () => {
    setLoading(true);
    try {
      const { data: goalsData, error } = await supabase
        .from('property_goals')
        .select('*')
        .eq('listing_id', listingId)
        .eq('year', year)
        .order('month');

      if (error) throw error;

      // Calculate actuals per month
      const monthly: MonthData[] = [];
      const cumulative: CumulativeData[] = [];
      let cumulativeActual = 0;
      let cumulativeBudget = 0;
      let cumulativeProjection = 0;
      let cumulativeGoal = 0;

      for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
        const goalForMonth = goalsData?.find(g => g.month === monthIndex + 1);
        
        // Calculate actual revenue for this month
        const actualRevenue = reservations
          .filter(r => {
            if (!r.check_in) return false;
            const checkIn = parseISO(r.check_in);
            return checkIn.getFullYear() === year && checkIn.getMonth() === monthIndex;
          })
          .reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);

        const budget = goalForMonth?.budget_revenue || 0;
        const projection = goalForMonth?.projection_revenue || 0;
        const goal = goalForMonth?.goal_revenue || 0;

        monthly.push({
          month: monthNames[monthIndex],
          monthIndex,
          actual: Math.round(actualRevenue),
          budget: parseFloat(budget.toString()),
          projection: parseFloat(projection.toString()),
          goal: parseFloat(goal.toString()),
        });

        // Calculate cumulative
        cumulativeActual += actualRevenue;
        cumulativeBudget += parseFloat(budget.toString());
        cumulativeProjection += parseFloat(projection.toString());
        cumulativeGoal += parseFloat(goal.toString());

        cumulative.push({
          month: monthNames[monthIndex],
          actual: Math.round(cumulativeActual),
          budget: Math.round(cumulativeBudget),
          projection: Math.round(cumulativeProjection),
          goal: Math.round(cumulativeGoal),
        });
      }

      setMonthlyData(monthly);
      setCumulativeData(cumulative);
    } catch (error: any) {
      console.error('Error loading goals:', error);
      toast.error('Failed to load goals comparison');
    } finally {
      setLoading(false);
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
              <span className="text-muted-foreground">{entry.name}:</span>
              <span className="font-medium">${entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const SummaryCard = ({ title, value, target, type }: { title: string; value: number; target: number; type: string }) => {
    const percentage = target > 0 ? ((value / target) * 100) : 0;
    const isOnTrack = percentage >= 100;
    const Icon = isOnTrack ? TrendingUp : TrendingDown;
    const color = isOnTrack ? 'text-green-600 dark:text-green-500' : 'text-orange-600 dark:text-orange-500';

    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            vs {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-2xl font-bold">
            ${value.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">
            Target: ${target.toLocaleString()}
          </div>
          <div className={`flex items-center gap-1 text-sm font-medium ${color}`}>
            <Icon className="h-4 w-4" />
            {percentage.toFixed(1)}% of {type}
          </div>
        </CardContent>
      </Card>
    );
  };

  const ytdActual = cumulativeData[new Date().getMonth()]?.actual || 0;
  const ytdBudget = cumulativeData[new Date().getMonth()]?.budget || 0;
  const ytdProjection = cumulativeData[new Date().getMonth()]?.projection || 0;
  const ytdGoal = cumulativeData[new Date().getMonth()]?.goal || 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold tracking-tight">Goals Comparison</h3>
        <p className="text-muted-foreground mt-1">
          Track actual revenue against budget, projection, and goal targets
        </p>
      </div>

      {/* YTD Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Budget" value={ytdActual} target={ytdBudget} type="budget" />
        <SummaryCard title="Projection" value={ytdActual} target={ytdProjection} type="projection" />
        <SummaryCard title="Goal" value={ytdActual} target={ytdGoal} type="goal" />
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Performance - {year}</CardTitle>
          <CardDescription>
            Compare actual revenue against targets
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="monthly">
            <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="cumulative">Cumulative (YTD)</TabsTrigger>
            </TabsList>

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
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
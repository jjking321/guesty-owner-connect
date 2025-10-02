import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface TrendDataPoint {
  month: string;
  monthKey: string;
  currentYear: number;
  lastYear: number;
}

interface TrendChartProps {
  occupancyData: TrendDataPoint[];
  revenueData: TrendDataPoint[];
  revparData: TrendDataPoint[];
  goalsData: any[];
  reservations: any[];
  revenueForecast?: any;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TrendChart({ occupancyData, revenueData, revparData, goalsData, reservations, revenueForecast }: TrendChartProps) {
  const [activeTab, setActiveTab] = useState<"occupancy" | "revenue" | "revpar">("occupancy");
  const [showComparison, setShowComparison] = useState(true);
  const [showGoals, setShowGoals] = useState(false);
  const [showForecast, setShowForecast] = useState(false);

  // Calculate revenue with goals and forecast overlay
  const revenueWithGoals = useMemo(() => {
    if (activeTab !== "revenue") return revenueData;

    const currentYear = new Date().getFullYear();
    
    return revenueData.map((dataPoint, index) => {
      const month = index + 1;
      const monthGoal = goalsData.find(g => g.month === month);
      
      // Calculate actual revenue for this month
      const actualRevenue = reservations
        .filter(r => {
          if (!r.check_in) return false;
          const checkIn = new Date(r.check_in);
          return checkIn.getFullYear() === currentYear && checkIn.getMonth() === index;
        })
        .reduce((sum, r) => sum + parseFloat(r.fare_accommodation_adjusted || 0), 0);

      // Get forecast data for this month if available
      const monthForecast = revenueForecast?.monthlyForecasts?.find((f: any) => f.month === index);

      return {
        ...dataPoint,
        actual: Math.round(actualRevenue),
        budget: showGoals && monthGoal?.budget_revenue ? Math.round(monthGoal.budget_revenue) : undefined,
        projection: showGoals && monthGoal?.projection_revenue ? Math.round(monthGoal.projection_revenue) : undefined,
        goal: showGoals && monthGoal?.goal_revenue ? Math.round(monthGoal.goal_revenue) : undefined,
        forecast: showForecast && monthForecast ? Math.round(monthForecast.totalForecast.p50) : undefined,
      };
    });
  }, [revenueData, goalsData, reservations, revenueForecast, showGoals, showForecast, activeTab]);

  const data = activeTab === "occupancy" 
    ? occupancyData 
    : activeTab === "revenue" 
    ? revenueWithGoals 
    : revparData;
  const isOccupancy = activeTab === "occupancy";
  const isRevPAR = activeTab === "revpar";
  const isRevenue = activeTab === "revenue";

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-4">
          <p className="font-medium text-sm mb-2">{label}</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-primary" />
              <span className="text-muted-foreground">Current Year:</span>
              <span className="font-medium">
                {isOccupancy
                  ? `${payload[0].value.toFixed(1)}%`
                  : isRevPAR
                  ? `$${payload[0].value.toFixed(2)}`
                  : `$${payload[0].value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
              </span>
            </div>
            {showComparison && payload[1] && (
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-secondary" />
                <span className="text-muted-foreground">Last Year:</span>
                <span className="font-medium">
                  {isOccupancy
                    ? `${payload[1].value.toFixed(1)}%`
                    : isRevPAR
                    ? `$${payload[1].value.toFixed(2)}`
                    : `$${payload[1].value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Property Performance Trends</h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="compare"
                checked={showComparison}
                onCheckedChange={(checked) => setShowComparison(checked as boolean)}
              />
              <Label htmlFor="compare" className="text-sm font-normal cursor-pointer">
                Compare with Last Year
              </Label>
            </div>
            {isRevenue && goalsData.length > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="goals"
                  checked={showGoals}
                  onCheckedChange={(checked) => setShowGoals(checked as boolean)}
                />
                <Label htmlFor="goals" className="text-sm font-normal cursor-pointer">
                  Show Goals
                </Label>
              </div>
            )}
            {isRevenue && revenueForecast && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="forecast"
                  checked={showForecast}
                  onCheckedChange={(checked) => setShowForecast(checked as boolean)}
                />
                <Label htmlFor="forecast" className="text-sm font-normal cursor-pointer">
                  Show Forecast
                </Label>
              </div>
            )}
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "occupancy" | "revenue" | "revpar")}>
          <TabsList>
            <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="revpar">RevPAR</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                  isOccupancy ? `${value}%` : isRevPAR ? `$${value.toFixed(0)}` : `$${(value / 1000).toFixed(0)}k`
                }
              />
              <Tooltip content={<CustomTooltip />} />
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
                  stroke="hsl(var(--secondary))"
                  strokeWidth={2.5}
                  dot={{ fill: "hsl(var(--secondary))", r: 4 }}
                  activeDot={{ r: 6 }}
                  name="Last Year"
                  connectNulls
                />
              )}
              {showGoals && isRevenue && (
                <>
                  <Line
                    type="monotone"
                    dataKey="budget"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Budget"
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="projection"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Projection"
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="goal"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Goal"
                    connectNulls
                  />
                </>
              )}
              {showForecast && isRevenue && (
                <Line
                  type="monotone"
                  dataKey="forecast"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  strokeDasharray="3 3"
                  dot={{ fill: "#06b6d4", r: 4 }}
                  name="Forecast"
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

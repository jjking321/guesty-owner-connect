import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { format, parseISO } from "date-fns";

interface RatingDataPoint {
  month: string;
  avg_rating: number;
  review_count: number;
}

interface RatingTrendChartProps {
  data: RatingDataPoint[];
  isLoading?: boolean;
}

export function RatingTrendChart({ data, isLoading }: RatingTrendChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rating Over Time</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rating Over Time</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">No rating data available for this period</p>
        </CardContent>
      </Card>
    );
  }

  // Format data for the chart
  const chartData = data.map(point => ({
    ...point,
    monthLabel: format(parseISO(point.month + '-01'), 'MMM yyyy'),
  }));

  // Calculate the overall average for reference line
  const totalReviews = data.reduce((sum, d) => sum + d.review_count, 0);
  const weightedSum = data.reduce((sum, d) => sum + d.avg_rating * d.review_count, 0);
  const overallAvg = totalReviews > 0 ? weightedSum / totalReviews : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rating Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="monthLabel" 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis 
                domain={[1, 5]} 
                ticks={[1, 2, 3, 4, 5]}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-popover border rounded-lg shadow-lg p-3">
                        <p className="font-medium">{label}</p>
                        <p className="text-sm text-yellow-500">
                          Rating: {data.avg_rating.toFixed(2)} ★
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {data.review_count} review{data.review_count !== 1 ? 's' : ''}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine 
                y={overallAvg} 
                stroke="hsl(var(--muted-foreground))" 
                strokeDasharray="5 5"
                label={{ 
                  value: `Avg: ${overallAvg.toFixed(2)}`, 
                  position: 'right',
                  fontSize: 11,
                  fill: 'hsl(var(--muted-foreground))'
                }}
              />
              <Line
                type="monotone"
                dataKey="avg_rating"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, fill: "hsl(var(--primary))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex items-center justify-center gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-primary" />
            <span>Monthly Avg Rating</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 border-t-2 border-dashed border-muted-foreground" />
            <span>Overall Avg ({overallAvg.toFixed(2)})</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

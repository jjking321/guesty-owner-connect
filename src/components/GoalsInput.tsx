import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Save, Copy } from "lucide-react";

interface GoalsInputProps {
  listingId: string;
}

interface MonthlyGoal {
  month: number;
  budget: number;
  projection: number;
  goal: number;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GoalsInput({ listingId }: GoalsInputProps) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [goals, setGoals] = useState<MonthlyGoal[]>(
    monthNames.map((_, index) => ({ month: index + 1, budget: 0, projection: 0, goal: 0 }))
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadGoals();
  }, [listingId, year]);

  const loadGoals = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('property_goals')
        .select('*')
        .eq('listing_id', listingId)
        .eq('year', year);

      if (error) throw error;

      if (data && data.length > 0) {
        const loadedGoals = monthNames.map((_, index) => {
          const monthData = data.find(g => g.month === index + 1);
          return {
            month: index + 1,
            budget: monthData?.budget_revenue || 0,
            projection: monthData?.projection_revenue || 0,
            goal: monthData?.goal_revenue || 0,
          };
        });
        setGoals(loadedGoals);
      }
    } catch (error: any) {
      toast({
        title: "Error loading goals",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveGoals = async () => {
    setIsSaving(true);
    try {
      const upserts = goals.map(g => ({
        listing_id: listingId,
        year,
        month: g.month,
        budget_revenue: g.budget,
        projection_revenue: g.projection,
        goal_revenue: g.goal,
      }));

      const { error } = await supabase
        .from('property_goals')
        .upsert(upserts, { onConflict: 'listing_id,year,month' });

      if (error) throw error;

      toast({
        title: "Goals saved",
        description: `Successfully saved goals for ${year}`,
      });
    } catch (error: any) {
      toast({
        title: "Error saving goals",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const copyFromPreviousYear = async () => {
    const previousYear = year - 1;
    try {
      const { data, error } = await supabase
        .from('property_goals')
        .select('*')
        .eq('listing_id', listingId)
        .eq('year', previousYear);

      if (error) throw error;

      if (data && data.length > 0) {
        const copiedGoals = monthNames.map((_, index) => {
          const monthData = data.find(g => g.month === index + 1);
          return {
            month: index + 1,
            budget: monthData?.budget_revenue || 0,
            projection: monthData?.projection_revenue || 0,
            goal: monthData?.goal_revenue || 0,
          };
        });
        setGoals(copiedGoals);
        toast({
          title: "Goals copied",
          description: `Copied goals from ${previousYear}`,
        });
      } else {
        toast({
          title: "No data found",
          description: `No goals found for ${previousYear}`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error copying goals",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const updateGoal = (monthIndex: number, field: 'budget' | 'projection' | 'goal', value: string) => {
    const numValue = parseFloat(value) || 0;
    setGoals(prev => prev.map((g, i) => 
      i === monthIndex ? { ...g, [field]: numValue } : g
    ));
  };

  if (isLoading) {
    return <div>Loading goals...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Revenue Goals</CardTitle>
            <CardDescription>Set monthly revenue targets for Budget, Projection, and Goal</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="year" className="text-sm">Year:</Label>
            <Input
              id="year"
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="w-24"
            />
            <Button onClick={copyFromPreviousYear} variant="outline" size="sm">
              <Copy className="h-4 w-4 mr-2" />
              Copy from {year - 1}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4 font-medium text-sm text-muted-foreground pb-2 border-b">
            <div>Month</div>
            <div>Budget (Low)</div>
            <div>Projection (Expected)</div>
            <div>Goal (High)</div>
          </div>

          {goals.map((goal, index) => (
            <div key={goal.month} className="grid grid-cols-4 gap-4 items-center">
              <div className="font-medium">{monthNames[index]}</div>
              <Input
                type="number"
                value={goal.budget}
                onChange={(e) => updateGoal(index, 'budget', e.target.value)}
                placeholder="0"
                className="text-right"
              />
              <Input
                type="number"
                value={goal.projection}
                onChange={(e) => updateGoal(index, 'projection', e.target.value)}
                placeholder="0"
                className="text-right"
              />
              <Input
                type="number"
                value={goal.goal}
                onChange={(e) => updateGoal(index, 'goal', e.target.value)}
                placeholder="0"
                className="text-right"
              />
            </div>
          ))}

          <div className="pt-4 flex justify-end">
            <Button onClick={saveGoals} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving..." : "Save Goals"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
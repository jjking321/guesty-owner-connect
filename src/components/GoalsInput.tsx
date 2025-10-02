import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Copy } from "lucide-react";

interface GoalsInputProps {
  listingId: string;
}

interface MonthGoal {
  month: number;
  budget: string;
  projection: string;
  goal: string;
}

export function GoalsInput({ listingId }: GoalsInputProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [goals, setGoals] = useState<MonthGoal[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  useEffect(() => {
    loadGoals();
  }, [year, listingId]);

  const loadGoals = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('property_goals')
        .select('*')
        .eq('listing_id', listingId)
        .eq('year', year);

      if (error) throw error;

      // Initialize with existing data or empty values
      const goalsData: MonthGoal[] = Array.from({ length: 12 }, (_, i) => {
        const existingGoal = data?.find(g => g.month === i + 1);
        return {
          month: i + 1,
          budget: existingGoal?.budget_revenue?.toString() || '',
          projection: existingGoal?.projection_revenue?.toString() || '',
          goal: existingGoal?.goal_revenue?.toString() || '',
        };
      });

      setGoals(goalsData);
    } catch (error: any) {
      console.error('Error loading goals:', error);
      toast.error('Failed to load goals');
    } finally {
      setLoading(false);
    }
  };

  const handleGoalChange = (monthIndex: number, field: 'budget' | 'projection' | 'goal', value: string) => {
    const newGoals = [...goals];
    newGoals[monthIndex] = { ...newGoals[monthIndex], [field]: value };
    setGoals(newGoals);
  };

  const saveGoals = async () => {
    setSaving(true);
    try {
      // Prepare upsert data
      const upsertData = goals
        .filter(g => g.budget || g.projection || g.goal) // Only save rows with at least one value
        .map(g => ({
          listing_id: listingId,
          year,
          month: g.month,
          budget_revenue: parseFloat(g.budget) || 0,
          projection_revenue: parseFloat(g.projection) || 0,
          goal_revenue: parseFloat(g.goal) || 0,
        }));

      const { error } = await supabase
        .from('property_goals')
        .upsert(upsertData, {
          onConflict: 'listing_id,year,month',
        });

      if (error) throw error;

      toast.success('Goals saved successfully!');
    } catch (error: any) {
      console.error('Error saving goals:', error);
      toast.error('Failed to save goals');
    } finally {
      setSaving(false);
    }
  };

  const copyFromPreviousYear = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('property_goals')
        .select('*')
        .eq('listing_id', listingId)
        .eq('year', year - 1);

      if (error) throw error;

      if (!data || data.length === 0) {
        toast.error(`No goals found for ${year - 1}`);
        return;
      }

      const copiedGoals: MonthGoal[] = Array.from({ length: 12 }, (_, i) => {
        const previousGoal = data.find(g => g.month === i + 1);
        return {
          month: i + 1,
          budget: previousGoal?.budget_revenue?.toString() || '',
          projection: previousGoal?.projection_revenue?.toString() || '',
          goal: previousGoal?.goal_revenue?.toString() || '',
        };
      });

      setGoals(copiedGoals);
      toast.success(`Copied goals from ${year - 1}`);
    } catch (error: any) {
      console.error('Error copying goals:', error);
      toast.error('Failed to copy goals');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Set Revenue Goals</CardTitle>
            <CardDescription>
              Define monthly budget, projection, and goal targets for {year}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="w-24"
            />
            <Button variant="outline" onClick={copyFromPreviousYear} disabled={loading}>
              <Copy className="mr-2 h-4 w-4" />
              Copy {year - 1}
            </Button>
            <Button onClick={saveGoals} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Header Row */}
          <div className="grid grid-cols-4 gap-4 font-medium text-sm">
            <div>Month</div>
            <div>Budget (Low)</div>
            <div>Projection (Expected)</div>
            <div>Goal (High)</div>
          </div>

          {/* Data Rows */}
          {goals.map((monthGoal, index) => (
            <div key={monthGoal.month} className="grid grid-cols-4 gap-4 items-center">
              <Label className="font-medium">{monthNames[index]}</Label>
              <Input
                type="number"
                placeholder="$0"
                value={monthGoal.budget}
                onChange={(e) => handleGoalChange(index, 'budget', e.target.value)}
                className="w-full"
              />
              <Input
                type="number"
                placeholder="$0"
                value={monthGoal.projection}
                onChange={(e) => handleGoalChange(index, 'projection', e.target.value)}
                className="w-full"
              />
              <Input
                type="number"
                placeholder="$0"
                value={monthGoal.goal}
                onChange={(e) => handleGoalChange(index, 'goal', e.target.value)}
                className="w-full"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
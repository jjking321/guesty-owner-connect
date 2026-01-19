import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Save, Copy, Sparkles, Lock, Unlock, LockOpen, Database, BarChart3, AlertCircle, TrendingUp, ChevronUp, ChevronDown, Building2, History, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface GoalsInputProps {
  listingId: string;
}

interface MonthlyGoal {
  month: number;
  projection: number;
  locked: boolean;
  locked_at?: string;
  locked_by?: string;
  id?: string;
  source?: 'actuals' | 'compset' | 'fallback';
  isRampUp?: boolean;
  isPreListing?: boolean;
}

interface GenerationMetadata {
  dataSource: 'actuals' | 'compset' | 'fallback';
  hasFullYearActuals: boolean;
  actualsMonths: number;
  compsetMonths: number;
  rampUpMonths: number;
  preListingMonths: number;
  yoyGrowthRate: number;
  propertyStartDate: string | null;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GoalsInput({ listingId }: GoalsInputProps) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [goals, setGoals] = useState<MonthlyGoal[]>(
    monthNames.map((_, index) => ({ month: index + 1, projection: 0, locked: false }))
  );
  const [lockerProfiles, setLockerProfiles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMetadata, setGenerationMetadata] = useState<GenerationMetadata | null>(null);
  const { toast } = useToast();

  // Check if listing is composite
  const { data: listingDetails, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["listing-composite-status", listingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, is_composite")
        .eq("id", listingId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!listingId,
  });

  // Fetch last year's actuals from reservation_nights
  const { data: lastYearActuals } = useQuery({
    queryKey: ["property-actuals", listingId, year - 1],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reservation_nights')
        .select('night_date, revenue_allocation')
        .eq('listing_id', listingId)
        .gte('night_date', `${year - 1}-01-01`)
        .lte('night_date', `${year - 1}-12-31`);

      if (error) throw error;

      // Aggregate by month
      const byMonth: Record<number, number> = {};
      data?.forEach(night => {
        const month = new Date(night.night_date).getMonth() + 1;
        byMonth[month] = (byMonth[month] || 0) + Number(night.revenue_allocation);
      });

      const total = Object.values(byMonth).reduce((a, b) => a + b, 0);

      return { byMonth, total };
    },
    enabled: !!listingId,
  });

  // Fetch compset summary
  const { data: compsetSummary } = useQuery({
    queryKey: ["property-compset-summary", listingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_compset_summary')
        .select('avg_ttm_revenue, monthly_averages, selected_comparables_count')
        .eq('listing_id', listingId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!listingId,
  });

  useEffect(() => {
    loadGoals();
  }, [listingId, year]);

  const loadGoals = async () => {
    setIsLoading(true);
    setGenerationMetadata(null);
    try {
      const { data, error } = await supabase
        .from('property_goals')
        .select('*')
        .eq('listing_id', listingId)
        .eq('year', year);

      if (error) throw error;

      if (data && data.length > 0) {
        // Get unique locked_by user IDs
        const lockedByIds = [...new Set(data.filter(g => g.locked_by).map(g => g.locked_by))];
        
        // Fetch profile names for locked_by users
        if (lockedByIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', lockedByIds);

          if (!profileError && profiles) {
            const profileMap: Record<string, string> = {};
            profiles.forEach(p => {
              profileMap[p.id] = p.full_name || p.email;
            });
            setLockerProfiles(profileMap);
          }
        }

        const loadedGoals = monthNames.map((_, index) => {
          const monthData = data.find(g => g.month === index + 1);
          return {
            id: monthData?.id,
            month: index + 1,
            projection: monthData?.projection_revenue || 0,
            locked: monthData?.locked || false,
            locked_at: monthData?.locked_at,
            locked_by: monthData?.locked_by,
          };
        });
        setGoals(loadedGoals);
      } else {
        // Reset to empty goals when no data exists for this year
        setGoals(monthNames.map((_, index) => ({ 
          month: index + 1, 
          projection: 0, 
          locked: false 
        })));
        setLockerProfiles({});
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
      const upserts = goals.map(g => {
        const record: any = {
          listing_id: listingId,
          year,
          month: g.month,
          projection_revenue: g.projection,
          locked: g.locked,
        };
        // Only include id if it exists (for updates)
        if (g.id) {
          record.id = g.id;
        }
        return record;
      });

      const { error } = await supabase
        .from('property_goals')
        .upsert(upserts, { onConflict: 'listing_id,year,month' });

      if (error) throw error;

      toast({
        title: "Goals saved",
        description: `Successfully saved goals for ${year}`,
      });
      
      // Reload to get updated lock info
      await loadGoals();
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
            projection: monthData?.projection_revenue || 0,
            locked: false, // Copied goals are unlocked by default
          };
        });
        setGoals(copiedGoals);
        setGenerationMetadata(null);
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

  const generateAIGoals = async () => {
    setIsGenerating(true);
    try {
      console.log('Calling suggest-property-goals with:', { listingId, year });
      const { data, error } = await supabase.functions.invoke('suggest-property-goals', {
        body: { listingId, year }
      });

      console.log('Function response:', { data, error });

      if (error) {
        console.error('Function error:', error);
        throw error;
      }

      // Check for credit limit error
      if (data && data.code === 402) {
        toast({
          title: "Insufficient AI Credits",
          description: "Please add credits to your workspace to use AI features. Go to Settings → Workspace → Usage to add credits.",
          variant: "destructive",
        });
        return;
      }

      if (data && data.goals) {
        const aiGoals = monthNames.map((_, index) => {
          const monthData = data.goals.find((g: any) => g.month === index + 1);
          const existingGoal = goals[index];
          return {
            month: index + 1,
            projection: monthData?.projection || 0,
            locked: existingGoal?.locked || false, // Preserve lock state
            locked_at: existingGoal?.locked_at,
            locked_by: existingGoal?.locked_by,
            id: existingGoal?.id,
            source: monthData?.source,
            isRampUp: monthData?.isRampUp,
            isPreListing: monthData?.isPreListing,
          };
        });
        setGoals(aiGoals);
        
        // Store metadata for display
        if (data.metadata) {
          setGenerationMetadata({
            dataSource: data.dataSource,
            ...data.metadata
          });
        }

        toast({
          title: "Goals Generated",
          description: data.reasoning || `Goals generated based on ${data.dataSource || 'available'} data`,
        });
      }
    } catch (error: any) {
      console.error('Error generating goals:', error);
      toast({
        title: "Error generating goals",
        description: error.message || "Failed to generate goal suggestions",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const updateGoal = (monthIndex: number, value: string) => {
    const numValue = parseFloat(value) || 0;
    setGoals(prev => prev.map((g, i) => 
      i === monthIndex ? { ...g, projection: numValue } : g
    ));
  };

  const toggleLock = (monthIndex: number) => {
    setGoals(prev => prev.map((g, i) => 
      i === monthIndex ? { ...g, locked: !g.locked } : g
    ));
  };

  const lockAllGoals = () => {
    setGoals(prev => prev.map(g => ({ ...g, locked: true })));
  };

  const unlockAllGoals = () => {
    setGoals(prev => prev.map(g => ({ ...g, locked: false })));
  };

  const adjustGoalsUp = () => {
    setGoals(prev => prev.map(g => 
      g.locked ? g : { ...g, projection: Math.round(g.projection * 1.05) }
    ));
  };

  const adjustGoalsDown = () => {
    setGoals(prev => prev.map(g => 
      g.locked ? g : { ...g, projection: Math.round(g.projection * 0.95) }
    ));
  };

  const getSourceIcon = (source?: string) => {
    switch (source) {
      case 'actuals':
        return <Database className="h-3 w-3 text-green-600" />;
      case 'compset':
        return <BarChart3 className="h-3 w-3 text-blue-600" />;
      case 'fallback':
        return <AlertCircle className="h-3 w-3 text-amber-600" />;
      default:
        return null;
    }
  };

  const getSourceLabel = (source?: string) => {
    switch (source) {
      case 'actuals':
        return 'From last year actuals (+5% growth)';
      case 'compset':
        return 'From compset historical averages';
      case 'fallback':
        return 'Estimated from available data';
      default:
        return null;
    }
  };

  // These hooks must be before any early returns
  const totalGoal = useMemo(() => goals.reduce((sum, goal) => sum + goal.projection, 0), [goals]);
  
  const percentDiffFromLastYear = useMemo(() => {
    if (!lastYearActuals?.total || lastYearActuals.total === 0) return null;
    return ((totalGoal - lastYearActuals.total) / lastYearActuals.total) * 100;
  }, [totalGoal, lastYearActuals?.total]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (isLoading || isLoadingDetails) {
    return <div>Loading goals...</div>;
  }

  // Show info card for composite listings
  if (listingDetails?.is_composite) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Composite Listing</CardTitle>
          </div>
          <CardDescription className="mt-2">
            This is a composite ("Full") listing that represents all units booked together. 
            Revenue from bookings on this listing is automatically distributed to individual units.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">Why are goals disabled?</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Goals are tracked at the individual unit level, not on composite listings</li>
              <li>Revenue from Full bookings is attributed proportionally to each child unit</li>
              <li>This prevents double-counting revenue in reports and forecasts</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Revenue Goals</CardTitle>
            <CardDescription>Set monthly revenue goals</CardDescription>
            <div className="mt-2 text-2xl font-bold text-primary">
              {formatCurrency(totalGoal)}
            </div>
            
            {/* Reference data: Last Year Actuals and Compset */}
            <div className="flex flex-wrap gap-4 mt-2 text-sm">
              {lastYearActuals && lastYearActuals.total > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                        <History className="h-3.5 w-3.5" />
                        <span>{year - 1} Actual:</span>
                        <span className="font-medium text-foreground">
                          {formatCurrency(lastYearActuals.total)}
                        </span>
                        {percentDiffFromLastYear !== null && (
                          <span className={percentDiffFromLastYear >= 0 ? 'text-green-600' : 'text-red-600'}>
                            ({percentDiffFromLastYear >= 0 ? '+' : ''}{percentDiffFromLastYear.toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>Actual revenue from {year - 1} based on reservation nights.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {compsetSummary && compsetSummary.avg_ttm_revenue && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5 text-muted-foreground cursor-help">
                        <Users className="h-3.5 w-3.5" />
                        <span>Compset TTM:</span>
                        <span className="font-medium text-foreground">
                          {formatCurrency(compsetSummary.avg_ttm_revenue)}
                        </span>
                        <span className="text-xs">
                          ({compsetSummary.selected_comparables_count} props)
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>Average trailing twelve month revenue from {compsetSummary.selected_comparables_count} selected comparable properties.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
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
            <Button onClick={generateAIGoals} variant="outline" size="sm" disabled={isGenerating}>
              <Sparkles className="h-4 w-4 mr-2" />
              {isGenerating ? "Generating..." : "Auto-Generate"}
            </Button>
            <Button onClick={copyFromPreviousYear} variant="outline" size="sm">
              <Copy className="h-4 w-4 mr-2" />
              Copy from {year - 1}
            </Button>
          </div>
        </div>
        
        {/* Generation metadata badge */}
        {generationMetadata && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
            <Badge variant="outline" className="text-xs">
              {generationMetadata.dataSource === 'actuals' && (
                <><Database className="h-3 w-3 mr-1 text-green-600" /> Based on {year - 1} actuals</>
              )}
              {generationMetadata.dataSource === 'compset' && (
                <><BarChart3 className="h-3 w-3 mr-1 text-blue-600" /> Based on compset data</>
              )}
              {generationMetadata.dataSource === 'fallback' && (
                <><AlertCircle className="h-3 w-3 mr-1 text-amber-600" /> Limited data available</>
              )}
            </Badge>
            {generationMetadata.hasFullYearActuals && (
              <Badge variant="secondary" className="text-xs">
                <TrendingUp className="h-3 w-3 mr-1" />
                +{Math.round(generationMetadata.yoyGrowthRate * 100)}% YoY growth
              </Badge>
            )}
            {generationMetadata.rampUpMonths > 0 && (
              <Badge variant="secondary" className="text-xs text-amber-700">
                {generationMetadata.rampUpMonths} ramp-up months (70%)
              </Badge>
            )}
            {generationMetadata.preListingMonths > 0 && (
              <Badge variant="secondary" className="text-xs text-muted-foreground">
                {generationMetadata.preListingMonths} pre-listing months
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-end gap-2 mb-4">
            <Button onClick={adjustGoalsDown} variant="outline" size="sm">
              <ChevronDown className="h-4 w-4 mr-1" />
              -5%
            </Button>
            <Button onClick={adjustGoalsUp} variant="outline" size="sm">
              <ChevronUp className="h-4 w-4 mr-1" />
              +5%
            </Button>
            <Button onClick={lockAllGoals} variant="outline" size="sm">
              <Lock className="h-4 w-4 mr-2" />
              Lock All
            </Button>
            <Button onClick={unlockAllGoals} variant="outline" size="sm">
              <LockOpen className="h-4 w-4 mr-2" />
              Unlock All
            </Button>
          </div>

          <div className="grid grid-cols-4 gap-4 font-medium text-sm text-muted-foreground pb-2 border-b">
            <div>Month</div>
            <div>Goal</div>
            <div className="text-center">Source</div>
            <div className="text-center">Lock</div>
          </div>

          <TooltipProvider>
            {goals.map((goal, index) => (
              <div 
                key={goal.month} 
                className={`grid grid-cols-4 gap-4 items-center p-2 rounded ${
                  goal.locked ? 'bg-muted/50' : ''
                } ${goal.isPreListing ? 'opacity-50' : ''} ${goal.isRampUp ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}
              >
                <div className="font-medium flex items-center gap-2">
                  {monthNames[index]}
                  {goal.isRampUp && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="text-xs px-1 py-0 text-amber-700 border-amber-300">
                          70%
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Ramp-up period: New property, goal set to 70% of target
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {goal.isPreListing && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="text-xs px-1 py-0 text-muted-foreground">
                          N/A
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Property not under management during this month
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <Input
                  type="number"
                  value={goal.projection}
                  onChange={(e) => updateGoal(index, e.target.value)}
                  placeholder="0"
                  className="text-right"
                  disabled={goal.locked}
                />
                <div className="flex justify-center">
                  {goal.source && (
                    <Tooltip>
                      <TooltipTrigger>
                        {getSourceIcon(goal.source)}
                      </TooltipTrigger>
                      <TooltipContent>
                        {getSourceLabel(goal.source)}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="flex justify-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleLock(index)}
                        className={goal.locked ? 'text-green-600' : 'text-muted-foreground'}
                      >
                        {goal.locked ? (
                          <Lock className="h-4 w-4" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {goal.locked ? (
                        <div className="text-sm">
                          <p className="font-medium">Locked</p>
                          {goal.locked_by && lockerProfiles[goal.locked_by] && (
                            <p>by {lockerProfiles[goal.locked_by]}</p>
                          )}
                          {goal.locked_at && (
                            <p>{new Date(goal.locked_at).toLocaleDateString()}</p>
                          )}
                        </div>
                      ) : (
                        'Click to lock this goal'
                      )}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </TooltipProvider>

          <div className="pt-4 border-t flex justify-end">
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
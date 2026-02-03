import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ActionableSummary } from "@/components/ActionableSummary";
import { PropertyActionableCard } from "@/components/PropertyActionableCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Search, Filter } from "lucide-react";
import { toast } from "sonner";

interface Issue {
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  score: number;
  title: string;
  description: string;
  affected_dates?: string[];
  revenue_impact?: number;
  data_snapshot?: Record<string, unknown>;
}

interface PropertyActionable {
  id: string;
  listing_id: string;
  organization_id: string;
  total_issue_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  aggregate_score: number;
  issues: Issue[];
  ai_summary: string | null;
  dismissed: boolean;
  generated_at: string;
  listings: {
    id: string;
    nickname: string | null;
    thumbnail: string | null;
  } | null;
}

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  { value: 'unbookable_gap', label: 'Unbookable Gaps' },
  { value: 'low_rating', label: 'Low Rating' },
  { value: 'low_probability', label: 'Low Probability' },
  { value: 'forecast_miss', label: 'Forecast Gap' },
  { value: 'recent_low_review', label: 'Recent Low Reviews' },
  { value: 'missing_goals', label: 'Missing Goals' },
  { value: 'pricing_high', label: 'Overpriced' },
  { value: 'pricing_low', label: 'Underpriced' },
];

export default function Actionables() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const queryClient = useQueryClient();

  const { data: actionables, isLoading, error } = useQuery({
    queryKey: ['property-actionables', showDismissed],
    queryFn: async () => {
      const query = supabase
        .from('property_actionables')
        .select(`
          *,
          listings (
            id,
            nickname,
            thumbnail
          )
        `)
        .order('aggregate_score', { ascending: false });

      if (!showDismissed) {
        query.eq('dismissed', false);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      
      // Transform the data to match our interface
      return (data || []).map(item => ({
        ...item,
        issues: (item.issues as unknown as Issue[]) || [],
      })) as PropertyActionable[];
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-actionables');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['property-actionables'] });
      toast.success(`Refreshed actionables: ${data.properties_with_issues} properties with ${data.total_issues} issues`);
    },
    onError: (error) => {
      toast.error(`Failed to refresh: ${error.message}`);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('property_actionables')
        .update({ 
          dismissed: true, 
          dismissed_at: new Date().toISOString() 
        })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-actionables'] });
      toast.success('Property dismissed');
    },
    onError: (error) => {
      toast.error(`Failed to dismiss: ${error.message}`);
    },
  });

  // Filter actionables
  const filteredActionables = actionables?.filter(item => {
    // Search filter
    const propertyName = item.listings?.nickname || 'Unknown Property';
    if (searchQuery && !propertyName.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Category filter
    if (categoryFilter !== 'all') {
      const hasCategory = item.issues.some(issue => issue.category === categoryFilter);
      if (!hasCategory) return false;
    }

    return true;
  }) || [];

  // Calculate summary stats
  const summary = {
    totalProperties: filteredActionables.length,
    totalIssues: filteredActionables.reduce((sum, p) => sum + p.total_issue_count, 0),
    criticalCount: filteredActionables.reduce((sum, p) => sum + p.critical_count, 0),
    highCount: filteredActionables.reduce((sum, p) => sum + p.high_count, 0),
    mediumCount: filteredActionables.reduce((sum, p) => sum + p.medium_count, 0),
    lowCount: filteredActionables.reduce((sum, p) => sum + p.low_count, 0),
    lastGenerated: actionables?.[0]?.generated_at || null,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Actionables</h1>
            <p className="text-muted-foreground">
              Properties needing your attention, ranked by urgency
            </p>
          </div>
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            {refreshMutation.isPending ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {/* Summary */}
        <ActionableSummary {...summary} />

        {/* Filters */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search properties..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showDismissed ? "secondary" : "outline"}
              onClick={() => setShowDismissed(!showDismissed)}
            >
              {showDismissed ? 'Hide Dismissed' : 'Show Dismissed'}
            </Button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">Error loading actionables: {error.message}</p>
          </div>
        ) : filteredActionables.length === 0 ? (
          <div className="text-center py-12 bg-muted/50 rounded-lg">
            <h3 className="text-lg font-medium">No actionable items found</h3>
            <p className="text-muted-foreground mt-1">
              {searchQuery || categoryFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'All properties are in good shape!'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredActionables.map((item, index) => (
              <PropertyActionableCard
                key={item.id}
                rank={index + 1}
                propertyId={item.listing_id}
                propertyName={item.listings?.nickname || 'Unknown Property'}
                thumbnail={item.listings?.thumbnail}
                aggregateScore={item.aggregate_score}
                issues={item.issues}
                aiSummary={item.ai_summary}
                dismissed={item.dismissed}
                criticalCount={item.critical_count}
                highCount={item.high_count}
                mediumCount={item.medium_count}
                lowCount={item.low_count}
                onDismiss={() => dismissMutation.mutate(item.id)}
                isDismissing={dismissMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

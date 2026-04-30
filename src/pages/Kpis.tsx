import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/DashboardLayout';
import { KpiControls } from '@/components/kpis/KpiControls';
import { KpiCard } from '@/components/kpis/KpiCard';
import { ManageChurnDrawer } from '@/components/kpis/ManageChurnDrawer';
import { Building2, DollarSign, TrendingDown, Star } from 'lucide-react';
import { resolveRange, resolveCompare, COMPARE_LABELS } from '@/lib/kpis/range';
import {
  fetchListingGrowth, fetchGbv, fetchChurn, fetchReviewScore, type ReviewScoreMode,
} from '@/lib/kpis/dataFetcher';
import type { Aggregation, ComparePreset, KpiRange } from '@/lib/kpis/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Kpis() {
  const [aggregation, setAggregation] = useState<Aggregation>('monthly');
  const [range, setRange] = useState<KpiRange>({ preset: 'ytd' });
  const [compare, setCompare] = useState<ComparePreset>('last_year');
  const [reviewMode, setReviewMode] = useState<ReviewScoreMode>('period');

  const resolved = useMemo(() => resolveRange(range), [range]);
  const compareResolved = useMemo(() => resolveCompare(resolved, compare), [resolved, compare]);
  const compareLabel = compare === 'none' ? null : COMPARE_LABELS[compare];

  const queryKey = [resolved.start.toISOString(), resolved.end.toISOString(), aggregation, compare];

  const listingsQ = useQuery({
    queryKey: ['kpi-listings', ...queryKey],
    queryFn: () => fetchListingGrowth(resolved, aggregation, compareResolved),
  });
  const gbvQ = useQuery({
    queryKey: ['kpi-gbv', ...queryKey],
    queryFn: () => fetchGbv(resolved, aggregation, compareResolved),
  });
  const churnQ = useQuery({
    queryKey: ['kpi-churn', ...queryKey],
    queryFn: () => fetchChurn(resolved, aggregation, compareResolved),
  });
  const reviewQ = useQuery({
    queryKey: ['kpi-reviews', ...queryKey, reviewMode],
    queryFn: () => fetchReviewScore(resolved, aggregation, compareResolved, reviewMode),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">KPI Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Track key business metrics over time. {resolved.label}
            </p>
          </div>
          <ManageChurnDrawer />
        </div>

        <div className="rounded-lg border bg-card p-4">
          <KpiControls
            aggregation={aggregation}
            range={range}
            compare={compare}
            onAggregationChange={setAggregation}
            onRangeChange={setRange}
            onCompareChange={setCompare}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <KpiCard
            title="Active & listed units"
            icon={Building2}
            result={listingsQ.data}
            isLoading={listingsQ.isLoading}
            error={listingsQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
          />
          <KpiCard
            title="Gross Booking Value"
            icon={DollarSign}
            result={gbvQ.data}
            isLoading={gbvQ.isLoading}
            error={gbvQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="bar"
          />
          <KpiCard
            title="Churned units"
            icon={TrendingDown}
            result={churnQ.data}
            isLoading={churnQ.isLoading}
            error={churnQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="bar"
          />
          <KpiCard
            title="Guest review score"
            icon={Star}
            result={reviewQ.data}
            isLoading={reviewQ.isLoading}
            error={reviewQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
            rightSlot={
              <Select value={reviewMode} onValueChange={(v) => setReviewMode(v as ReviewScoreMode)}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="period">Reviews in period</SelectItem>
                  <SelectItem value="lifetime">Lifetime as of period</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </div>
      </div>
    </DashboardLayout>
  );
}

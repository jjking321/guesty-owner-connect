import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/DashboardLayout';
import { KpiControls } from '@/components/kpis/KpiControls';
import { KpiCard } from '@/components/kpis/KpiCard';
import { ManageChurnDrawer } from '@/components/kpis/ManageChurnDrawer';
import { KpiDetailSheet } from '@/components/kpis/KpiDetailSheet';
import { BackfillSubtotals } from '@/components/BackfillSubtotals';
import { Building2, DollarSign, TrendingDown, Star, SlidersHorizontal } from 'lucide-react';
import { resolveRange, resolveCompare, COMPARE_LABELS } from '@/lib/kpis/range';
import {
  fetchListingGrowth, fetchGbv, fetchChurn, fetchReviewScore, type ReviewScoreMode,
  type BucketWindow,
} from '@/lib/kpis/dataFetcher';
import type { Aggregation, ComparePreset, KpiMetric, KpiRange } from '@/lib/kpis/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TITLES: Record<KpiMetric, string> = {
  listings: 'Active & listed units',
  gbv: 'Gross Booking Value',
  churn: 'Churned units',
  reviews: 'Guest review score',
};

export default function Kpis() {
  const [aggregation, setAggregation] = useState<Aggregation>('monthly');
  const [range, setRange] = useState<KpiRange>({ preset: 'ytd' });
  const [compare, setCompare] = useState<ComparePreset>('last_year');
  const [reviewMode, setReviewMode] = useState<ReviewScoreMode>('period');

  const [drilldown, setDrilldown] = useState<{ metric: KpiMetric; window: BucketWindow; label: string } | null>(null);

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

  const openBucket = (metric: KpiMetric) => (start: Date, end: Date | null, label: string) => {
    setDrilldown({
      metric,
      window: { start, end: end ?? resolved.end },
      label,
    });
  };
  const openHeadline = (metric: KpiMetric) => () => {
    setDrilldown({
      metric,
      window: { start: resolved.start, end: resolved.end },
      label: resolved.label,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">KPI Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Track key business metrics over time. {resolved.label}
          </p>
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
            description="Currently listed on a channel and enabled in Guesty"
            helpText="Counts listings where Guesty's isListed is true (published on at least one channel) AND active is true (enabled in Guesty) AND not archived in our system. Past values use historical snapshots when available, otherwise a backfill from Guesty createdAt."
            icon={Building2}
            result={listingsQ.data}
            isLoading={listingsQ.isLoading}
            error={listingsQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
            onSelectBucket={openBucket('listings')}
            onClickHeadline={openHeadline('listings')}
          />
          <KpiCard
            title="Gross Booking Value"
            description="Subtotal incl. fees, excl. taxes"
            helpText="Sum of Guesty subTotalPrice (accommodation fare + cleaning + extras + guest service fees, excluding taxes) for reservations checking in within the bucket. Excludes owner stays and cancellations. Falls back to fare_accommodation_adjusted when subTotal is not yet backfilled."
            icon={DollarSign}
            result={gbvQ.data}
            isLoading={gbvQ.isLoading}
            error={gbvQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="bar"
            onSelectBucket={openBucket('gbv')}
            onClickHeadline={openHeadline('gbv')}
          />
          <KpiCard
            title="Churned units"
            description="Listings that went unlisted + inactive"
            helpText="A listing is considered churned when both isListed and active are false in Guesty. The churn date uses a manual churn event when available, otherwise Guesty's lastActivityAt; if that is missing or older than the listing creation date, it uses Guesty's createdAt so newly added churned units are counted in the right year."
            icon={TrendingDown}
            result={churnQ.data}
            isLoading={churnQ.isLoading}
            error={churnQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="bar"
            onSelectBucket={openBucket('churn')}
            onClickHeadline={openHeadline('churn')}
            rightSlot={
              <ManageChurnDrawer
                trigger={
                  <button type="button" className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8 -mr-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="sr-only">Manage churned units</span>
                  </button>
                }
              />
            }
          />
          <KpiCard
            title="Guest review score"
            description="Average guest rating"
            helpText="Average rating across all platforms. 'Reviews in period' averages reviews dated within the bucket; 'Lifetime as of period' shows cumulative average up to that date."
            icon={Star}
            result={reviewQ.data}
            isLoading={reviewQ.isLoading}
            error={reviewQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
            onSelectBucket={openBucket('reviews')}
            onClickHeadline={openHeadline('reviews')}
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

        <div className="space-y-2">
          <div>
            <h2 className="text-lg font-semibold">Backfill Gross Booking Value</h2>
            <p className="text-sm text-muted-foreground">
              GBV uses Guesty's <code className="text-xs bg-muted px-1 py-0.5 rounded">money.subTotal</code> when available.
              Run a backfill below for any months still falling back to fare-only revenue.
            </p>
          </div>
          <BackfillSubtotals />
        </div>
      </div>

      <KpiDetailSheet
        open={!!drilldown}
        onOpenChange={(o) => { if (!o) setDrilldown(null); }}
        metric={drilldown?.metric ?? null}
        window={drilldown?.window ?? null}
        title={drilldown ? TITLES[drilldown.metric] : ''}
        bucketLabel={drilldown?.label}
      />
    </DashboardLayout>
  );
}

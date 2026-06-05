import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/DashboardLayout';
import { KpiControls } from '@/components/kpis/KpiControls';
import { KpiCard } from '@/components/kpis/KpiCard';
import { ManageChurnDrawer } from '@/components/kpis/ManageChurnDrawer';
import { KpiDetailSheet } from '@/components/kpis/KpiDetailSheet';
import { BackfillSubtotals } from '@/components/BackfillSubtotals';
import { Building2, DollarSign, TrendingDown, Star, SlidersHorizontal, TrendingUp, Users, PieChart as PieIcon, Banknote, XCircle, Settings, FileDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip, Legend } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { resolveRange, resolveCompare, COMPARE_LABELS } from '@/lib/kpis/range';
import {
  fetchListingGrowth, fetchGbv, fetchChurn, fetchReviewScore, type ReviewScoreMode,
  fetchNetGrowth, fetchOwnerConcentration, fetchChannelMix, fetchAdr, fetchCancellationRate,
  type BucketWindow,
} from '@/lib/kpis/dataFetcher';
import type { Aggregation, ComparePreset, KpiMetric, KpiRange } from '@/lib/kpis/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const TITLES: Record<KpiMetric, string> = {
  listings: 'Active & listed units',
  gbv: 'Gross Booking Value',
  churn: 'Churned units',
  reviews: 'Guest review score',
  net_growth: 'Net unit growth',
  owner_concentration: 'Owner concentration',
  channel_mix: 'Channel mix',
  adr: 'Average Daily Rate',
  cancellation: 'Cancellation rate',
};

export default function Kpis() {
  const [aggregation, setAggregation] = useState<Aggregation>('monthly');
  const [range, setRange] = useState<KpiRange>({ preset: 'ytd' });
  const [compare, setCompare] = useState<ComparePreset>('last_year');
  const [reviewMode, setReviewMode] = useState<ReviewScoreMode>('period');

  const [drilldown, setDrilldown] = useState<{ metric: KpiMetric; window: BucketWindow; label: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const exportPdf = async () => {
    if (!exportRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(exportRef.current, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
      const img = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const headerH = 70;
      // Header banner
      pdf.setFillColor(15, 23, 42);
      pdf.rect(0, 0, pageW, headerH, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.text('RevMan', 32, 38);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.text('KPI Dashboard', 32, 56);
      pdf.setFontSize(9);
      pdf.text(`${resolved.label} · Generated ${new Date().toLocaleString()}`, pageW - 32, 56, { align: 'right' });
      // Content image, fit width
      const margin = 24;
      const contentW = pageW - margin * 2;
      const imgH = (canvas.height * contentW) / canvas.width;
      let y = headerH + 16;
      let remaining = imgH;
      let srcY = 0;
      const pageContentH = pageH - y - 24;
      const ratio = canvas.width / contentW;
      // Slice the canvas into pages
      while (remaining > 0) {
        const sliceH = Math.min(pageContentH, remaining);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceH * ratio;
        const ctx = sliceCanvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, srcY, canvas.width, sliceCanvas.height, 0, 0, sliceCanvas.width, sliceCanvas.height);
        pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, y, contentW, sliceH);
        srcY += sliceCanvas.height;
        remaining -= sliceH;
        if (remaining > 0) {
          pdf.addPage();
          // Reprint header on each page
          pdf.setFillColor(15, 23, 42);
          pdf.rect(0, 0, pageW, headerH, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(22);
          pdf.text('RevMan', 32, 38);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.text('KPI Dashboard', 32, 56);
          y = headerH + 16;
        }
      }
      pdf.save(`revman-kpis-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

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
  const netGrowthQ = useQuery({
    queryKey: ['kpi-net-growth', ...queryKey],
    queryFn: () => fetchNetGrowth(resolved, aggregation, compareResolved),
  });
  const ownerConcQ = useQuery({
    queryKey: ['kpi-owner-concentration', ...queryKey],
    queryFn: () => fetchOwnerConcentration(resolved, aggregation, compareResolved),
  });
  const channelMixQ = useQuery({
    queryKey: ['kpi-channel-mix', ...queryKey],
    queryFn: () => fetchChannelMix(resolved, aggregation, compareResolved),
  });
  const adrQ = useQuery({
    queryKey: ['kpi-adr', ...queryKey],
    queryFn: () => fetchAdr(resolved, aggregation, compareResolved),
  });
  const cancelQ = useQuery({
    queryKey: ['kpi-cancellation', ...queryKey],
    queryFn: () => fetchCancellationRate(resolved, aggregation, compareResolved),
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">KPI Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Track key business metrics over time. {resolved.label}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportPdf} disabled={exporting}>
              <FileDown className="h-4 w-4 mr-1" />
              {exporting ? 'Exporting…' : 'Export PDF'}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[420px]">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Backfill Gross Booking Value</h3>
                  <p className="text-xs text-muted-foreground">
                    GBV uses Guesty's <code className="text-[10px] bg-muted px-1 py-0.5 rounded">money.subTotal</code> when available.
                    Run a backfill for any months still falling back to fare-only revenue.
                  </p>
                  <BackfillSubtotals />
                </div>
              </PopoverContent>
            </Popover>
          </div>

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

        <div ref={exportRef} className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-background p-2 rounded-lg">
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
          <KpiCard
            title="Net unit growth"
            description="Additions minus churned units per bucket"
            helpText="Net = listings added (by Guesty createdAt) minus listings churned (using the same signal as Churned units) within each bucket. Excludes archived listings."
            icon={TrendingUp}
            result={netGrowthQ.data}
            isLoading={netGrowthQ.isLoading}
            error={netGrowthQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
            onSelectBucket={openBucket('net_growth')}
            onClickHeadline={openHeadline('net_growth')}
          />
          <KpiCard
            title="Owner concentration"
            description="Share of portfolio held by top owner"
            helpText="Largest owner's share of currently active & listed units. Click any owner to see all owners."
            icon={Users}
            result={ownerConcQ.data}
            isLoading={ownerConcQ.isLoading}
            error={ownerConcQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
            onClickHeadline={openHeadline('owner_concentration')}
            customBody={<OwnerConcentrationList data={ownerConcQ.data} onOpen={openHeadline('owner_concentration')} />}
          />
          <KpiCard
            title="Channel mix"
            description="GBV share by channel"
            helpText="Reservations grouped by source (Airbnb, Vrbo/HomeAway, Booking.com, Direct, Other). Click a slice to drill into all channels."
            icon={PieIcon}
            result={channelMixQ.data}
            isLoading={channelMixQ.isLoading}
            error={channelMixQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="bar"
            onClickHeadline={openHeadline('channel_mix')}
            customBody={<ChannelMixPie data={channelMixQ.data} onOpen={openHeadline('channel_mix')} />}
          />

          <KpiCard
            title="Average Daily Rate"
            description="GBV per booked night"
            helpText="Sum of reservation subtotal (or fare fallback) divided by total nights, for reservations checking in within the bucket. Excludes owner stays and cancellations."
            icon={Banknote}
            result={adrQ.data}
            isLoading={adrQ.isLoading}
            error={adrQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
            onSelectBucket={openBucket('adr')}
            onClickHeadline={openHeadline('adr')}
          />
          <KpiCard
            title="Cancellation rate"
            description="Cancellations ÷ bookings (by booking date)"
            helpText="Reservations are bucketed by Guesty createdAt (when the booking was made). Rate = canceled / (confirmed + checked_in + checked_out + canceled). Excludes owner stays and inquiries/expired/declined."
            icon={XCircle}
            result={cancelQ.data}
            isLoading={cancelQ.isLoading}
            error={cancelQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="line"
            onSelectBucket={openBucket('cancellation')}
            onClickHeadline={openHeadline('cancellation')}
          />
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

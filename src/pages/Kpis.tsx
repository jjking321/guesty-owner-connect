import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/DashboardLayout';
import { KpiControls } from '@/components/kpis/KpiControls';
import { KpiCard } from '@/components/kpis/KpiCard';
import { ManageChurnDrawer } from '@/components/kpis/ManageChurnDrawer';
import { KpiDetailSheet } from '@/components/kpis/KpiDetailSheet';
import { BackfillSubtotals } from '@/components/BackfillSubtotals';
import { Building2, DollarSign, TrendingDown, Star, SlidersHorizontal, TrendingUp, Users, PieChart as PieIcon, Banknote, XCircle, Settings, FileDown, Home } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip, Legend } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { resolveRange, resolveCompare, COMPARE_LABELS } from '@/lib/kpis/range';
import {
  fetchListingGrowth, fetchGbv, fetchChurn, fetchReviewScore, type ReviewScoreMode,
  fetchNetGrowth, fetchOwnerConcentration, fetchChannelMix, fetchAdr, fetchCancellationRate,
  fetchRevenuePerListing,
  type BucketWindow,
} from '@/lib/kpis/dataFetcher';
import type { Aggregation, ComparePreset, KpiMetric, KpiRange } from '@/lib/kpis/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrgBranding, hexToRgb } from '@/lib/branding';

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
  revenue_per_listing: 'Revenue per listing',
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
  const branding = useOrgBranding();

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
      const [pr, pg, pb] = hexToRgb(branding.primary);
      const [sr, sg, sb] = hexToRgb(branding.secondary);

      // Try to load the logo as image element
      let logoImg: HTMLImageElement | null = null;
      if (branding.logoUrl) {
        try {
          logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = branding.logoUrl!;
          });
        } catch { logoImg = null; }
      }

      const drawHeader = () => {
        pdf.setFillColor(pr, pg, pb);
        pdf.rect(0, 0, pageW, headerH, 'F');
        pdf.setFillColor(sr, sg, sb);
        pdf.rect(0, headerH - 3, pageW, 3, 'F');
        pdf.setTextColor(255, 255, 255);
        let textX = 32;
        if (logoImg) {
          const maxH = 44;
          const ratio = logoImg.width / logoImg.height;
          const h = maxH;
          const w = h * ratio;
          try { pdf.addImage(logoImg, 'PNG', 32, (headerH - h) / 2, w, h); } catch { /* ignore */ }
          textX = 32 + w + 16;
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(22);
        pdf.text(branding.name || 'KPI Report', textX, 38);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.text('KPI Dashboard', textX, 56);
        pdf.setFontSize(9);
        pdf.text(`${resolved.label} · Generated ${new Date().toLocaleString()}`, pageW - 32, 56, { align: 'right' });
      };

      drawHeader();
      // Content image, fit width
      const margin = 24;
      const contentW = pageW - margin * 2;
      const imgH = (canvas.height * contentW) / canvas.width;
      let y = headerH + 16;
      let remaining = imgH;
      let srcY = 0;
      const pageContentH = pageH - y - 24;
      const ratio = canvas.width / contentW;
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
          drawHeader();
          y = headerH + 16;
        }
      }
      pdf.save(`${(branding.name || 'kpis').toLowerCase().replace(/\s+/g, '-')}-kpis-${new Date().toISOString().slice(0, 10)}.pdf`);
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
  const revPerListingQ = useQuery({
    queryKey: ['kpi-revenue-per-listing', ...queryKey],
    queryFn: () => fetchRevenuePerListing(resolved, aggregation, compareResolved),
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
          <KpiCard
            title="Revenue per listing"
            description="GBV ÷ average active listings"
            helpText="Total GBV in the period divided by the average number of currently active & listed units across the bucketed periods. Excludes owner reservations and cancellations."
            icon={Home}
            result={revPerListingQ.data}
            isLoading={revPerListingQ.isLoading}
            error={revPerListingQ.error as Error | null}
            primaryLabel={resolved.label}
            compareLabel={compareLabel}
            chartType="bar"
            onSelectBucket={openBucket('revenue_per_listing')}
            onClickHeadline={openHeadline('revenue_per_listing')}
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

const PIE_COLORS = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#94a3b8'];

function ChannelMixPie({ data, onOpen }: { data: any; onOpen: () => void }) {
  const breakdown = (data?.meta?.breakdown ?? []) as Array<{ name: string; gbv: number; share: number }>;
  if (!breakdown.length) return <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">No channel data</div>;
  return (
    <div className="h-56 cursor-pointer" onClick={onOpen} title="Click for full breakdown">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={breakdown}
            dataKey="gbv"
            nameKey="name"
            cx="40%"
            cy="50%"
            outerRadius={75}
            label={(d: any) => `${(d.share * 100).toFixed(0)}%`}
            labelLine={false}
          >
            {breakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <RTooltip formatter={(v: any, _n: any, p: any) => [`$${Number(v).toLocaleString()} · ${(p.payload.share * 100).toFixed(1)}%`, p.payload.name]} />
          <Legend layout="vertical" verticalAlign="middle" align="right" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function OwnerConcentrationList({ data, onOpen }: { data: any; onOpen: () => void }) {
  const breakdown = (data?.meta?.breakdown ?? []) as Array<[string, number]>;
  const total = breakdown.reduce((a, [, n]) => a + n, 0);
  if (!breakdown.length) return <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">No owner data</div>;
  const topName = breakdown[0]?.[0] ?? '';
  return (
    <div className="space-y-2">
      {topName && (
        <p className="text-xs text-muted-foreground">
          Top owner: <span className="font-medium text-foreground">{topName}</span>
        </p>
      )}
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 cursor-pointer" onClick={onOpen} title="Click for full list">
        {breakdown.slice(0, 10).map(([ownerName, count], idx) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={`${ownerName}-${idx}`} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="truncate font-medium" title={ownerName}>{ownerName}</span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">{count} · {pct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {breakdown.length > 10 && (
          <p className="text-[10px] text-muted-foreground pt-1">+ {breakdown.length - 10} more · click to see all</p>
        )}
      </div>
    </div>
  );
}


import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, LucideIcon } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { KpiResult } from '@/lib/kpis/types';

interface Props {
  title: string;
  icon: LucideIcon;
  result?: KpiResult;
  isLoading: boolean;
  error?: Error | null;
  primaryLabel: string;
  compareLabel?: string | null;
  chartType?: 'line' | 'bar';
  rightSlot?: React.ReactNode;
  description?: string;
  helpText?: string;
  onSelectBucket?: (bucketStart: Date, bucketEnd: Date | null, bucketLabel: string) => void;
  onClickHeadline?: () => void;
}

function formatValue(v: number, unit: KpiResult['unit']): string {
  if (!isFinite(v)) return '—';
  switch (unit) {
    case 'currency':
      return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    case 'rating':
      return v.toFixed(2);
    case 'percent':
      return `${(v * 100).toFixed(1)}%`;
    default:
      return Math.round(v).toLocaleString('en-US');
  }
}

export function KpiCard({
  title, icon: Icon, result, isLoading, error,
  primaryLabel, compareLabel, chartType = 'line', rightSlot,
  description, helpText, onSelectBucket, onClickHeadline,
}: Props) {
  const delta =
    result?.compareTotal !== undefined && result.compareTotal !== 0
      ? ((result.total - result.compareTotal) / result.compareTotal) * 100
      : null;

  const handleChartClick = (e: any) => {
    if (!onSelectBucket || !e?.activePayload?.[0]?.payload) return;
    const p = e.activePayload[0].payload;
    onSelectBucket(new Date(p.bucketStart), p.bucketEnd ? new Date(p.bucketEnd) : null, p.bucket);
  };
  const handleCompareBarClick = (data: any) => {
    if (!onSelectBucket || !data?.compareBucketStart) return;
    onSelectBucket(
      new Date(data.compareBucketStart),
      data.compareBucketEnd ? new Date(data.compareBucketEnd) : null,
      data.compareBucket || compareLabel || 'Compare',
    );
  };

  const meta = result?.meta as { totalReservations?: number; withSubTotal?: number; usedFallback?: number } | undefined;
  const fallbackPct = meta && meta.totalReservations
    ? Math.round(((meta.usedFallback ?? 0) / meta.totalReservations) * 100)
    : null;

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <Icon className="w-5 h-5 text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-muted-foreground">{title}</p>
                {helpText && (
                  <TooltipProvider delayDuration={150}>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground/70 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">{helpText}</TooltipContent>
                    </UiTooltip>
                  </TooltipProvider>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {description ? `${description} · ` : ''}{primaryLabel}
              </p>
            </div>
          </div>
          {rightSlot}
        </div>

        {isLoading ? (
          <Skeleton className="h-10 w-32" />
        ) : error ? (
          <p className="text-sm text-destructive">Error: {error.message}</p>
        ) : result ? (
          <div className="space-y-1">
            <button
              type="button"
              className={`text-3xl font-bold text-left ${onClickHeadline ? 'hover:text-primary cursor-pointer transition-colors' : ''}`}
              onClick={onClickHeadline}
              disabled={!onClickHeadline}
            >
              {formatValue(result.total, result.unit)}
            </button>
            {result.compareTotal !== undefined && compareLabel && (
              <p className="text-xs text-muted-foreground">
                vs {compareLabel}: {formatValue(result.compareTotal, result.unit)}
                {delta !== null && (
                  <span className={delta >= 0 ? ' text-emerald-600' : ' text-red-600'}>
                    {' '}({delta >= 0 ? '+' : ''}{delta.toFixed(1)}%)
                  </span>
                )}
              </p>
            )}
            {fallbackPct != null && fallbackPct > 0 && (
              <p className="text-[11px] text-amber-600">
                Data quality: {meta!.withSubTotal}/{meta!.totalReservations} reservations have full subtotals; {fallbackPct}% fall back to accommodation fare only (lower bound).
              </p>
            )}
          </div>
        ) : null}

        {result && result.series.length > 0 && (() => {
          // For rating unit, zoom Y-axis tightly to data range so MoM changes are visible.
          let yDomain: [number | string, number | string] = ['auto', 'auto'];
          let yTicks: number[] | undefined;
          if (result.unit === 'rating') {
            const vals: number[] = [];
            for (const p of result.series) {
              if (typeof p.value === 'number' && p.value > 0) vals.push(p.value);
              if (typeof (p as any).compareValue === 'number' && (p as any).compareValue > 0) vals.push((p as any).compareValue);
            }
            if (vals.length > 0) {
              const mn = Math.min(...vals);
              const mx = Math.max(...vals);
              const pad = Math.max(0.05, (mx - mn) * 0.25 || 0.1);
              const lo = Math.max(1, Math.floor((mn - pad) * 20) / 20);
              const hi = Math.min(5, Math.ceil((mx + pad) * 20) / 20);
              yDomain = [lo, hi];
              const step = (hi - lo) <= 0.3 ? 0.05 : (hi - lo) <= 0.8 ? 0.1 : 0.25;
              yTicks = [];
              for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push(Number(v.toFixed(2)));
            }
          }
          return (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'bar' ? (
                <BarChart data={result.series}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v, result.unit)} width={70} domain={yDomain as any} ticks={yTicks} />
                  <Tooltip
                    formatter={(v: any) => formatValue(Number(v), result.unit)}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6 }}
                  />
                  {result.series.some((p) => p.compareValue !== undefined) && <Legend />}
                  <Bar dataKey="value" name={primaryLabel} fill="hsl(var(--primary))" cursor={onSelectBucket ? 'pointer' : undefined}
                       onClick={(d: any) => onSelectBucket && d?.bucketStart && onSelectBucket(new Date(d.bucketStart), d.bucketEnd ? new Date(d.bucketEnd) : null, d.bucket)} />
                  {result.series.some((p) => p.compareValue !== undefined) && (
                    <Bar dataKey="compareValue" name={compareLabel || 'Compare'} fill="hsl(var(--muted-foreground))" cursor={onSelectBucket ? 'pointer' : undefined} onClick={handleCompareBarClick} />
                  )}
                </BarChart>
              ) : (
                <LineChart data={result.series} onClick={handleChartClick}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v, result.unit)} width={70} domain={yDomain as any} ticks={yTicks} />
                  <Tooltip
                    formatter={(v: any) => formatValue(Number(v), result.unit)}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6 }}
                  />
                  {result.series.some((p) => p.compareValue !== undefined) && <Legend />}
                  <Line type="monotone" dataKey="value" name={primaryLabel} stroke="hsl(var(--primary))" strokeWidth={2} dot={!!onSelectBucket} activeDot={{ r: 6, cursor: onSelectBucket ? 'pointer' : undefined }} />
                  {result.series.some((p) => p.compareValue !== undefined) && (
                    <Line type="monotone" dataKey="compareValue" name={compareLabel || 'Compare'}
                          stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={2} dot={false} />
                  )}
                </LineChart>
              )}
            </ResponsiveContainer>

            {onSelectBucket && (
              <p className="text-[10px] text-muted-foreground mt-1 text-center">Click a bar/point to drill down · Click the headline number for the full period</p>
            )}
          </div>
          );
        })()}

      </CardContent>
    </Card>
  );
}

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LucideIcon } from 'lucide-react';
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
}

function formatValue(v: number, unit: KpiResult['unit']): string {
  if (!isFinite(v)) return '—';
  switch (unit) {
    case 'currency':
      return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    case 'rating':
      return v.toFixed(2);
    default:
      return Math.round(v).toLocaleString('en-US');
  }
}

export function KpiCard({
  title, icon: Icon, result, isLoading, error,
  primaryLabel, compareLabel, chartType = 'line', rightSlot,
}: Props) {
  const delta =
    result?.compareTotal !== undefined && result.compareTotal !== 0
      ? ((result.total - result.compareTotal) / result.compareTotal) * 100
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
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{primaryLabel}</p>
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
            <p className="text-3xl font-bold">{formatValue(result.total, result.unit)}</p>
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
          </div>
        ) : null}

        {result && result.series.length > 0 && (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'bar' ? (
                <BarChart data={result.series}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v, result.unit)} width={70} />
                  <Tooltip
                    formatter={(v: any) => formatValue(Number(v), result.unit)}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6 }}
                  />
                  {result.series.some((p) => p.compareValue !== undefined) && <Legend />}
                  <Bar dataKey="value" name={primaryLabel} fill="hsl(var(--primary))" />
                  {result.series.some((p) => p.compareValue !== undefined) && (
                    <Bar dataKey="compareValue" name={compareLabel || 'Compare'} fill="hsl(var(--muted-foreground))" />
                  )}
                </BarChart>
              ) : (
                <LineChart data={result.series}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatValue(v, result.unit)} width={70} />
                  <Tooltip
                    formatter={(v: any) => formatValue(Number(v), result.unit)}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6 }}
                  />
                  {result.series.some((p) => p.compareValue !== undefined) && <Legend />}
                  <Line type="monotone" dataKey="value" name={primaryLabel} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  {result.series.some((p) => p.compareValue !== undefined) && (
                    <Line type="monotone" dataKey="compareValue" name={compareLabel || 'Compare'}
                          stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={2} dot={false} />
                  )}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

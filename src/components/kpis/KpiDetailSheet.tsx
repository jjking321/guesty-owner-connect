import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Download, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  fetchListingDetail, fetchGbvDetail, fetchChurnDetail, fetchReviewDetail,
  type BucketWindow,
} from '@/lib/kpis/dataFetcher';
import type { KpiMetric, KpiDetailRow } from '@/lib/kpis/types';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric: KpiMetric | null;
  window: BucketWindow | null;
  title: string;
  bucketLabel?: string;
}

const titles: Record<KpiMetric, string> = {
  listings: 'Active & listed units',
  gbv: 'Reservations',
  churn: 'Churn events',
  reviews: 'Reviews',
};

function formatCurrency(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function KpiDetailSheet({ open, onOpenChange, metric, window: win, title, bucketLabel }: Props) {
  const [search, setSearch] = useState('');
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  useEffect(() => { if (!open) setSearch(''); }, [open]);

  const enabled = open && metric != null && win != null;
  const q = useQuery({
    queryKey: ['kpi-detail', metric, win?.start.toISOString(), win?.end.toISOString()],
    queryFn: async (): Promise<KpiDetailRow[]> => {
      if (!metric || !win) return [];
      switch (metric) {
        case 'listings': return fetchListingDetail(win);
        case 'gbv': return fetchGbvDetail(win);
        case 'churn': return fetchChurnDetail(win);
        case 'reviews': return fetchReviewDetail(win);
      }
    },
    enabled,
  });

  const rows = q.data ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((r) =>
      r.primary.toLowerCase().includes(s) ||
      (r.secondary || '').toLowerCase().includes(s)
    );
  }, [rows, search]);

  const totalValue = metric === 'gbv'
    ? rows.reduce((a, r) => a + (typeof r.value === 'number' ? r.value : 0), 0)
    : null;
  const fallbackCount = metric === 'gbv'
    ? rows.filter((r) => r.extra?.used_fallback).length
    : 0;

  const exportCsv = () => {
    const header = ['Primary', 'Secondary', 'Date', 'Value'];
    const lines = [header.join(',')].concat(
      filtered.map((r) => [
        JSON.stringify(r.primary ?? ''),
        JSON.stringify(r.secondary ?? ''),
        JSON.stringify(r.date ?? ''),
        JSON.stringify(r.value ?? ''),
      ].join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metric}-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {bucketLabel ? `${bucketLabel} · ` : ''}{rows.length.toLocaleString()} {metric === 'gbv' ? 'reservations' : metric === 'reviews' ? 'reviews' : metric === 'churn' ? 'events' : 'units'}
            {totalValue != null && <> · Total {formatCurrency(totalValue)}</>}
            {fallbackCount > 0 && <> · {fallbackCount} used fare fallback</>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 mt-4">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
          />
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
        </div>

        <div className="mt-4 space-y-1">
          {q.isLoading ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : q.error ? (
            <p className="text-sm text-destructive">Error: {(q.error as Error).message}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No items.</p>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 px-3 py-2 rounded border bg-card hover:bg-accent/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{r.primary}</p>
                  {r.secondary && (
                    <p className="text-xs text-muted-foreground truncate">{r.secondary}</p>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  {r.date && <div>{format(new Date(r.date), 'MMM d, yyyy')}</div>}
                  {typeof r.value === 'number' && (
                    <div className="font-medium text-foreground">
                      {metric === 'gbv' ? formatCurrency(r.value) :
                       metric === 'reviews' ? r.value.toFixed(1) :
                       r.value}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

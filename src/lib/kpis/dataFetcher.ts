import { supabase } from '@/integrations/supabase/client';
import { format, addYears, differenceInCalendarDays } from 'date-fns';
import type { Aggregation, KpiResult, ResolvedRange, SeriesPoint } from './types';
import { buildBuckets, findBucketIdx, type Bucket } from './bucket';
import { rangeISO } from './range';

const BATCH = 1000;

interface ListingRow {
  id: string;
  created_at_guesty: string | null;
  is_listed: boolean | null;
  active: boolean | null;
  archived: boolean;
  guesty_account_id: string;
}

async function fetchAllListings(): Promise<ListingRow[]> {
  const out: ListingRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('listings')
      .select('id, created_at_guesty, is_listed, active, archived, guesty_account_id')
      .range(from, from + BATCH - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as any));
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return out;
}

// ---------- Listing growth ----------
export async function fetchListingGrowth(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const listings = await fetchAllListings();
  // Currently active = is_listed AND active AND NOT archived
  const currentlyActive = listings.filter((l) => l.is_listed && l.active && !l.archived);

  // Pull snapshots in range (may not exist for all dates yet)
  const buckets = buildBuckets(range.start, range.end, agg);
  const series = await computeListingSeries(currentlyActive, buckets);

  let compareSeries: SeriesPoint[] | null = null;
  if (compare) {
    const compareBuckets = buildBuckets(compare.start, compare.end, agg);
    compareSeries = await computeListingSeries(currentlyActive, compareBuckets);
  }
  // Align compare to primary by index
  if (compareSeries) {
    for (let i = 0; i < series.length; i++) {
      if (compareSeries[i]) series[i].compareValue = compareSeries[i].value;
    }
  }

  // Total = value at the last bucket (point-in-time count)
  const total = series.length ? series[series.length - 1].value : 0;
  const compareTotal = compareSeries?.length ? compareSeries[compareSeries.length - 1].value : undefined;

  return { total, compareTotal, series, unit: 'number' };
}

async function computeListingSeries(currentlyActive: ListingRow[], buckets: Bucket[]): Promise<SeriesPoint[]> {
  // Try snapshots first
  const startStr = format(buckets[0].start, 'yyyy-MM-dd');
  const endStr = format(buckets[buckets.length - 1].end, 'yyyy-MM-dd');
  const { data: snaps } = await supabase
    .from('listing_status_snapshots')
    .select('snapshot_date, total_listed, total_active')
    .gte('snapshot_date', startStr)
    .lte('snapshot_date', endStr)
    .order('snapshot_date', { ascending: true });

  // Build per-bucket value: prefer last snapshot in bucket; fall back to backfill
  const snapByDate = new Map<string, number>();
  for (const s of (snaps ?? []) as any[]) {
    // count "active & listed" = min(listed, active) ≈ active
    snapByDate.set(s.snapshot_date, Math.min(s.total_listed ?? 0, s.total_active ?? 0));
  }

  return buckets.map((b) => {
    // Find latest snapshot date <= bucket end within bucket
    let snapValue: number | undefined;
    for (const [d, v] of snapByDate) {
      const dt = new Date(d + 'T00:00:00');
      if (dt >= b.start && dt <= b.end) {
        snapValue = v; // last one wins (sorted asc)
      }
    }
    if (snapValue !== undefined) {
      return { bucket: b.label, bucketStart: b.start, value: snapValue };
    }
    // Backfill: cumulative count of currently-active listings created on or before bucket end
    const value = currentlyActive.filter((l) => {
      if (!l.created_at_guesty) return false;
      return new Date(l.created_at_guesty) <= b.end;
    }).length;
    return { bucket: b.label, bucketStart: b.start, value };
  });
}

// ---------- Gross Booking Value ----------
export async function fetchGbv(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const { points: series, meta } = await computeGbvSeries(range, buckets);

  let compareSeries: SeriesPoint[] | null = null;
  if (compare) {
    const compareBuckets = buildBuckets(compare.start, compare.end, agg);
    const cmp = await computeGbvSeries(compare, compareBuckets);
    compareSeries = cmp.points;
    for (let i = 0; i < series.length; i++) {
      if (compareSeries[i]) series[i].compareValue = compareSeries[i].value;
    }
  }

  const total = series.reduce((a, p) => a + p.value, 0);
  const compareTotal = compareSeries?.reduce((a, p) => a + p.value, 0);

  return { total, compareTotal, series, unit: 'currency', meta };
}

async function computeGbvSeries(
  range: ResolvedRange,
  buckets: Bucket[],
): Promise<{ points: SeriesPoint[]; meta: { totalReservations: number; withSubTotal: number; usedFallback: number } }> {
  const { start, end } = rangeISO(range);
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('reservations')
      .select('check_in, sub_total, fare_accommodation_adjusted, source, status')
      .gte('check_in', start)
      .lte('check_in', end)
      .range(from, from + BATCH - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  const points = buckets.map((b) => ({ bucket: b.label, bucketStart: b.start, value: 0 }));
  let totalReservations = 0, withSubTotal = 0, usedFallback = 0;
  for (const r of all) {
    if (r.source === 'owner') continue;
    if (r.status && !['confirmed', 'checked_in', 'checked_out'].includes(r.status)) continue;
    if (!r.check_in) continue;
    const sub = r.sub_total != null ? Number(r.sub_total) : null;
    const fare = r.fare_accommodation_adjusted != null ? Number(r.fare_accommodation_adjusted) : null;
    const value = sub ?? fare ?? 0;
    if (!value) continue;
    totalReservations++;
    if (sub != null) withSubTotal++;
    else if (fare != null) usedFallback++;
    const d = new Date(r.check_in + 'T00:00:00');
    const idx = findBucketIdx(buckets, d);
    if (idx >= 0) points[idx].value += value;
  }
  return { points, meta: { totalReservations, withSubTotal, usedFallback } };
}

// ---------- Churn ----------
export async function fetchChurn(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const series = await computeChurnSeries(range, buckets);

  let compareSeries: SeriesPoint[] | null = null;
  if (compare) {
    const compareBuckets = buildBuckets(compare.start, compare.end, agg);
    compareSeries = await computeChurnSeries(compare, compareBuckets);
    for (let i = 0; i < series.length; i++) {
      if (compareSeries[i]) series[i].compareValue = compareSeries[i].value;
    }
  }

  const total = series.reduce((a, p) => a + p.value, 0);
  const compareTotal = compareSeries?.reduce((a, p) => a + p.value, 0);
  return { total, compareTotal, series, unit: 'number' };
}

async function computeChurnSeries(range: ResolvedRange, buckets: Bucket[]): Promise<SeriesPoint[]> {
  const { start, end } = rangeISO(range);
  const { data, error } = await supabase
    .from('listing_churn_events')
    .select('churned_at')
    .gte('churned_at', start)
    .lte('churned_at', end + 'T23:59:59');
  if (error) throw error;
  const points = buckets.map((b) => ({ bucket: b.label, bucketStart: b.start, value: 0 }));
  for (const r of (data ?? []) as any[]) {
    const d = new Date(r.churned_at);
    const idx = findBucketIdx(buckets, d);
    if (idx >= 0) points[idx].value += 1;
  }
  return points;
}

// ---------- Review Score ----------
export type ReviewScoreMode = 'period' | 'lifetime';

export async function fetchReviewScore(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
  mode: ReviewScoreMode,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const series = await computeReviewSeries(range, buckets, mode);

  let compareSeries: SeriesPoint[] | null = null;
  if (compare) {
    const compareBuckets = buildBuckets(compare.start, compare.end, agg);
    compareSeries = await computeReviewSeries(compare, compareBuckets, mode);
    for (let i = 0; i < series.length; i++) {
      if (compareSeries[i]) series[i].compareValue = compareSeries[i].value;
    }
  }

  // Overall total = average across all reviews in range (period mode) or lifetime as of range.end
  const total = await computeReviewTotal(range, mode);
  const compareTotal = compare ? await computeReviewTotal(compare, mode) : undefined;
  return { total, compareTotal, series, unit: 'rating' };
}

async function computeReviewTotal(range: ResolvedRange, mode: ReviewScoreMode): Promise<number> {
  const endStr = format(range.end, 'yyyy-MM-dd');
  let q = supabase
    .from('reviews')
    .select('rating, review_date')
    .eq('is_removed', false)
    .not('rating', 'is', null);
  if (mode === 'period') {
    q = q.gte('review_date', format(range.start, 'yyyy-MM-dd')).lte('review_date', endStr);
  } else {
    q = q.lte('review_date', endStr);
  }
  const all = await paginate(q);
  if (all.length === 0) return 0;
  const sum = all.reduce((a: number, r: any) => a + Number(r.rating || 0), 0);
  return sum / all.length;
}

async function computeReviewSeries(range: ResolvedRange, buckets: Bucket[], mode: ReviewScoreMode): Promise<SeriesPoint[]> {
  const startStr = format(range.start, 'yyyy-MM-dd');
  const endStr = format(range.end, 'yyyy-MM-dd');

  if (mode === 'period') {
    const all = await paginate(
      supabase.from('reviews')
        .select('rating, review_date')
        .eq('is_removed', false)
        .not('rating', 'is', null)
        .gte('review_date', startStr)
        .lte('review_date', endStr)
    );
    const sums = buckets.map(() => ({ s: 0, n: 0 }));
    for (const r of all) {
      if (!r.review_date) continue;
      const d = new Date(r.review_date);
      const idx = findBucketIdx(buckets, d);
      if (idx >= 0) {
        sums[idx].s += Number(r.rating || 0);
        sums[idx].n += 1;
      }
    }
    return buckets.map((b, i) => ({
      bucket: b.label,
      bucketStart: b.start,
      value: sums[i].n > 0 ? sums[i].s / sums[i].n : 0,
    }));
  }

  // lifetime mode: cumulative average up to each bucket end
  const all = await paginate(
    supabase.from('reviews')
      .select('rating, review_date')
      .eq('is_removed', false)
      .not('rating', 'is', null)
      .lte('review_date', endStr)
  );
  // sort by date asc
  all.sort((a: any, b: any) => new Date(a.review_date).getTime() - new Date(b.review_date).getTime());
  return buckets.map((b) => {
    const cutoff = b.end.getTime();
    let s = 0, n = 0;
    for (const r of all) {
      const t = new Date(r.review_date).getTime();
      if (t <= cutoff) { s += Number(r.rating || 0); n++; } else break;
    }
    return { bucket: b.label, bucketStart: b.start, value: n > 0 ? s / n : 0 };
  });
}

async function paginate(query: any): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + BATCH - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return all;
}

// ============= Drill-down detail fetchers =============
import type { KpiDetailRow } from './types';

export interface BucketWindow {
  start: Date;
  end: Date;
}

// Active & Listed: list of currently-active listings as of windowEnd (point in time)
export async function fetchListingDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const listings = await fetchAllListings();
  const cutoff = window.end.getTime();
  const rows = listings
    .filter((l) => l.is_listed && l.active && !l.archived)
    .filter((l) => !l.created_at_guesty || new Date(l.created_at_guesty).getTime() <= cutoff);
  // Fetch nicknames in batch
  const ids = rows.map((r) => r.id);
  const nameMap = new Map<string, { nickname: string | null; bedrooms: number | null; property_type: string | null; last_active_at: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data } = await supabase
      .from('listings')
      .select('id, nickname, bedrooms, property_type, last_active_at')
      .in('id', slice);
    for (const r of (data ?? []) as any[]) nameMap.set(r.id, r);
  }
  return rows.map((r) => {
    const m = nameMap.get(r.id);
    return {
      id: r.id,
      primary: m?.nickname || r.id,
      secondary: [m?.property_type, m?.bedrooms ? `${m.bedrooms} BR` : null].filter(Boolean).join(' · '),
      date: m?.last_active_at ?? undefined,
      extra: { is_listed: r.is_listed, active: r.active },
    };
  }).sort((a, b) => a.primary.localeCompare(b.primary));
}

// GBV: reservations checking in within window
export async function fetchGbvDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const start = format(window.start, 'yyyy-MM-dd');
  const end = format(window.end, 'yyyy-MM-dd');
  const all = await paginate(
    supabase.from('reservations')
      .select('id, listing_id, check_in, nights_count, sub_total, fare_accommodation_adjusted, source, status, confirmation_code, guest_name')
      .gte('check_in', start)
      .lte('check_in', end)
  );
  const valid = all.filter((r: any) =>
    r.source !== 'owner' &&
    (!r.status || ['confirmed', 'checked_in', 'checked_out'].includes(r.status))
  );
  const ids = Array.from(new Set(valid.map((r: any) => r.listing_id).filter(Boolean)));
  const nameMap = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('listings').select('id, nickname').in('id', ids.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) nameMap.set(r.id, r.nickname || r.id);
  }
  return valid.map((r: any) => {
    const sub = r.sub_total != null ? Number(r.sub_total) : null;
    const fare = r.fare_accommodation_adjusted != null ? Number(r.fare_accommodation_adjusted) : null;
    const value = sub ?? fare ?? 0;
    return {
      id: r.id,
      primary: nameMap.get(r.listing_id) || r.listing_id || '—',
      secondary: `${r.guest_name || 'Guest'} · ${r.confirmation_code || ''} · ${r.nights_count || 0}n${sub == null && fare != null ? ' · fare fallback' : ''}`,
      date: r.check_in,
      value,
      extra: { source: r.source, used_fallback: sub == null && fare != null },
    };
  }).sort((a, b) => (b.value as number) - (a.value as number));
}

// Churn: events in window
export async function fetchChurnDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const start = format(window.start, 'yyyy-MM-dd');
  const end = format(window.end, 'yyyy-MM-dd');
  const { data, error } = await supabase
    .from('listing_churn_events')
    .select('id, listing_id, churned_at, restored_at, reason, category, notes')
    .gte('churned_at', start)
    .lte('churned_at', end + 'T23:59:59')
    .order('churned_at', { ascending: false });
  if (error) throw error;
  const ids = Array.from(new Set((data ?? []).map((r: any) => r.listing_id)));
  const nameMap = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ls } = await supabase.from('listings').select('id, nickname').in('id', ids.slice(i, i + 200));
    for (const r of (ls ?? []) as any[]) nameMap.set(r.id, r.nickname || r.id);
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    primary: nameMap.get(r.listing_id) || r.listing_id,
    secondary: [r.category, r.reason].filter(Boolean).join(' — ') || 'No reason set',
    date: r.churned_at,
    extra: { listing_id: r.listing_id, restored_at: r.restored_at, notes: r.notes, reason: r.reason, category: r.category },
  }));
}

// Reviews: reviews in window
export async function fetchReviewDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const start = format(window.start, 'yyyy-MM-dd');
  const end = format(window.end, 'yyyy-MM-dd');
  const data = await paginate(
    supabase.from('reviews')
      .select('id, listing_id, rating, review_date, source, public_review')
      .eq('is_removed', false)
      .not('rating', 'is', null)
      .gte('review_date', start)
      .lte('review_date', end)
  );
  const ids = Array.from(new Set(data.map((r: any) => r.listing_id).filter(Boolean)));
  const nameMap = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ls } = await supabase.from('listings').select('id, nickname').in('id', ids.slice(i, i + 200));
    for (const r of (ls ?? []) as any[]) nameMap.set(r.id, r.nickname || r.id);
  }
  return data.map((r: any) => ({
    id: r.id,
    primary: nameMap.get(r.listing_id) || r.listing_id || '—',
    secondary: `${r.source || ''} · ${typeof r.public_review === 'string' ? r.public_review.slice(0, 100) : ''}`,
    value: Number(r.rating),
    date: r.review_date,
  })).sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());
}

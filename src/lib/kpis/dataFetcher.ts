import { supabase } from '@/integrations/supabase/client';
import { format, addYears, differenceInCalendarDays } from 'date-fns';
import type { Aggregation, KpiResult, ResolvedRange, SeriesPoint, KpiDetailRow } from './types';
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
      if (compareSeries[i]) { series[i].compareValue = compareSeries[i].value; series[i].compareBucket = compareSeries[i].bucket; series[i].compareBucketStart = compareSeries[i].bucketStart; series[i].compareBucketEnd = compareSeries[i].bucketEnd; }
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
      return { bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value: snapValue };
    }
    // Backfill: cumulative count of currently-active listings created on or before bucket end
    const value = currentlyActive.filter((l) => {
      if (!l.created_at_guesty) return false;
      return new Date(l.created_at_guesty) <= b.end;
    }).length;
    return { bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value };
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
      if (compareSeries[i]) { series[i].compareValue = compareSeries[i].value; series[i].compareBucket = compareSeries[i].bucket; series[i].compareBucketStart = compareSeries[i].bucketStart; series[i].compareBucketEnd = compareSeries[i].bucketEnd; }
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
  const points = buckets.map((b) => ({ bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value: 0 }));
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
      if (compareSeries[i]) { series[i].compareValue = compareSeries[i].value; series[i].compareBucket = compareSeries[i].bucket; series[i].compareBucketStart = compareSeries[i].bucketStart; series[i].compareBucketEnd = compareSeries[i].bucketEnd; }
    }
  }

  const total = series.reduce((a, p) => a + p.value, 0);
  const compareTotal = compareSeries?.reduce((a, p) => a + p.value, 0);
  return { total, compareTotal, series, unit: 'number' };
}

function getChurnSignalDate(row: { churned_at?: string | null; last_active_at?: string | null; created_at_guesty?: string | null }) {
  const created = row.created_at_guesty ? new Date(row.created_at_guesty).getTime() : null;

  // Prefer an explicit churn event, but only if it is plausible (>= listing creation).
  // Older event dates were written by an earlier snapshot bug using stale lastActivityAt.
  if (row.churned_at) {
    const churned = new Date(row.churned_at).getTime();
    if (created == null || churned >= created) return row.churned_at;
    return row.created_at_guesty;
  }

  if (created == null) return row.last_active_at ?? null;
  if (!row.last_active_at) return row.created_at_guesty;

  const lastActive = new Date(row.last_active_at).getTime();
  return lastActive >= created ? row.last_active_at : row.created_at_guesty;
}

async function computeChurnSeries(range: ResolvedRange, buckets: Bucket[]): Promise<SeriesPoint[]> {
  const { start, end } = rangeISO(range);
  const openEvents = await paginate(
    supabase
      .from('listing_churn_events')
      .select('listing_id, churned_at, ignored')
      .is('restored_at', null)
      .eq('ignored', false)
  );
  const ignoredEvents = await paginate(
    supabase
      .from('listing_churn_events')
      .select('listing_id')
      .is('restored_at', null)
      .eq('ignored', true)
  );
  const ignoredSet = new Set(ignoredEvents.map((e: any) => e.listing_id));
  const eventByListing = new Map(openEvents.map((e: any) => [e.listing_id, e.churned_at]));


  // Derive churn from the current Guesty state, using explicit churn events when present.
  // If Guesty's lastActivityAt is blank/stale, fall back to created_at_guesty so newly-added 2026 units
  // that are now unlisted+inactive are not incorrectly pushed into an old year or dropped entirely.
  const all = await paginate(
    supabase
      .from('listings')
      .select('id, last_active_at, created_at_guesty')
      .eq('is_listed', false)
      .eq('active', false)
      .eq('archived', false)
  );
  const points = buckets.map((b) => ({ bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value: 0 }));
  for (const r of all) {
    if (ignoredSet.has(r.id)) continue;
    const signalDate = getChurnSignalDate({ ...r, churned_at: eventByListing.get(r.id) as string | undefined });
    if (!signalDate) continue;
    const d = new Date(signalDate);
    if (d < range.start || d > range.end) continue;
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
      if (compareSeries[i]) { series[i].compareValue = compareSeries[i].value; series[i].compareBucket = compareSeries[i].bucket; series[i].compareBucketStart = compareSeries[i].bucketStart; series[i].compareBucketEnd = compareSeries[i].bucketEnd; }
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
      bucketEnd: b.end,
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
    return { bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value: n > 0 ? s / n : 0 };
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

// Churn: currently-churned listings whose churn signal falls in the window
export async function fetchChurnDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const listings = await paginate(
    supabase
      .from('listings')
      .select('id, nickname, last_active_at, created_at_guesty')
      .eq('is_listed', false)
      .eq('active', false)
      .eq('archived', false)
  );
  const ids = listings.map((l: any) => l.id);
  // Enrich with most recent churn event metadata (category/reason/notes) if user has entered any.
  const eventByListing = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data: evs } = await supabase
      .from('listing_churn_events')
      .select('id, listing_id, churned_at, restored_at, reason, category, notes, ignored')
      .in('listing_id', slice)
      .order('churned_at', { ascending: false });
    for (const e of (evs ?? []) as any[]) {
      if (!eventByListing.has(e.listing_id)) eventByListing.set(e.listing_id, e);
    }
  }
  return listings.map((l: any) => {
    const e = eventByListing.get(l.id);
    if (e?.ignored) return null;
    const signalDate = getChurnSignalDate({ ...l, churned_at: e?.churned_at });
    if (!signalDate) return null;
    const d = new Date(signalDate);
    if (d < window.start || d > window.end) return null;

    return {
      id: e?.id ?? l.id,
      primary: l.nickname || l.id,
      secondary: [e?.category, e?.reason].filter(Boolean).join(' — ') || 'No reason set',
      date: signalDate,
      extra: {
        listing_id: l.id,
        event_id: e?.id ?? null,
        restored_at: e?.restored_at,
        notes: e?.notes,
        reason: e?.reason,
        category: e?.category,
      },
    };
  }).filter(Boolean).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()) as KpiDetailRow[];
}

// Reviews: reviews in window
export async function fetchReviewDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const start = format(window.start, 'yyyy-MM-dd');
  const end = format(window.end, 'yyyy-MM-dd');
  const data = await paginate(
    supabase.from('reviews')
      .select('id, listing_id, rating, review_date, source, review_text')
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
    secondary: `${r.source || ''} · ${typeof r.review_text === 'string' ? r.review_text.slice(0, 100) : ''}`,
    value: Number(r.rating),
    date: r.review_date,
  })).sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());
}

// ============= New KPI fetchers =============

const CHANNEL_RULES: Array<{ name: string; test: (s: string) => boolean }> = [
  { name: 'Airbnb', test: (s) => /airbnb/i.test(s) },
  { name: 'Vrbo / HomeAway', test: (s) => /vrbo|homeaway/i.test(s) },
  { name: 'Booking.com', test: (s) => /booking/i.test(s) && !/booking engine/i.test(s) },
  { name: 'Direct', test: (s) => /direct|website|booking engine|manual/i.test(s) },
];
function channelOf(source: string | null | undefined): string {
  if (!source) return 'Other';
  for (const r of CHANNEL_RULES) if (r.test(source)) return r.name;
  return 'Other';
}

// ---------- Net unit growth ----------
export async function fetchNetGrowth(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const series = await computeNetGrowthSeries(range, buckets);
  let compareSeries: SeriesPoint[] | null = null;
  if (compare) {
    const compareBuckets = buildBuckets(compare.start, compare.end, agg);
    compareSeries = await computeNetGrowthSeries(compare, compareBuckets);
    for (let i = 0; i < series.length; i++) {
      if (compareSeries[i]) {
        series[i].compareValue = compareSeries[i].value;
        series[i].compareBucket = compareSeries[i].bucket;
        series[i].compareBucketStart = compareSeries[i].bucketStart;
        series[i].compareBucketEnd = compareSeries[i].bucketEnd;
      }
    }
  }
  const total = series.reduce((a, p) => a + p.value, 0);
  const compareTotal = compareSeries?.reduce((a, p) => a + p.value, 0);
  return { total, compareTotal, series, unit: 'number' };
}

async function computeNetGrowthSeries(range: ResolvedRange, buckets: Bucket[]): Promise<SeriesPoint[]> {
  // Additions: any listing whose created_at_guesty falls in bucket
  const allListings = await paginate(
    supabase.from('listings').select('id, created_at_guesty, is_listed, active, archived, last_active_at')
  );
  // Churn signals
  const openEvents = await paginate(
    supabase.from('listing_churn_events').select('listing_id, churned_at, ignored').is('restored_at', null).eq('ignored', false)
  );
  const ignoredEvents = await paginate(
    supabase.from('listing_churn_events').select('listing_id').is('restored_at', null).eq('ignored', true)
  );
  const ignoredSet = new Set(ignoredEvents.map((e: any) => e.listing_id));
  const eventByListing = new Map(openEvents.map((e: any) => [e.listing_id, e.churned_at]));

  const points = buckets.map((b) => ({ bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value: 0 }));
  for (const l of allListings) {
    if (l.archived) continue;
    if (l.created_at_guesty) {
      const d = new Date(l.created_at_guesty);
      if (d >= range.start && d <= range.end) {
        const idx = findBucketIdx(buckets, d);
        if (idx >= 0) points[idx].value += 1;
      }
    }
    // Subtract churn for this listing
    if (!l.is_listed && !l.active && !ignoredSet.has(l.id)) {
      const signal = getChurnSignalDate({ ...l, churned_at: eventByListing.get(l.id) as string | undefined });
      if (signal) {
        const d = new Date(signal);
        if (d >= range.start && d <= range.end) {
          const idx = findBucketIdx(buckets, d);
          if (idx >= 0) points[idx].value -= 1;
        }
      }
    }
  }
  return points;
}

export async function fetchNetGrowthDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const listings = await paginate(
    supabase.from('listings').select('id, nickname, created_at_guesty, is_listed, active, archived, last_active_at')
  );
  const openEvents = await paginate(
    supabase.from('listing_churn_events').select('listing_id, churned_at, ignored, restored_at').eq('ignored', false).is('restored_at', null)
  );
  const eventByListing = new Map(openEvents.map((e: any) => [e.listing_id, e.churned_at]));
  const rows: KpiDetailRow[] = [];
  for (const l of listings) {
    if (l.archived) continue;
    if (l.created_at_guesty) {
      const d = new Date(l.created_at_guesty);
      if (d >= window.start && d <= window.end) {
        rows.push({
          id: `add-${l.id}`,
          primary: l.nickname || l.id,
          secondary: 'Added',
          date: l.created_at_guesty,
          value: 1,
        });
      }
    }
    if (!l.is_listed && !l.active) {
      const signal = getChurnSignalDate({ ...l, churned_at: eventByListing.get(l.id) as string | undefined });
      if (signal) {
        const d = new Date(signal);
        if (d >= window.start && d <= window.end) {
          rows.push({
            id: `churn-${l.id}`,
            primary: l.nickname || l.id,
            secondary: 'Churned',
            date: signal,
            value: -1,
          });
        }
      }
    }
  }
  return rows.sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());
}

// ---------- Owner concentration ----------
export async function fetchOwnerConcentration(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const { series, breakdown } = await computeOwnerConcentrationSeries(buckets);
  let compareTotal: number | undefined;
  let compareSeries: SeriesPoint[] | null = null;
  if (compare) {
    const cBuckets = buildBuckets(compare.start, compare.end, agg);
    const cmp = await computeOwnerConcentrationSeries(cBuckets);
    compareSeries = cmp.series;
    compareTotal = cmp.series.length ? cmp.series[cmp.series.length - 1].value : undefined;
    for (let i = 0; i < series.length; i++) {
      if (compareSeries[i]) {
        series[i].compareValue = compareSeries[i].value;
        series[i].compareBucket = compareSeries[i].bucket;
        series[i].compareBucketStart = compareSeries[i].bucketStart;
        series[i].compareBucketEnd = compareSeries[i].bucketEnd;
      }
    }
  }
  const total = series.length ? series[series.length - 1].value : 0;
  return { total, compareTotal, series, unit: 'percent', meta: { breakdown } };
}

async function computeOwnerConcentrationSeries(buckets: Bucket[]): Promise<{ series: SeriesPoint[]; breakdown: Array<[string, number]> }> {
  const listings = await paginate(
    supabase.from('listings').select('id, owner_id, created_at_guesty, is_listed, active, archived')
  );
  const series = buckets.map((b) => {
    const activeAsOf = listings.filter((l: any) => {
      if (l.archived) return false;
      if (!l.is_listed || !l.active) return false;
      if (!l.created_at_guesty) return true;
      return new Date(l.created_at_guesty) <= b.end;
    });
    const counts = new Map<string, number>();
    for (const l of activeAsOf) {
      if (!l.owner_id) continue;
      counts.set(l.owner_id, (counts.get(l.owner_id) ?? 0) + 1);
    }
    const total = activeAsOf.length;
    const top = Math.max(0, ...Array.from(counts.values()));
    return { bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value: total > 0 ? top / total : 0 };
  });

  const last = listings.filter((l: any) => l.is_listed && l.active && !l.archived);
  const counts = new Map<string, number>();
  for (const l of last) {
    if (!l.owner_id) continue;
    counts.set(l.owner_id, (counts.get(l.owner_id) ?? 0) + 1);
  }
  const ownerIds = Array.from(counts.keys());
  const nameMap = new Map<string, string>();
  for (let i = 0; i < ownerIds.length; i += 200) {
    const { data } = await supabase.from('owners').select('id, full_name, first_name, last_name, email').in('id', ownerIds.slice(i, i + 200));
    for (const o of (data ?? []) as any[]) {
      nameMap.set(o.id, o.full_name || [o.first_name, o.last_name].filter(Boolean).join(' ') || o.email || o.id);
    }
  }
  const breakdown: Array<[string, number]> = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => [nameMap.get(id) || id, n]);
  return { series, breakdown };
}

export async function fetchOwnerConcentrationDetail(_window: BucketWindow): Promise<KpiDetailRow[]> {
  const listings = await paginate(
    supabase.from('listings').select('id, owner_id, is_listed, active, archived')
  );
  const active = listings.filter((l: any) => l.is_listed && l.active && !l.archived);
  const total = active.length;
  const counts = new Map<string, number>();
  for (const l of active) {
    if (!l.owner_id) continue;
    counts.set(l.owner_id, (counts.get(l.owner_id) ?? 0) + 1);
  }
  const ownerIds = Array.from(counts.keys());
  const nameMap = new Map<string, string>();
  for (let i = 0; i < ownerIds.length; i += 200) {
    const { data } = await supabase.from('owners').select('id, full_name, first_name, last_name, email').in('id', ownerIds.slice(i, i + 200));
    for (const o of (data ?? []) as any[]) {
      nameMap.set(o.id, o.full_name || [o.first_name, o.last_name].filter(Boolean).join(' ') || o.email || o.id);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([ownerId, cnt]) => ({
    id: ownerId,
    primary: nameMap.get(ownerId) || ownerId,
    secondary: `${cnt} unit${cnt === 1 ? '' : 's'} · ${total > 0 ? ((cnt / total) * 100).toFixed(1) : '0'}% of portfolio`,
    value: cnt,
  }));
}

// ---------- Channel mix ----------
export async function fetchChannelMix(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const { series, breakdown, topShare } = await computeChannelMixSeries(range, buckets);
  let compareSeries: SeriesPoint[] | null = null;
  let compareTotal: number | undefined;
  if (compare) {
    const cBuckets = buildBuckets(compare.start, compare.end, agg);
    const cmp = await computeChannelMixSeries(compare, cBuckets);
    compareSeries = cmp.series;
    compareTotal = cmp.topShare;
    for (let i = 0; i < series.length; i++) {
      if (compareSeries[i]) {
        series[i].compareValue = compareSeries[i].value;
        series[i].compareBucket = compareSeries[i].bucket;
        series[i].compareBucketStart = compareSeries[i].bucketStart;
        series[i].compareBucketEnd = compareSeries[i].bucketEnd;
      }
    }
  }
  return { total: topShare, compareTotal, series, unit: 'percent', meta: { breakdown } };
}

async function computeChannelMixSeries(range: ResolvedRange, buckets: Bucket[]) {
  const { start, end } = rangeISO(range);
  const all = await paginate(
    supabase.from('reservations')
      .select('check_in, sub_total, fare_accommodation_adjusted, source, status')
      .gte('check_in', start).lte('check_in', end)
  );
  const channelTotals = new Map<string, number>();
  // series = top-channel GBV share per bucket
  const perBucket = buckets.map(() => new Map<string, number>());
  let grand = 0;
  for (const r of all) {
    if (r.source === 'owner') continue;
    if (r.status && !['confirmed', 'checked_in', 'checked_out'].includes(r.status)) continue;
    const value = r.sub_total != null ? Number(r.sub_total) : (r.fare_accommodation_adjusted != null ? Number(r.fare_accommodation_adjusted) : 0);
    if (!value || !r.check_in) continue;
    const channel = channelOf(r.source);
    channelTotals.set(channel, (channelTotals.get(channel) ?? 0) + value);
    grand += value;
    const idx = findBucketIdx(buckets, new Date(r.check_in + 'T00:00:00'));
    if (idx >= 0) {
      const m = perBucket[idx];
      m.set(channel, (m.get(channel) ?? 0) + value);
    }
  }
  const series: SeriesPoint[] = buckets.map((b, i) => {
    const m = perBucket[i];
    const total = Array.from(m.values()).reduce((a, v) => a + v, 0);
    const top = Math.max(0, ...Array.from(m.values()));
    return { bucket: b.label, bucketStart: b.start, bucketEnd: b.end, value: total > 0 ? top / total : 0 };
  });
  const breakdown = Array.from(channelTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, gbv]) => ({ name, gbv, share: grand > 0 ? gbv / grand : 0 }));
  const topShare = breakdown[0]?.share ?? 0;
  return { series, breakdown, topShare };
}

export async function fetchChannelMixDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const start = format(window.start, 'yyyy-MM-dd');
  const end = format(window.end, 'yyyy-MM-dd');
  const all = await paginate(
    supabase.from('reservations')
      .select('id, sub_total, fare_accommodation_adjusted, source, status, check_in')
      .gte('check_in', start).lte('check_in', end)
  );
  const byChannel = new Map<string, { gbv: number; count: number }>();
  let grand = 0;
  for (const r of all) {
    if (r.source === 'owner') continue;
    if (r.status && !['confirmed', 'checked_in', 'checked_out'].includes(r.status)) continue;
    const value = r.sub_total != null ? Number(r.sub_total) : (r.fare_accommodation_adjusted != null ? Number(r.fare_accommodation_adjusted) : 0);
    if (!value) continue;
    const ch = channelOf(r.source);
    const prev = byChannel.get(ch) ?? { gbv: 0, count: 0 };
    prev.gbv += value; prev.count += 1;
    byChannel.set(ch, prev);
    grand += value;
  }
  return Array.from(byChannel.entries()).sort((a, b) => b[1].gbv - a[1].gbv).map(([name, v]) => ({
    id: name,
    primary: name,
    secondary: `${v.count} reservation${v.count === 1 ? '' : 's'} · ${grand > 0 ? ((v.gbv / grand) * 100).toFixed(1) : '0'}% of GBV`,
    value: Math.round(v.gbv),
  }));
}

// ---------- ADR ----------
export async function fetchAdr(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const primary = await computeAdrSeries(range, buckets);
  let compareSeries: SeriesPoint[] | null = null;
  let compareTotal: number | undefined;
  if (compare) {
    const cBuckets = buildBuckets(compare.start, compare.end, agg);
    const cmp = await computeAdrSeries(compare, cBuckets);
    compareSeries = cmp.series;
    compareTotal = cmp.total;
    for (let i = 0; i < primary.series.length; i++) {
      if (compareSeries[i]) {
        primary.series[i].compareValue = compareSeries[i].value;
        primary.series[i].compareBucket = compareSeries[i].bucket;
        primary.series[i].compareBucketStart = compareSeries[i].bucketStart;
        primary.series[i].compareBucketEnd = compareSeries[i].bucketEnd;
      }
    }
  }
  return { total: primary.total, compareTotal, series: primary.series, unit: 'currency' };
}

async function computeAdrSeries(range: ResolvedRange, buckets: Bucket[]) {
  const { start, end } = rangeISO(range);
  const all = await paginate(
    supabase.from('reservations')
      .select('check_in, nights_count, sub_total, fare_accommodation_adjusted, source, status')
      .gte('check_in', start).lte('check_in', end)
  );
  const sums = buckets.map(() => ({ rev: 0, nights: 0 }));
  let totalRev = 0, totalNights = 0;
  for (const r of all) {
    if (r.source === 'owner') continue;
    if (r.status && !['confirmed', 'checked_in', 'checked_out'].includes(r.status)) continue;
    const value = r.sub_total != null ? Number(r.sub_total) : (r.fare_accommodation_adjusted != null ? Number(r.fare_accommodation_adjusted) : 0);
    const n = Number(r.nights_count || 0);
    if (!value || n <= 0 || !r.check_in) continue;
    totalRev += value; totalNights += n;
    const idx = findBucketIdx(buckets, new Date(r.check_in + 'T00:00:00'));
    if (idx >= 0) { sums[idx].rev += value; sums[idx].nights += n; }
  }
  const series: SeriesPoint[] = buckets.map((b, i) => ({
    bucket: b.label, bucketStart: b.start, bucketEnd: b.end,
    value: sums[i].nights > 0 ? sums[i].rev / sums[i].nights : 0,
  }));
  return { series, total: totalNights > 0 ? totalRev / totalNights : 0 };
}

export async function fetchAdrDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const start = format(window.start, 'yyyy-MM-dd');
  const end = format(window.end, 'yyyy-MM-dd');
  const all = await paginate(
    supabase.from('reservations')
      .select('id, listing_id, check_in, nights_count, sub_total, fare_accommodation_adjusted, source, status, confirmation_code, guest_name')
      .gte('check_in', start).lte('check_in', end)
  );
  const valid = all.filter((r: any) =>
    r.source !== 'owner' &&
    Number(r.nights_count) > 0 &&
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
    const adr = value / Number(r.nights_count);
    return {
      id: r.id,
      primary: nameMap.get(r.listing_id) || r.listing_id || '—',
      secondary: `${r.guest_name || 'Guest'} · ${r.confirmation_code || ''} · ${r.nights_count}n`,
      date: r.check_in,
      value: Math.round(adr),
    };
  }).sort((a, b) => (b.value as number) - (a.value as number));
}

// ---------- Cancellation rate ----------
export async function fetchCancellationRate(
  range: ResolvedRange,
  agg: Aggregation,
  compare: ResolvedRange | null,
): Promise<KpiResult> {
  const buckets = buildBuckets(range.start, range.end, agg);
  const primary = await computeCancellationSeries(range, buckets);
  let compareSeries: SeriesPoint[] | null = null;
  let compareTotal: number | undefined;
  if (compare) {
    const cBuckets = buildBuckets(compare.start, compare.end, agg);
    const cmp = await computeCancellationSeries(compare, cBuckets);
    compareSeries = cmp.series;
    compareTotal = cmp.total;
    for (let i = 0; i < primary.series.length; i++) {
      if (compareSeries[i]) {
        primary.series[i].compareValue = compareSeries[i].value;
        primary.series[i].compareBucket = compareSeries[i].bucket;
        primary.series[i].compareBucketStart = compareSeries[i].bucketStart;
        primary.series[i].compareBucketEnd = compareSeries[i].bucketEnd;
      }
    }
  }
  return { total: primary.total, compareTotal, series: primary.series, unit: 'percent' };
}

async function computeCancellationSeries(range: ResolvedRange, buckets: Bucket[]) {
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  const all = await paginate(
    supabase.from('reservations')
      .select('created_at_guesty, status, source')
      .gte('created_at_guesty', startIso).lte('created_at_guesty', endIso)
  );
  const counts = buckets.map(() => ({ canc: 0, denom: 0 }));
  let totalCanc = 0, totalDenom = 0;
  for (const r of all) {
    if (r.source === 'owner') continue;
    if (!r.created_at_guesty) continue;
    const status = r.status as string | null;
    if (!status) continue;
    const isCanc = status === 'canceled';
    const isCounted = isCanc || ['confirmed', 'checked_in', 'checked_out'].includes(status);
    if (!isCounted) continue;
    totalDenom += 1;
    if (isCanc) totalCanc += 1;
    const idx = findBucketIdx(buckets, new Date(r.created_at_guesty));
    if (idx >= 0) {
      counts[idx].denom += 1;
      if (isCanc) counts[idx].canc += 1;
    }
  }
  const series: SeriesPoint[] = buckets.map((b, i) => ({
    bucket: b.label, bucketStart: b.start, bucketEnd: b.end,
    value: counts[i].denom > 0 ? counts[i].canc / counts[i].denom : 0,
  }));
  return { series, total: totalDenom > 0 ? totalCanc / totalDenom : 0 };
}

export async function fetchCancellationDetail(window: BucketWindow): Promise<KpiDetailRow[]> {
  const startIso = window.start.toISOString();
  const endIso = window.end.toISOString();
  const all = await paginate(
    supabase.from('reservations')
      .select('id, listing_id, check_in, check_out, created_at_guesty, status, source, confirmation_code, guest_name')
      .gte('created_at_guesty', startIso).lte('created_at_guesty', endIso)
      .eq('status', 'canceled')
  );
  const valid = all.filter((r: any) => r.source !== 'owner');
  const ids = Array.from(new Set(valid.map((r: any) => r.listing_id).filter(Boolean)));
  const nameMap = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('listings').select('id, nickname').in('id', ids.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) nameMap.set(r.id, r.nickname || r.id);
  }
  return valid.map((r: any) => ({
    id: r.id,
    primary: nameMap.get(r.listing_id) || r.listing_id || '—',
    secondary: `${r.guest_name || 'Guest'} · ${r.confirmation_code || ''} · ${r.check_in || ''} → ${r.check_out || ''}`,
    date: r.created_at_guesty,
  })).sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime());
}

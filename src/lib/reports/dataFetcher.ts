import { supabase } from '@/integrations/supabase/client';
import { format, eachMonthOfInterval, startOfMonth, endOfMonth, differenceInCalendarDays } from 'date-fns';
import { resolveDateRange, rangeToISO, resolveCompareRange } from './dateRange';
import {
  type ModuleData,
  type ModuleDataRow,
  type ReportModule,
  METRIC_LABELS,
  METRIC_UNITS,
  COMPARE_LABELS,
} from './types';

const BATCH_SIZE = 1000;

interface ListingMeta {
  id: string;
  nickname: string | null;
  owner_id: string | null;
  bedrooms: number | null;
}

async function fetchAllListings(): Promise<ListingMeta[]> {
  // Pulls all listings the user can see (RLS filters per org).
  const all: ListingMeta[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('listings')
      .select('id, nickname, owner_id, bedrooms')
      .eq('archived', false)
      .range(from, from + BATCH_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as ListingMeta[]));
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  return all;
}

async function resolveScopeListings(module: ReportModule): Promise<ListingMeta[]> {
  const allListings = await fetchAllListings();

  switch (module.scope.kind) {
    case 'all':
      return allListings;
    case 'listings': {
      const ids = new Set(module.scope.ids ?? []);
      return allListings.filter((l) => ids.has(l.id));
    }
    case 'owner': {
      const ownerIds = new Set(module.scope.ids ?? []);
      if (ownerIds.size === 0) return [];
      return allListings.filter((l) => l.owner_id && ownerIds.has(l.owner_id));
    }
    case 'group': {
      const groupIds = module.scope.ids ?? [];
      if (groupIds.length === 0) return [];
      const { data, error } = await supabase
        .from('property_group_members')
        .select('listing_id')
        .in('group_id', groupIds);
      if (error) throw error;
      const ids = new Set((data ?? []).map((r: any) => r.listing_id));
      return allListings.filter((l) => ids.has(l.id));
    }
  }
}

async function fetchReservationNights(
  listingIds: string[],
  start: string,
  end: string,
): Promise<Array<{ listing_id: string; night_date: string; revenue_allocation: number }>> {
  if (listingIds.length === 0) return [];

  // Batch listing IDs in chunks of 60 to avoid URL length issues
  const chunkSize = 60;
  const all: any[] = [];
  for (let i = 0; i < listingIds.length; i += chunkSize) {
    const chunk = listingIds.slice(i, i + chunkSize);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('reservation_nights')
        .select('listing_id, night_date, revenue_allocation')
        .in('listing_id', chunk)
        .gte('night_date', start)
        .lte('night_date', end)
        .range(from, from + BATCH_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  }
  return all;
}

async function fetchGoals(
  listingIds: string[],
  startYear: number,
  endYear: number,
): Promise<Array<{ listing_id: string; year: number; month: number; goal_revenue: number | null }>> {
  if (listingIds.length === 0) return [];
  const chunkSize = 60;
  const all: any[] = [];
  for (let i = 0; i < listingIds.length; i += chunkSize) {
    const chunk = listingIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('property_goals')
      .select('listing_id, year, month, goal_revenue')
      .in('listing_id', chunk)
      .gte('year', startYear)
      .lte('year', endYear);
    if (error) throw error;
    all.push(...(data ?? []));
  }
  return all;
}

interface OwnerMap {
  [ownerId: string]: string;
}
interface GroupMap {
  [groupId: string]: { name: string; listingIds: string[] };
}

async function fetchOwnerNames(ownerIds: string[]): Promise<OwnerMap> {
  if (ownerIds.length === 0) return {};
  const { data, error } = await supabase
    .from('owners')
    .select('id, full_name, first_name, last_name')
    .in('id', ownerIds);
  if (error) throw error;
  const map: OwnerMap = {};
  for (const o of data ?? []) {
    const o2 = o as any;
    map[o2.id] = o2.full_name || `${o2.first_name ?? ''} ${o2.last_name ?? ''}`.trim() || 'Unknown owner';
  }
  return map;
}

async function fetchGroupsForListings(listingIds: string[]): Promise<GroupMap> {
  if (listingIds.length === 0) return {};
  const chunkSize = 60;
  const memberships: any[] = [];
  for (let i = 0; i < listingIds.length; i += chunkSize) {
    const chunk = listingIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('property_group_members')
      .select('group_id, listing_id')
      .in('listing_id', chunk);
    if (error) throw error;
    memberships.push(...(data ?? []));
  }
  const groupIds = Array.from(new Set(memberships.map((m) => m.group_id)));
  if (groupIds.length === 0) return {};
  const { data: groups, error: gErr } = await supabase
    .from('property_groups')
    .select('id, name')
    .in('id', groupIds);
  if (gErr) throw gErr;
  const map: GroupMap = {};
  for (const g of groups ?? []) {
    const g2 = g as any;
    map[g2.id] = { name: g2.name, listingIds: [] };
  }
  for (const m of memberships) {
    if (map[m.group_id]) map[m.group_id].listingIds.push(m.listing_id);
  }
  return map;
}

interface CompsetMonthRow {
  listing_id: string;
  month: string; // "YYYY-MM"
  revenue: number;
  adr: number;
  occupancy: number; // 0..1
  revpar: number;
}

async function fetchCompsetMonthly(
  listingIds: string[],
  range: { start: Date; end: Date },
): Promise<CompsetMonthRow[]> {
  if (listingIds.length === 0) return [];
  const chunkSize = 60;
  const startKey = format(range.start, 'yyyy-MM');
  const endKey = format(range.end, 'yyyy-MM');
  const all: CompsetMonthRow[] = [];
  for (let i = 0; i < listingIds.length; i += chunkSize) {
    const chunk = listingIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('property_compset_summary')
      .select('listing_id, monthly_averages, future_monthly_averages')
      .in('listing_id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as any[]) {
      const past = Array.isArray(row.monthly_averages) ? row.monthly_averages : [];
      const future = Array.isArray(row.future_monthly_averages) ? row.future_monthly_averages : [];
      for (const m of [...past, ...future]) {
        const month: string | undefined = m?.month;
        if (!month) continue;
        if (month < startKey || month > endKey) continue;
        all.push({
          listing_id: row.listing_id,
          month,
          revenue: Number(m.revenue ?? 0),
          adr: Number(m.adr ?? 0),
          occupancy: Number(m.occupancy ?? 0),
          revpar: Number(m.revpar ?? 0),
        });
      }
    }
  }
  return all;
}

function bucketKey(
  date: Date,
  listingId: string,
  breakdown: ReportModule['breakdown'],
  listingsById: Map<string, ListingMeta>,
  ownerNames: OwnerMap,
  groupsForListing: Map<string, string[]>,
): string[] {
  if (!breakdown || breakdown === 'month') {
    return [format(date, 'MMM yyyy')];
  }
  if (breakdown === 'listing') {
    return [listingsById.get(listingId)?.nickname || listingId];
  }
  if (breakdown === 'owner') {
    const ownerId = listingsById.get(listingId)?.owner_id;
    if (!ownerId) return ['Unassigned'];
    return [ownerNames[ownerId] || ownerId];
  }
  if (breakdown === 'group') {
    const groupNames = groupsForListing.get(listingId) ?? [];
    if (groupNames.length === 0) return ['Ungrouped'];
    return groupNames;
  }
  return [format(date, 'MMM yyyy')];
}

function aggregateAvailableNights(
  listingIds: string[],
  start: Date,
  end: Date,
): number {
  const days = differenceInCalendarDays(end, start) + 1;
  return Math.max(0, days) * listingIds.length;
}

export async function fetchModuleData(module: ReportModule): Promise<ModuleData> {
  const range = resolveDateRange(module.dateRange);
  const { start: startStr, end: endStr } = rangeToISO(range);

  const listings = await resolveScopeListings(module);
  const listingsById = new Map(listings.map((l) => [l.id, l]));
  const listingIds = listings.map((l) => l.id);

  // Pivot path: only for table widgets with a secondary breakdown selected.
  if (module.type === 'table' && module.breakdown2 && module.breakdown2 !== module.breakdown) {
    return buildPivotData(module, range, startStr, endStr, listings, listingsById, listingIds);
  }



  // Goals path
  if (module.metric === 'goal') {
    const startYear = range.start.getFullYear();
    const endYear = range.end.getFullYear();
    const goals = await fetchGoals(listingIds, startYear, endYear);
    const filtered = goals.filter((g) => {
      const d = new Date(g.year, g.month - 1, 15);
      return d >= range.start && d <= range.end;
    });
    return aggregateGenericGoals(module, filtered, listingsById);
  }

  // Forecast path — read from revenue_forecasts.monthly_forecasts JSONB
  if (module.metric === 'forecast_p50') {
    if (listingIds.length === 0) {
      return emptyData(module);
    }
    const startYear = range.start.getFullYear();
    const endYear = range.end.getFullYear();
    const chunkSize = 60;
    const rows: Array<{ listing_id: string; target_month: string; forecast_p50: number }> = [];
    for (let i = 0; i < listingIds.length; i += chunkSize) {
      const chunk = listingIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('revenue_forecasts')
        .select('listing_id, year, monthly_forecasts, generated_at')
        .in('listing_id', chunk)
        .gte('year', startYear)
        .lte('year', endYear)
        .order('generated_at', { ascending: false });
      if (error) throw error;
      // Keep only the most recent forecast per (listing_id, year)
      const seen = new Set<string>();
      for (const r of (data ?? []) as any[]) {
        const key = `${r.listing_id}-${r.year}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const monthly = Array.isArray(r.monthly_forecasts) ? r.monthly_forecasts : [];
        for (const m of monthly) {
          const targetMonth: string | undefined = m?.month;
          if (!targetMonth) continue;
          const p50 = Number(
            m?.total_forecast_p50 ?? m?.blended_forecast ?? m?.probability_forecast ?? 0,
          );
          // Filter to month range
          const [y, mo] = targetMonth.split('-').map(Number);
          const d = new Date(y, (mo || 1) - 1, 15);
          if (d < range.start || d > range.end) continue;
          rows.push({ listing_id: r.listing_id, target_month: targetMonth, forecast_p50: p50 });
        }
      }
    }
    const forecastData = aggregateGenericForecast(module, rows, listingsById);

    // Compare to actual revenue for the same range
    if (module.compare === 'actual_revenue') {
      const nights = await fetchReservationNights(listingIds, startStr, endStr);

      // Resolve breakdown helpers if needed
      let ownerNames: OwnerMap = {};
      let groupsForListing = new Map<string, string[]>();
      if (module.breakdown === 'owner') {
        const ownerIds = Array.from(
          new Set(listings.map((l) => l.owner_id).filter(Boolean) as string[]),
        );
        ownerNames = await fetchOwnerNames(ownerIds);
      }
      if (module.breakdown === 'group') {
        const groups = await fetchGroupsForListings(listingIds);
        for (const [, g] of Object.entries(groups)) {
          for (const lid of g.listingIds) {
            const existing = groupsForListing.get(lid) ?? [];
            existing.push(g.name);
            groupsForListing.set(lid, existing);
          }
        }
      }

      const actualByBucket = new Map<string, number>();
      let actualTotal = 0;
      for (const n of nights) {
        const v = Number(n.revenue_allocation || 0);
        actualTotal += v;
        const d = new Date(n.night_date + 'T00:00:00');
        const buckets = bucketKey(d, n.listing_id, module.breakdown, listingsById, ownerNames, groupsForListing);
        for (const b of buckets) {
          actualByBucket.set(b, (actualByBucket.get(b) ?? 0) + v);
        }
      }
      for (const row of forecastData.rows) {
        row.compareValue = actualByBucket.get(row.key) ?? 0;
      }
      forecastData.compareTotal = actualTotal;
      forecastData.compareLabel = 'Actual Revenue';
    }

    // Compare forecast to compset (uses compset monthly revenue averages)
    if (module.compare === 'compset') {
      await applyCompsetCompare(module, listings, listingIds, range, listingsById, forecastData, 'revenue');
    }

    return forecastData;
  }



  // Reservation-night-derived metrics: revenue, nights, occupancy, adr, revpar
  const nights = await fetchReservationNights(listingIds, startStr, endStr);

  // Optional supporting data for breakdowns
  let ownerNames: OwnerMap = {};
  let groupsForListing = new Map<string, string[]>();
  if (module.breakdown === 'owner') {
    const ownerIds = Array.from(
      new Set(listings.map((l) => l.owner_id).filter(Boolean) as string[]),
    );
    ownerNames = await fetchOwnerNames(ownerIds);
  }
  if (module.breakdown === 'group') {
    const groups = await fetchGroupsForListings(listingIds);
    for (const [gid, g] of Object.entries(groups)) {
      for (const lid of g.listingIds) {
        const existing = groupsForListing.get(lid) ?? [];
        existing.push(g.name);
        groupsForListing.set(lid, existing);
      }
    }
  }

  // Aggregate by bucket
  const bucketRevenue = new Map<string, number>();
  const bucketNights = new Map<string, number>();
  const bucketListings = new Map<string, Set<string>>();

  for (const n of nights) {
    const d = new Date(n.night_date + 'T00:00:00');
    const buckets = bucketKey(d, n.listing_id, module.breakdown, listingsById, ownerNames, groupsForListing);
    for (const b of buckets) {
      bucketRevenue.set(b, (bucketRevenue.get(b) ?? 0) + Number(n.revenue_allocation || 0));
      bucketNights.set(b, (bucketNights.get(b) ?? 0) + 1);
      const set = bucketListings.get(b) ?? new Set<string>();
      set.add(n.listing_id);
      bucketListings.set(b, set);
    }
  }

  // Determine bucket order
  let allKeys: string[] = [];
  if (!module.breakdown || module.breakdown === 'month') {
    const months = eachMonthOfInterval({ start: startOfMonth(range.start), end: endOfMonth(range.end) });
    allKeys = months.map((m) => format(m, 'MMM yyyy'));
  } else {
    allKeys = Array.from(new Set([...bucketRevenue.keys()])).sort();
  }

  const totalDays = differenceInCalendarDays(range.end, range.start) + 1;

  // For occupancy/ADR/RevPAR we need available nights per bucket
  function availableForBucket(bucket: string): number {
    if (!module.breakdown || module.breakdown === 'month') {
      // Count days in that calendar month within the range, * # listings in scope
      const parsed = new Date(`${bucket} 01`);
      const monthStart = startOfMonth(parsed);
      const monthEnd = endOfMonth(parsed);
      const effStart = monthStart < range.start ? range.start : monthStart;
      const effEnd = monthEnd > range.end ? range.end : monthEnd;
      const days = Math.max(0, differenceInCalendarDays(effEnd, effStart) + 1);
      return days * listings.length;
    }
    // For listing/owner/group breakdowns: # listings in that bucket * total days
    const setSize = bucketListings.get(bucket)?.size ?? 0;
    return setSize * totalDays;
  }

  const rows: ModuleDataRow[] = allKeys.map((k) => {
    const rev = bucketRevenue.get(k) ?? 0;
    const nightsBooked = bucketNights.get(k) ?? 0;
    const avail = availableForBucket(k);
    let value = 0;
    switch (module.metric) {
      case 'revenue':
        value = rev;
        break;
      case 'nights':
        value = nightsBooked;
        break;
      case 'occupancy':
        value = avail > 0 ? Math.min(100, (nightsBooked / avail) * 100) : 0;
        break;
      case 'adr':
        value = nightsBooked > 0 ? rev / nightsBooked : 0;
        break;
      case 'revpar':
        value = avail > 0 ? rev / avail : 0;
        break;
    }
    return { key: k, value };
  });

  let total = 0;
  const totalRev = Array.from(bucketRevenue.values()).reduce((a, b) => a + b, 0);
  const totalNights = Array.from(bucketNights.values()).reduce((a, b) => a + b, 0);
  const totalAvail = aggregateAvailableNights(listingIds, range.start, range.end);
  switch (module.metric) {
    case 'revenue':
      total = totalRev;
      break;
    case 'nights':
      total = totalNights;
      break;
    case 'occupancy':
      total = totalAvail > 0 ? Math.min(100, (totalNights / totalAvail) * 100) : 0;
      break;
    case 'adr':
      total = totalNights > 0 ? totalRev / totalNights : 0;
      break;
    case 'revpar':
      total = totalAvail > 0 ? totalRev / totalAvail : 0;
      break;
  }

  // Comparison
  let compareTotal: number | undefined;
  let compareLabel: string | undefined;

  // Date-range based comparisons (last_year, previous_period, last_30_days, last_90_days, last_month, two_years_ago)
  const prevRange = resolveCompareRange(range, module.compare ?? null);
  if (prevRange && module.compare && module.compare !== 'goal') {
    const { start: ps, end: pe } = rangeToISO(prevRange);
    const prevNights = await fetchReservationNights(listingIds, ps, pe);
    const prevRev = prevNights.reduce((a, n) => a + Number(n.revenue_allocation || 0), 0);
    const prevNightsCount = prevNights.length;
    const prevAvail = aggregateAvailableNights(listingIds, prevRange.start, prevRange.end);
    switch (module.metric) {
      case 'revenue':
        compareTotal = prevRev;
        break;
      case 'nights':
        compareTotal = prevNightsCount;
        break;
      case 'occupancy':
        compareTotal = prevAvail > 0 ? Math.min(100, (prevNightsCount / prevAvail) * 100) : 0;
        break;
      case 'adr':
        compareTotal = prevNightsCount > 0 ? prevRev / prevNightsCount : 0;
        break;
      case 'revpar':
        compareTotal = prevAvail > 0 ? prevRev / prevAvail : 0;
        break;
    }
    compareLabel = COMPARE_LABELS[module.compare];

    // Per-bucket compare for month breakdowns — only meaningful when buckets align
    // (year-shifted comparisons map cleanly; other ranges may not, so we still
    // render per-bucket where the bucket label exists in the prev range.)
    if (!module.breakdown || module.breakdown === 'month') {
      const prevBucketRev = new Map<string, number>();
      const prevBucketNights = new Map<string, number>();

      // For year shifts, align by shifting forward N years; for other compares,
      // align by index position (oldest prev bucket → oldest current bucket).
      const yearShift =
        module.compare === 'last_year' ? 1 : module.compare === 'two_years_ago' ? 2 : 0;

      if (yearShift > 0) {
        for (const n of prevNights) {
          const d = new Date(n.night_date + 'T00:00:00');
          const shifted = new Date(d);
          shifted.setFullYear(shifted.getFullYear() + yearShift);
          const k = format(shifted, 'MMM yyyy');
          prevBucketRev.set(k, (prevBucketRev.get(k) ?? 0) + Number(n.revenue_allocation || 0));
          prevBucketNights.set(k, (prevBucketNights.get(k) ?? 0) + 1);
        }
      } else {
        // Index-aligned: bucket the prev range by its own months, then map by ordinal
        const prevMonthRev = new Map<string, number>();
        const prevMonthNights = new Map<string, number>();
        for (const n of prevNights) {
          const d = new Date(n.night_date + 'T00:00:00');
          const k = format(d, 'MMM yyyy');
          prevMonthRev.set(k, (prevMonthRev.get(k) ?? 0) + Number(n.revenue_allocation || 0));
          prevMonthNights.set(k, (prevMonthNights.get(k) ?? 0) + 1);
        }
        const prevMonths = eachMonthOfInterval({
          start: startOfMonth(prevRange.start),
          end: endOfMonth(prevRange.end),
        }).map((m) => format(m, 'MMM yyyy'));
        const currMonths = allKeys;
        const len = Math.min(prevMonths.length, currMonths.length);
        for (let i = 0; i < len; i++) {
          const pk = prevMonths[i];
          const ck = currMonths[i];
          prevBucketRev.set(ck, prevMonthRev.get(pk) ?? 0);
          prevBucketNights.set(ck, prevMonthNights.get(pk) ?? 0);
        }
      }

      for (const row of rows) {
        const r = prevBucketRev.get(row.key) ?? 0;
        const nb = prevBucketNights.get(row.key) ?? 0;
        const av = availableForBucket(row.key);
        switch (module.metric) {
          case 'revenue':
            row.compareValue = r;
            break;
          case 'nights':
            row.compareValue = nb;
            break;
          case 'occupancy':
            row.compareValue = av > 0 ? Math.min(100, (nb / av) * 100) : 0;
            break;
          case 'adr':
            row.compareValue = nb > 0 ? r / nb : 0;
            break;
          case 'revpar':
            row.compareValue = av > 0 ? r / av : 0;
            break;
        }
      }
    } else {
      // Non-month breakdowns (listing / owner / group): aggregate prev nights by the same bucket key
      const prevBucketRev = new Map<string, number>();
      const prevBucketNights = new Map<string, number>();
      const prevBucketListings = new Map<string, Set<string>>();
      for (const n of prevNights) {
        const d = new Date(n.night_date + 'T00:00:00');
        const buckets = bucketKey(d, n.listing_id, module.breakdown, listingsById, ownerNames, groupsForListing);
        for (const b of buckets) {
          prevBucketRev.set(b, (prevBucketRev.get(b) ?? 0) + Number(n.revenue_allocation || 0));
          prevBucketNights.set(b, (prevBucketNights.get(b) ?? 0) + 1);
          const set = prevBucketListings.get(b) ?? new Set<string>();
          set.add(n.listing_id);
          prevBucketListings.set(b, set);
        }
      }
      const prevTotalDays = differenceInCalendarDays(prevRange.end, prevRange.start) + 1;
      for (const row of rows) {
        const r = prevBucketRev.get(row.key) ?? 0;
        const nb = prevBucketNights.get(row.key) ?? 0;
        const setSize = prevBucketListings.get(row.key)?.size ?? 0;
        const av = setSize * prevTotalDays;
        switch (module.metric) {
          case 'revenue':
            row.compareValue = r;
            break;
          case 'nights':
            row.compareValue = nb;
            break;
          case 'occupancy':
            row.compareValue = av > 0 ? Math.min(100, (nb / av) * 100) : 0;
            break;
          case 'adr':
            row.compareValue = nb > 0 ? r / nb : 0;
            break;
          case 'revpar':
            row.compareValue = av > 0 ? r / av : 0;
            break;
        }
      }
    }
  } else if (module.compare === 'goal' && (module.metric === 'revenue')) {
    const startYear = range.start.getFullYear();
    const endYear = range.end.getFullYear();
    const goals = await fetchGoals(listingIds, startYear, endYear);
    const filtered = goals.filter((g) => {
      const d = new Date(g.year, g.month - 1, 15);
      return d >= range.start && d <= range.end;
    });
    let goalTotal = 0;
    const byMonth = new Map<string, number>();
    for (const g of filtered) {
      const v = Number(g.goal_revenue || 0);
      goalTotal += v;
      const k = format(new Date(g.year, g.month - 1, 1), 'MMM yyyy');
      byMonth.set(k, (byMonth.get(k) ?? 0) + v);
    }
    compareTotal = goalTotal;
    compareLabel = 'Goal';
    if (!module.breakdown || module.breakdown === 'month') {
      for (const row of rows) {
        row.compareValue = byMonth.get(row.key) ?? 0;
      }
    }
  } else if (module.compare === 'compset') {
    const partial: ModuleData = {
      rows,
      total,
      unit: METRIC_UNITS[module.metric],
      metricLabel: METRIC_LABELS[module.metric],
    };
    const metricKey = (module.metric === 'nights' ? 'revenue' : module.metric) as
      | 'revenue' | 'occupancy' | 'adr' | 'revpar';
    await applyCompsetCompare(module, listings, listingIds, range, listingsById, partial, metricKey);
    compareTotal = partial.compareTotal;
    compareLabel = partial.compareLabel;
  }

  return {
    rows,
    total,
    compareTotal,
    unit: METRIC_UNITS[module.metric],
    metricLabel: METRIC_LABELS[module.metric],
    compareLabel,
  };
}

function emptyData(module: ReportModule): ModuleData {
  return {
    rows: [],
    total: 0,
    unit: METRIC_UNITS[module.metric],
    metricLabel: METRIC_LABELS[module.metric],
  };
}

function aggregateGenericGoals(
  module: ReportModule,
  goals: Array<{ listing_id: string; year: number; month: number; goal_revenue: number | null }>,
  listingsById: Map<string, ListingMeta>,
): ModuleData {
  const buckets = new Map<string, number>();
  for (const g of goals) {
    let key: string;
    if (module.breakdown === 'listing') {
      key = listingsById.get(g.listing_id)?.nickname || g.listing_id;
    } else if (module.breakdown === 'owner') {
      key = listingsById.get(g.listing_id)?.owner_id || 'Unassigned';
    } else {
      key = format(new Date(g.year, g.month - 1, 1), 'MMM yyyy');
    }
    buckets.set(key, (buckets.get(key) ?? 0) + Number(g.goal_revenue || 0));
  }
  const rows: ModuleDataRow[] = Array.from(buckets.entries()).map(([key, value]) => ({ key, value }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return {
    rows,
    total,
    unit: 'currency',
    metricLabel: METRIC_LABELS[module.metric],
  };
}

function aggregateGenericForecast(
  module: ReportModule,
  rowsRaw: Array<{ listing_id: string; target_month: string; forecast_p50: number }>,
  listingsById: Map<string, ListingMeta>,
): ModuleData {
  const buckets = new Map<string, number>();
  for (const r of rowsRaw) {
    let key: string;
    if (module.breakdown === 'listing') {
      key = listingsById.get(r.listing_id)?.nickname || r.listing_id;
    } else {
      // target_month is "YYYY-MM"
      const [y, m] = r.target_month.split('-').map(Number);
      key = format(new Date(y, (m || 1) - 1, 1), 'MMM yyyy');
    }
    buckets.set(key, (buckets.get(key) ?? 0) + Number(r.forecast_p50 || 0));
  }
  const rows: ModuleDataRow[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return {
    rows,
    total,
    unit: 'currency',
    metricLabel: METRIC_LABELS[module.metric],
  };
}

async function applyCompsetCompare(
  module: ReportModule,
  listings: ListingMeta[],
  listingIds: string[],
  range: { start: Date; end: Date },
  listingsById: Map<string, ListingMeta>,
  data: ModuleData,
  metricKey: 'revenue' | 'occupancy' | 'adr' | 'revpar',
): Promise<void> {
  const compsetRows = await fetchCompsetMonthly(listingIds, range);
  if (compsetRows.length === 0) {
    for (const row of data.rows) row.compareValue = 0;
    data.compareLabel = 'Compset';
    data.compareTotal = 0;
    return;
  }


  // Resolve breakdown helpers
  let ownerNames: OwnerMap = {};
  let groupsForListing = new Map<string, string[]>();
  if (module.breakdown === 'owner') {
    const ownerIds = Array.from(
      new Set(listings.map((l) => l.owner_id).filter(Boolean) as string[]),
    );
    ownerNames = await fetchOwnerNames(ownerIds);
  }
  if (module.breakdown === 'group') {
    const groups = await fetchGroupsForListings(listingIds);
    for (const [, g] of Object.entries(groups)) {
      for (const lid of g.listingIds) {
        const existing = groupsForListing.get(lid) ?? [];
        existing.push(g.name);
        groupsForListing.set(lid, existing);
      }
    }
  }

  // Bucket compset values. For revenue we sum across listings+months.
  // For occupancy/adr/revpar we average across the (listing, month) cells
  // that fall into the bucket.
  const sumByBucket = new Map<string, number>();
  const countByBucket = new Map<string, number>();
  let totalSum = 0;
  let totalCount = 0;

  for (const r of compsetRows) {
    const [y, m] = r.month.split('-').map(Number);
    const d = new Date(y, (m || 1) - 1, 15);
    const buckets = bucketKey(d, r.listing_id, module.breakdown, listingsById, ownerNames, groupsForListing);
    let v = 0;
    if (metricKey === 'revenue') v = r.revenue;
    else if (metricKey === 'occupancy') v = r.occupancy * 100;
    else if (metricKey === 'adr') v = r.adr;
    else if (metricKey === 'revpar') v = r.revpar;
    for (const b of buckets) {
      sumByBucket.set(b, (sumByBucket.get(b) ?? 0) + v);
      countByBucket.set(b, (countByBucket.get(b) ?? 0) + 1);
    }
    totalSum += v;
    totalCount += 1;
  }

  const aggregate = (sum: number, count: number) =>
    metricKey === 'revenue' ? sum : count > 0 ? sum / count : 0;

  for (const row of data.rows) {
    const s = sumByBucket.get(row.key) ?? 0;
    const c = countByBucket.get(row.key) ?? 0;
    row.compareValue = aggregate(s, c);
  }
  data.compareTotal = aggregate(totalSum, totalCount);
  data.compareLabel = 'Compset';
}

// ============================================================
// Pivot (Rows × Columns) data path for Table widgets
// ============================================================

function sortBucketLabels(keys: string[], breakdown: ReportModule['breakdown']): string[] {
  const arr = keys.slice();
  if (!breakdown || breakdown === 'month') {
    arr.sort((a, b) => {
      const da = Date.parse(`${a} 01`);
      const db = Date.parse(`${b} 01`);
      if (isNaN(da) || isNaN(db)) return a.localeCompare(b);
      return da - db;
    });
  } else {
    arr.sort((a, b) => a.localeCompare(b));
  }
  return arr;
}

function pivotKeyPairs(
  date: Date,
  listingId: string,
  rowB: ReportModule['breakdown'],
  colB: ReportModule['breakdown'],
  listingsById: Map<string, ListingMeta>,
  ownerNames: OwnerMap,
  groupsForListing: Map<string, string[]>,
): Array<[string, string]> {
  const rowKeys = bucketKey(date, listingId, rowB, listingsById, ownerNames, groupsForListing);
  const colKeys = bucketKey(date, listingId, colB, listingsById, ownerNames, groupsForListing);
  const out: Array<[string, string]> = [];
  for (const r of rowKeys) for (const c of colKeys) out.push([r, c]);
  return out;
}

async function resolveBreakdownHelpers(
  rowB: ReportModule['breakdown'],
  colB: ReportModule['breakdown'],
  listings: ListingMeta[],
  listingIds: string[],
): Promise<{ ownerNames: OwnerMap; groupsForListing: Map<string, string[]> }> {
  const needOwner = rowB === 'owner' || colB === 'owner';
  const needGroup = rowB === 'group' || colB === 'group';
  let ownerNames: OwnerMap = {};
  const groupsForListing = new Map<string, string[]>();
  if (needOwner) {
    const ownerIds = Array.from(new Set(listings.map((l) => l.owner_id).filter(Boolean) as string[]));
    ownerNames = await fetchOwnerNames(ownerIds);
  }
  if (needGroup) {
    const groups = await fetchGroupsForListings(listingIds);
    for (const [, g] of Object.entries(groups)) {
      for (const lid of g.listingIds) {
        const existing = groupsForListing.get(lid) ?? [];
        existing.push(g.name);
        groupsForListing.set(lid, existing);
      }
    }
  }
  return { ownerNames, groupsForListing };
}

async function buildPivotData(
  module: ReportModule,
  range: { start: Date; end: Date; label: string },
  startStr: string,
  endStr: string,
  listings: ListingMeta[],
  listingsById: Map<string, ListingMeta>,
  listingIds: string[],
): Promise<ModuleData> {
  const unit = METRIC_UNITS[module.metric];
  const metricLabel = METRIC_LABELS[module.metric];
  const rowB = module.breakdown ?? 'month';
  const colB = module.breakdown2!;

  if (listingIds.length === 0) {
    return {
      rows: [],
      total: 0,
      unit,
      metricLabel,
      pivot: { columns: [], rows: [], columnTotals: {}, grandTotal: 0 },
    };
  }

  const { ownerNames, groupsForListing } = await resolveBreakdownHelpers(
    rowB,
    colB,
    listings,
    listingIds,
  );

  // Per-cell accumulators
  const revByCell = new Map<string, number>(); // key = rowKey|||colKey
  const nightsByCell = new Map<string, number>();
  const listingsByCell = new Map<string, Set<string>>();
  const rowKeysSet = new Set<string>();
  const colKeysSet = new Set<string>();

  const cellKey = (r: string, c: string) => `${r}|||${c}`;

  // ---- Goal metric ----
  if (module.metric === 'goal') {
    const goals = await fetchGoals(
      listingIds,
      range.start.getFullYear(),
      range.end.getFullYear(),
    );
    for (const g of goals) {
      const d = new Date(g.year, g.month - 1, 15);
      if (d < range.start || d > range.end) continue;
      const pairs = pivotKeyPairs(d, g.listing_id, rowB, colB, listingsById, ownerNames, groupsForListing);
      const v = Number(g.goal_revenue || 0);
      for (const [r, c] of pairs) {
        rowKeysSet.add(r); colKeysSet.add(c);
        revByCell.set(cellKey(r, c), (revByCell.get(cellKey(r, c)) ?? 0) + v);
      }
    }
    return assemblePivot(rowB, colB, rowKeysSet, colKeysSet, revByCell, nightsByCell, listingsByCell, range, listings, 'revenue', unit, metricLabel);
  }

  // ---- Forecast metric ----
  if (module.metric === 'forecast_p50') {
    const startYear = range.start.getFullYear();
    const endYear = range.end.getFullYear();
    const chunkSize = 60;
    for (let i = 0; i < listingIds.length; i += chunkSize) {
      const chunk = listingIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('revenue_forecasts')
        .select('listing_id, year, monthly_forecasts, generated_at')
        .in('listing_id', chunk)
        .gte('year', startYear)
        .lte('year', endYear)
        .order('generated_at', { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      for (const r of (data ?? []) as any[]) {
        const key = `${r.listing_id}-${r.year}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const monthly = Array.isArray(r.monthly_forecasts) ? r.monthly_forecasts : [];
        for (const m of monthly) {
          const targetMonth: string | undefined = m?.month;
          if (!targetMonth) continue;
          const [y, mo] = targetMonth.split('-').map(Number);
          const d = new Date(y, (mo || 1) - 1, 15);
          if (d < range.start || d > range.end) continue;
          const v = Number(m?.total_forecast_p50 ?? m?.blended_forecast ?? m?.probability_forecast ?? 0);
          const pairs = pivotKeyPairs(d, r.listing_id, rowB, colB, listingsById, ownerNames, groupsForListing);
          for (const [rk, ck] of pairs) {
            rowKeysSet.add(rk); colKeysSet.add(ck);
            revByCell.set(cellKey(rk, ck), (revByCell.get(cellKey(rk, ck)) ?? 0) + v);
          }
        }
      }
    }
    return assemblePivot(rowB, colB, rowKeysSet, colKeysSet, revByCell, nightsByCell, listingsByCell, range, listings, 'revenue', unit, metricLabel);
  }

  // ---- Reservation-night metrics: revenue / nights / occupancy / adr / revpar ----
  const nights = await fetchReservationNights(listingIds, startStr, endStr);
  for (const n of nights) {
    const d = new Date(n.night_date + 'T00:00:00');
    const pairs = pivotKeyPairs(d, n.listing_id, rowB, colB, listingsById, ownerNames, groupsForListing);
    const rev = Number(n.revenue_allocation || 0);
    for (const [rk, ck] of pairs) {
      rowKeysSet.add(rk); colKeysSet.add(ck);
      const ck2 = cellKey(rk, ck);
      revByCell.set(ck2, (revByCell.get(ck2) ?? 0) + rev);
      nightsByCell.set(ck2, (nightsByCell.get(ck2) ?? 0) + 1);
      const set = listingsByCell.get(ck2) ?? new Set<string>();
      set.add(n.listing_id);
      listingsByCell.set(ck2, set);
    }
  }

  return assemblePivot(rowB, colB, rowKeysSet, colKeysSet, revByCell, nightsByCell, listingsByCell, range, listings, module.metric, unit, metricLabel);
}

function availableNightsForPivotCell(
  rowB: ReportModule['breakdown'],
  colB: ReportModule['breakdown'],
  rowKey: string,
  colKey: string,
  listingsInCell: number,
  range: { start: Date; end: Date },
  totalListings: number,
): number {
  // Determine which axis (if any) is "month"
  const monthLabel =
    rowB === 'month' ? rowKey : colB === 'month' ? colKey : null;
  let days: number;
  if (monthLabel) {
    const parsed = new Date(`${monthLabel} 01`);
    if (isNaN(parsed.getTime())) {
      days = differenceInCalendarDays(range.end, range.start) + 1;
    } else {
      const ms = startOfMonth(parsed);
      const me = endOfMonth(parsed);
      const effS = ms < range.start ? range.start : ms;
      const effE = me > range.end ? range.end : me;
      days = Math.max(0, differenceInCalendarDays(effE, effS) + 1);
    }
  } else {
    days = differenceInCalendarDays(range.end, range.start) + 1;
  }
  // If neither axis is month, we still use unique-listings-in-cell as the property count.
  // If one axis is month and the other is an entity axis, listingsInCell is correct.
  // If one axis is month and the other axis is also based on entity that's unbooked, listingsInCell underestimates;
  // but that matches the legacy single-axis behavior for non-month breakdowns.
  const props = listingsInCell > 0 ? listingsInCell : 0;
  return days * props;
}

function assemblePivot(
  rowB: ReportModule['breakdown'],
  colB: ReportModule['breakdown'],
  rowKeysSet: Set<string>,
  colKeysSet: Set<string>,
  revByCell: Map<string, number>,
  nightsByCell: Map<string, number>,
  listingsByCell: Map<string, Set<string>>,
  range: { start: Date; end: Date },
  listings: ListingMeta[],
  metric: 'revenue' | 'nights' | 'occupancy' | 'adr' | 'revpar' | 'goal' | 'forecast_p50',
  unit: ModuleData['unit'],
  metricLabel: string,
): ModuleData {
  const cellKey = (r: string, c: string) => `${r}|||${c}`;

  // If month is on either axis, ensure all months in range are present even if empty.
  if (rowB === 'month') {
    const months = eachMonthOfInterval({ start: startOfMonth(range.start), end: endOfMonth(range.end) });
    for (const m of months) rowKeysSet.add(format(m, 'MMM yyyy'));
  }
  if (colB === 'month') {
    const months = eachMonthOfInterval({ start: startOfMonth(range.start), end: endOfMonth(range.end) });
    for (const m of months) colKeysSet.add(format(m, 'MMM yyyy'));
  }

  const rowKeys = sortBucketLabels(Array.from(rowKeysSet), rowB);
  const colKeys = sortBucketLabels(Array.from(colKeysSet), colB);

  const computeCellValue = (rk: string, ck: string): number => {
    const k = cellKey(rk, ck);
    const rev = revByCell.get(k) ?? 0;
    const nb = nightsByCell.get(k) ?? 0;
    const setSize = listingsByCell.get(k)?.size ?? 0;
    switch (metric) {
      case 'revenue':
      case 'goal':
      case 'forecast_p50':
        return rev;
      case 'nights':
        return nb;
      case 'occupancy': {
        const av = availableNightsForPivotCell(rowB, colB, rk, ck, setSize, range, listings.length);
        return av > 0 ? Math.min(100, (nb / av) * 100) : 0;
      }
      case 'adr':
        return nb > 0 ? rev / nb : 0;
      case 'revpar': {
        const av = availableNightsForPivotCell(rowB, colB, rk, ck, setSize, range, listings.length);
        return av > 0 ? rev / av : 0;
      }
    }
  };

  // Build pivot rows and totals
  const pivotRows = rowKeys.map((rk) => {
    const values: Record<string, number> = {};
    let rowTotalRev = 0, rowTotalNights = 0, rowTotalListings = new Set<string>();
    for (const ck of colKeys) {
      values[ck] = computeCellValue(rk, ck);
      const k = cellKey(rk, ck);
      rowTotalRev += revByCell.get(k) ?? 0;
      rowTotalNights += nightsByCell.get(k) ?? 0;
      for (const l of (listingsByCell.get(k) ?? new Set<string>())) rowTotalListings.add(l);
    }
    // Recompute row total using same per-row aggregation rules
    let rowTotal = 0;
    switch (metric) {
      case 'revenue':
      case 'goal':
      case 'forecast_p50':
        rowTotal = rowTotalRev; break;
      case 'nights':
        rowTotal = rowTotalNights; break;
      case 'occupancy': {
        // available across this row = sum of cell avail across columns
        let av = 0;
        for (const ck of colKeys) {
          const k = cellKey(rk, ck);
          av += availableNightsForPivotCell(rowB, colB, rk, ck, listingsByCell.get(k)?.size ?? 0, range, listings.length);
        }
        rowTotal = av > 0 ? Math.min(100, (rowTotalNights / av) * 100) : 0;
        break;
      }
      case 'adr':
        rowTotal = rowTotalNights > 0 ? rowTotalRev / rowTotalNights : 0; break;
      case 'revpar': {
        let av = 0;
        for (const ck of colKeys) {
          const k = cellKey(rk, ck);
          av += availableNightsForPivotCell(rowB, colB, rk, ck, listingsByCell.get(k)?.size ?? 0, range, listings.length);
        }
        rowTotal = av > 0 ? rowTotalRev / av : 0;
        break;
      }
    }
    return { key: rk, values, rowTotal };
  });

  // Column totals
  const columnTotals: Record<string, number> = {};
  for (const ck of colKeys) {
    let colRev = 0, colNights = 0, colAv = 0;
    for (const rk of rowKeys) {
      const k = cellKey(rk, ck);
      colRev += revByCell.get(k) ?? 0;
      colNights += nightsByCell.get(k) ?? 0;
      colAv += availableNightsForPivotCell(rowB, colB, rk, ck, listingsByCell.get(k)?.size ?? 0, range, listings.length);
    }
    switch (metric) {
      case 'revenue':
      case 'goal':
      case 'forecast_p50':
        columnTotals[ck] = colRev; break;
      case 'nights':
        columnTotals[ck] = colNights; break;
      case 'occupancy':
        columnTotals[ck] = colAv > 0 ? Math.min(100, (colNights / colAv) * 100) : 0; break;
      case 'adr':
        columnTotals[ck] = colNights > 0 ? colRev / colNights : 0; break;
      case 'revpar':
        columnTotals[ck] = colAv > 0 ? colRev / colAv : 0; break;
    }
  }

  // Grand total
  let grandRev = 0, grandNights = 0, grandAv = 0;
  for (const rk of rowKeys) for (const ck of colKeys) {
    const k = cellKey(rk, ck);
    grandRev += revByCell.get(k) ?? 0;
    grandNights += nightsByCell.get(k) ?? 0;
    grandAv += availableNightsForPivotCell(rowB, colB, rk, ck, listingsByCell.get(k)?.size ?? 0, range, listings.length);
  }
  let grandTotal = 0;
  switch (metric) {
    case 'revenue':
    case 'goal':
    case 'forecast_p50':
      grandTotal = grandRev; break;
    case 'nights':
      grandTotal = grandNights; break;
    case 'occupancy':
      grandTotal = grandAv > 0 ? Math.min(100, (grandNights / grandAv) * 100) : 0; break;
    case 'adr':
      grandTotal = grandNights > 0 ? grandRev / grandNights : 0; break;
    case 'revpar':
      grandTotal = grandAv > 0 ? grandRev / grandAv : 0; break;
  }

  // Keep backward-compat rows[] populated with the row totals so non-pivot consumers don't crash.
  const flatRows: ModuleDataRow[] = pivotRows.map((r) => ({ key: r.key, value: r.rowTotal }));

  return {
    rows: flatRows,
    total: grandTotal,
    unit,
    metricLabel,
    pivot: {
      columns: colKeys,
      rows: pivotRows,
      columnTotals,
      grandTotal,
    },
  };
}

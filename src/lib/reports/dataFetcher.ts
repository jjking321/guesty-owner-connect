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
      const ownerId = module.scope.ids?.[0];
      if (!ownerId) return [];
      return allListings.filter((l) => l.owner_id === ownerId);
    }
    case 'group': {
      const groupId = module.scope.ids?.[0];
      if (!groupId) return [];
      const { data, error } = await supabase
        .from('property_group_members')
        .select('listing_id')
        .eq('group_id', groupId);
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

  // Forecast path — read from forecast_accuracy as rough P50 source
  if (module.metric === 'forecast_p50') {
    // Use forecast_accuracy.forecast_p50 grouped by target_month
    if (listingIds.length === 0) {
      return emptyData(module);
    }
    const chunkSize = 60;
    const all: any[] = [];
    for (let i = 0; i < listingIds.length; i += chunkSize) {
      const chunk = listingIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('forecast_accuracy')
        .select('listing_id, target_month, forecast_p50')
        .in('listing_id', chunk)
        .gte('target_month', format(range.start, 'yyyy-MM'))
        .lte('target_month', format(range.end, 'yyyy-MM'));
      if (error) throw error;
      all.push(...(data ?? []));
    }
    return aggregateGenericForecast(module, all, listingsById);
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
  if (module.compare === 'last_year') {
    const prevRange = shiftRangeByYear(range, -1);
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
    compareLabel = 'Last year';

    // Per-bucket compare for month breakdowns
    if (!module.breakdown || module.breakdown === 'month') {
      const prevBucketRev = new Map<string, number>();
      const prevBucketNights = new Map<string, number>();
      for (const n of prevNights) {
        const d = new Date(n.night_date + 'T00:00:00');
        // Shift forward 1 year to align with current bucket label
        const shifted = new Date(d);
        shifted.setFullYear(shifted.getFullYear() + 1);
        const k = format(shifted, 'MMM yyyy');
        prevBucketRev.set(k, (prevBucketRev.get(k) ?? 0) + Number(n.revenue_allocation || 0));
        prevBucketNights.set(k, (prevBucketNights.get(k) ?? 0) + 1);
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

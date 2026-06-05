import { supabase } from '@/integrations/supabase/client';
import { rangeISO } from './range';
import type { ResolvedRange } from './types';

const BATCH = 1000;

// In-memory cache: key -> Promise<any>. Promises (not values) are cached so
// concurrent callers share the same in-flight request.
const cache = new Map<string, Promise<any>>();

function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn().catch((e) => {
    // Don't cache failed fetches — let the next caller retry.
    cache.delete(key);
    throw e;
  });
  cache.set(key, p);
  return p;
}

export function clearKpiCache() {
  cache.clear();
}

async function paginate(query: any): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + BATCH - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return out;
}

// ---------- Reservations ----------

export interface SharedReservation {
  check_in: string | null;
  check_out: string | null;
  created_at_guesty: string | null;
  nights_count: number | null;
  sub_total: number | null;
  fare_accommodation_adjusted: number | null;
  source: string | null;
  status: string | null;
  listing_id: string | null;
}

const RES_COLS =
  'check_in, check_out, created_at_guesty, nights_count, sub_total, fare_accommodation_adjusted, source, status, listing_id';

/** Reservations whose check_in falls in [start, end]. Used by GBV / Channel mix / ADR / Revenue per listing. */
export function getReservationsByCheckIn(range: ResolvedRange): Promise<SharedReservation[]> {
  const { start, end } = rangeISO(range);
  return memo(`res:checkin:${start}:${end}`, () =>
    paginate(
      supabase
        .from('reservations')
        .select(RES_COLS)
        .gte('check_in', start)
        .lte('check_in', end),
    ),
  );
}

/** Reservations whose created_at_guesty falls in [start, end]. Used by Cancellation rate. */
export function getReservationsByCreatedAt(range: ResolvedRange): Promise<SharedReservation[]> {
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  return memo(`res:created:${startIso}:${endIso}`, () =>
    paginate(
      supabase
        .from('reservations')
        .select(RES_COLS)
        .gte('created_at_guesty', startIso)
        .lte('created_at_guesty', endIso),
    ),
  );
}

// ---------- Listings ----------

export interface SharedListing {
  id: string;
  created_at_guesty: string | null;
  is_listed: boolean | null;
  active: boolean | null;
  archived: boolean;
  guesty_account_id: string;
  owner_id: string | null;
  last_active_at: string | null;
}

export function getAllListings(): Promise<SharedListing[]> {
  return memo('listings:all', () =>
    paginate(
      supabase
        .from('listings')
        .select(
          'id, created_at_guesty, is_listed, active, archived, guesty_account_id, owner_id, last_active_at',
        ),
    ),
  );
}

// ---------- Churn events ----------

export interface SharedChurnEvents {
  /** Map of listing_id -> churned_at, for open & non-ignored events. */
  openByListing: Map<string, string>;
  /** Set of listing_ids whose open events are ignored. */
  ignoredSet: Set<string>;
}

export function getChurnEvents(): Promise<SharedChurnEvents> {
  return memo('churn:events', async () => {
    const [openEvents, ignoredEvents] = await Promise.all([
      paginate(
        supabase
          .from('listing_churn_events')
          .select('listing_id, churned_at, ignored')
          .is('restored_at', null)
          .eq('ignored', false),
      ),
      paginate(
        supabase
          .from('listing_churn_events')
          .select('listing_id')
          .is('restored_at', null)
          .eq('ignored', true),
      ),
    ]);
    return {
      openByListing: new Map(openEvents.map((e: any) => [e.listing_id, e.churned_at])),
      ignoredSet: new Set(ignoredEvents.map((e: any) => e.listing_id)),
    };
  });
}

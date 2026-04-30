// Nightly: write listing_status_snapshots for each org and open/close churn events.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const today = new Date().toISOString().slice(0, 10);

    // Fetch all guesty accounts -> org map
    const { data: accounts, error: aErr } = await supabase
      .from('guesty_accounts')
      .select('id, organization_id');
    if (aErr) throw aErr;
    const orgByAccount = new Map<string, string>();
    const orgIds = new Set<string>();
    for (const a of accounts ?? []) {
      orgByAccount.set(a.id, a.organization_id);
      orgIds.add(a.organization_id);
    }

    // Fetch all listings (paginate)
    const listings: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('listings')
        .select('id, guesty_account_id, is_listed, active, archived, last_active_at')
        .range(from, from + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      listings.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }

    // Per-org counts
    const counts: Record<string, { listed: number; active: number; archived: number; churned: number }> = {};
    for (const id of orgIds) counts[id] = { listed: 0, active: 0, archived: 0, churned: 0 };

    const churnedListings: { id: string; org: string; lastActive: string | null }[] = [];
    const restoredListings: { id: string; org: string }[] = [];

    for (const l of listings) {
      const org = orgByAccount.get(l.guesty_account_id);
      if (!org) continue;
      if (l.archived) counts[org].archived++;
      if (l.is_listed) counts[org].listed++;
      if (l.active) counts[org].active++;

      const isChurnedNow = !l.is_listed && !l.active;
      if (isChurnedNow) {
        counts[org].churned++;
        churnedListings.push({ id: l.id, org, lastActive: l.last_active_at });
      } else {
        restoredListings.push({ id: l.id, org });
      }
    }

    // Upsert snapshots
    const snapshotRows = Array.from(orgIds).map((org) => ({
      organization_id: org,
      snapshot_date: today,
      total_listed: counts[org].listed,
      total_active: counts[org].active,
      total_archived: counts[org].archived,
      total_churned: counts[org].churned,
    }));
    if (snapshotRows.length) {
      const { error } = await supabase
        .from('listing_status_snapshots')
        .upsert(snapshotRows, { onConflict: 'organization_id,snapshot_date' });
      if (error) throw error;
    }

    // Open new churn events for currently churned listings without an open event
    const { data: openEvents } = await supabase
      .from('listing_churn_events')
      .select('id, listing_id')
      .is('restored_at', null);
    const openByListing = new Map<string, string>();
    for (const e of openEvents ?? []) openByListing.set(e.listing_id, e.id);

    const toOpen = churnedListings
      .filter((c) => !openByListing.has(c.id))
      .map((c) => ({
        organization_id: c.org,
        listing_id: c.id,
        churned_at: c.lastActive ?? new Date().toISOString(),
      }));
    if (toOpen.length) {
      const { error } = await supabase.from('listing_churn_events').insert(toOpen);
      if (error) console.error('Failed to open churn events:', error);
    }

    // Close churn events for listings now restored (have open events but currently active)
    const restoredIds = new Set(restoredListings.map((r) => r.id));
    const toClose: string[] = [];
    for (const [listingId, eventId] of openByListing) {
      if (restoredIds.has(listingId)) toClose.push(eventId);
    }
    if (toClose.length) {
      const { error } = await supabase
        .from('listing_churn_events')
        .update({ restored_at: new Date().toISOString() })
        .in('id', toClose);
      if (error) console.error('Failed to close churn events:', error);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        snapshots: snapshotRows.length,
        opened: toOpen.length,
        closed: toClose.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

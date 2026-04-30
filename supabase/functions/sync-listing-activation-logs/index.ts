// Pulls activation/deactivation/list/unlist history from Guesty's /v1/property-logs/{id}
// and stores it in listing_activation_events. Also derives last_active_at on listings.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getToken(supabase: any, accountId: string): Promise<string | null> {
  const { data: tok } = await supabase
    .from('guesty_oauth_tokens')
    .select('access_token, expires_at')
    .eq('guesty_account_id', accountId)
    .maybeSingle();
  if (tok?.access_token && new Date(tok.expires_at).getTime() > Date.now() + 60_000) {
    return tok.access_token;
  }
  const { data: creds } = await supabase
    .from('guesty_account_credentials')
    .select('client_id, client_secret')
    .eq('guesty_account_id', accountId)
    .maybeSingle();
  if (!creds) return null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const r = await fetch('https://open-api.guesty.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'open-api',
        client_id: creds.client_id,
        client_secret: creds.client_secret,
      }),
    });
    if (r.status === 429) {
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 30000));
      continue;
    }
    if (!r.ok) return null;
    const j = await r.json();
    await supabase.from('guesty_oauth_tokens').upsert({
      guesty_account_id: accountId,
      access_token: j.access_token,
      expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
      refresh_in_progress: false,
    }, { onConflict: 'guesty_account_id' });
    return j.access_token;
  }
  return null;
}

async function fetchPropertyLogPage(token: string, listingId: string, skip: number): Promise<any | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const url = new URL(`https://open-api.guesty.com/v1/property-logs/${listingId}`);
    url.searchParams.set('limit', '20'); // Guesty caps at 20
    url.searchParams.set('skip', String(skip));
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (r.status === 429 || r.status === 500 || r.status === 502 || r.status === 503) {
      await sleep(Math.min(1500 * Math.pow(2, attempt - 1), 20000));
      continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) {
      console.error(`property-logs ${listingId} skip=${skip} failed: ${r.status} ${await r.text()}`);
      return null;
    }
    return await r.json();
  }
  return null;
}

async function fetchAllPropertyLogs(token: string, listingId: string, maxPages = 25): Promise<any[]> {
  const all: any[] = [];
  let skip = 0;
  let firstLogged = false;
  for (let page = 0; page < maxPages; page++) {
    const j = await fetchPropertyLogPage(token, listingId, skip);
    if (!j) break;
    const entries: any[] = j.results || j.logs || j.entries || j.data || (Array.isArray(j) ? j : []);
    if (!firstLogged) {
      console.log(`[debug ${listingId}] keys=${Object.keys(j).join(',')} entries=${entries.length} sample=${JSON.stringify(entries[0] ?? j)?.slice(0, 600)}`);
      firstLogged = true;
    }
    if (!entries.length) break;
    all.push(...entries);
    if (entries.length < 20) break;
    skip += 20;
    await sleep(120);
  }
  return all;
}

// Map a Guesty property-log entry to one of our event types.
// Guesty's log entries vary in shape; we look at common fields like `action`,
// `field`, `change.field`, plus old/new values.
function classifyEntry(entry: any): { type: string; occurredAt: string } | null {
  const occurredAt =
    entry.createdAt || entry.timestamp || entry.date || entry.updatedAt || null;
  if (!occurredAt) return null;

  const field = String(entry.field || entry.change?.field || entry.path || '').toLowerCase();
  const action = String(entry.action || entry.type || '').toLowerCase();
  const oldVal = entry.oldValue ?? entry.change?.oldValue ?? entry.before;
  const newVal = entry.newValue ?? entry.change?.newValue ?? entry.after;

  if (field.includes('active') || action.includes('activate') || action.includes('deactivate')) {
    if (newVal === true || action.includes('activate') && !action.includes('deactivate')) {
      return { type: 'activated', occurredAt };
    }
    if (newVal === false || action.includes('deactivate')) {
      return { type: 'deactivated', occurredAt };
    }
  }
  if (field.includes('listed') || field.includes('islisted') || action.includes('list')) {
    if (newVal === true || action === 'list' || action.includes('listed')) {
      return { type: 'listed', occurredAt };
    }
    if (newVal === false || action.includes('unlist')) {
      return { type: 'unlisted', occurredAt };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const onlyListingId: string | undefined = body.listing_id;
    const onlyAccountId: string | undefined = body.account_id;
    const limitListings: number = Number(body.limit ?? 50); // safety cap per invocation

    let listingsQ = supabase
      .from('listings')
      .select('id, guesty_account_id, organization_id:guesty_account_id')
      .order('updated_at', { ascending: false })
      .limit(limitListings);
    if (onlyListingId) listingsQ = listingsQ.eq('id', onlyListingId);
    if (onlyAccountId) listingsQ = listingsQ.eq('guesty_account_id', onlyAccountId);

    const { data: listings, error: lErr } = await listingsQ;
    if (lErr) throw lErr;

    // Build map of guesty_account_id -> organization_id and -> token
    const accountIds = Array.from(new Set((listings ?? []).map((l: any) => l.guesty_account_id)));
    const { data: accounts } = await supabase
      .from('guesty_accounts')
      .select('id, organization_id')
      .in('id', accountIds);
    const orgByAccount = new Map<string, string>(
      (accounts ?? []).map((a: any) => [a.id, a.organization_id]),
    );
    const tokenByAccount = new Map<string, string>();
    for (const aid of accountIds) {
      const t = await getToken(supabase, aid);
      if (t) tokenByAccount.set(aid, t);
    }

    let processed = 0;
    let inserted = 0;
    let lastActiveUpdated = 0;

    for (const l of listings ?? []) {
      const token = tokenByAccount.get(l.guesty_account_id);
      const orgId = orgByAccount.get(l.guesty_account_id);
      if (!token || !orgId) continue;

      const entries = await fetchAllPropertyLogs(token, l.id);
      processed++;
      if (!entries.length) {
        await sleep(120);
        continue;
      }

      const events = entries
        .map((e) => {
          const c = classifyEntry(e);
          if (!c) return null;
          return {
            listing_id: l.id,
            organization_id: orgId,
            event_type: c.type,
            occurred_at: c.occurredAt,
            actor_name: e.user?.fullName || e.user?.name || e.actor?.name || null,
            actor_id: e.user?._id || e.user?.id || e.actor?.id || null,
            source: 'guesty_property_log',
            raw: e,
          };
        })
        .filter(Boolean) as any[];

      if (events.length) {
        const { error: upErr } = await supabase
          .from('listing_activation_events')
          .upsert(events, { onConflict: 'listing_id,event_type,occurred_at', ignoreDuplicates: true });
        if (!upErr) inserted += events.length;

        // Derive last_active_at: most recent 'activated' or last 'deactivated'
        const sorted = events.slice().sort((a, b) => +new Date(b.occurred_at) - +new Date(a.occurred_at));
        const mostRecent = sorted[0];
        if (mostRecent) {
          const { error: updErr } = await supabase
            .from('listings')
            .update({ last_active_at: mostRecent.occurred_at })
            .eq('id', l.id);
          if (!updErr) lastActiveUpdated++;
        }
      }
      await sleep(200); // gentle pacing
    }

    return new Response(
      JSON.stringify({ ok: true, processed, inserted, lastActiveUpdated, totalListings: listings?.length ?? 0 }),
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

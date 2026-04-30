// One-time backfill: pulls lastActivityAt for every listing from Guesty and writes to listings.last_active_at
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getToken(supabase: any, accountId: string): Promise<string | null> {
  // Try cached token first
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

async function fetchPage(token: string, skip: number, limit: number) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const url = new URL('https://open-api.guesty.com/v1/listings');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('skip', String(skip));
    // Omit fields= so Guesty returns lastActivityAt (whitelisting drops it)
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (r.status === 429) {
      const wait = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      await sleep(wait);
      continue;
    }
    if (!r.ok) throw new Error(`Guesty ${r.status}: ${await r.text()}`);
    return r.json();
  }
  throw new Error('Max retries reached');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: accounts, error: aErr } = await supabase.from('guesty_accounts').select('id, account_name');
    if (aErr) throw aErr;

    const summary: any[] = [];
    for (const acc of accounts ?? []) {
      const token = await getToken(supabase, acc.id);
      if (!token) {
        summary.push({ account: acc.account_name, error: 'no token' });
        continue;
      }
      let skip = 0;
      const limit = 100;
      let total = 0;
      let updated = 0;
      while (true) {
        const data = await fetchPage(token, skip, limit);
        const listings = data.results || [];
        if (!listings.length) break;
        total += listings.length;
        const updates = listings
          .map((l: any) => ({
            id: l._id,
            last_active_at: l.lastActivityAt || l.deactivatedAt || l.activatedAt || null,
          }))
          .filter((u: any) => u.last_active_at);

        for (const u of updates) {
          const { error } = await supabase.from('listings').update({ last_active_at: u.last_active_at }).eq('id', u.id);
          if (!error) updated++;
        }
        if (listings.length < limit) break;
        skip += limit;
        await sleep(350);
      }
      summary.push({ account: acc.account_name, total, updated });
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

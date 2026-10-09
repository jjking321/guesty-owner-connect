import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { subDays, format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformIcon } from "@/components/icons/PlatformIcon";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/reports/format";
import { REVIEW_TOPICS, classifyReviewText } from "@/lib/reviewTopics";
import { Download, Loader2, Star } from "lucide-react";

interface Row {
  l: string; c: string;
  cb: number; cn: number; cr: number;
  pb: number; pn: number; pr: number;
  rv: number; ar: number | null; fs: number;
  low: { r: number; t: string }[];
}
interface Payload { listings: { id: string; name: string | null; city: string | null }[]; rows: Row[] }

const CHANNELS = ["Airbnb", "VRBO", "Booking.com", "Direct", "Other"];
const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const fmtPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const money = (v: number) =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const tone = (v: number | null) =>
  v === null ? "text-muted-foreground" : v < -2 ? "text-destructive" : v > 2 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground";

type Flag = "Discounting trap" | "Volume cliff" | "Volume loss" | "Rate-led growth" | "Healthy" | "Too little data";
const flagOf = (nightsPct: number | null, adrPct: number | null, pyNights: number): Flag => {
  if (pyNights < 20 || nightsPct === null || adrPct === null) return "Too little data";
  if (nightsPct >= -5 && adrPct <= -10) return "Discounting trap";
  if (nightsPct <= -10 && adrPct <= -5) return "Volume cliff";
  if (nightsPct <= -10) return "Volume loss";
  if (adrPct >= 5 && nightsPct >= -5) return "Rate-led growth";
  return "Healthy";
};
const flagVariant = (f: Flag): "destructive" | "secondary" | "outline" | "default" =>
  f === "Volume cliff" || f === "Discounting trap" ? "destructive" : f === "Volume loss" ? "secondary" : "outline";

export function ReviewRevenueImpact() {
  const [days, setDays] = useState("365");
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("all");
  const [minReviews, setMinReviews] = useState("0");
  const [flagFilter, setFlagFilter] = useState("all");

  const to = new Date();
  const from = subDays(to, Number(days) - 1);
  const fromStr = format(from, "yyyy-MM-dd");
  const toStr = format(to, "yyyy-MM-dd");

  const { data, isLoading, error } = useQuery({
    queryKey: ["review-commercial-impact", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_review_commercial_impact" as any, {
        p_start_date: fromStr, p_end_date: toStr,
      });
      if (error) throw error;
      return data as unknown as Payload;
    },
  });

  const model = useMemo(() => {
    if (!data) return null;
    const meta = new Map(data.listings.map((l) => [l.id, l]));
    const rows = data.rows.map((r) => ({ ...r, cr: Number(r.cr), pr: Number(r.pr), ar: r.ar === null ? null : Number(r.ar) }));

    // Channel totals
    const tot = { cn: 0, pn: 0 };
    rows.forEach((r) => { tot.cn += r.cn; tot.pn += r.pn; });
    const channels = CHANNELS.map((c) => {
      const rs = rows.filter((r) => r.c === c);
      const s = rs.reduce((a, r) => ({ cn: a.cn + r.cn, pn: a.pn + r.pn, cr: a.cr + r.cr, pr: a.pr + r.pr, rv: a.rv + r.rv, fs: a.fs + r.fs, rs: a.rs + (r.ar ?? 0) * r.rv }),
        { cn: 0, pn: 0, cr: 0, pr: 0, rv: 0, fs: 0, rs: 0 });
      const adr = s.cn ? s.cr / s.cn : 0, padr = s.pn ? s.pr / s.pn : 0;
      return {
        channel: c, ...s, adr, padr,
        nightsPct: pct(s.cn, s.pn), revPct: pct(s.cr, s.pr), adrPct: pct(adr, padr),
        share: tot.cn ? (s.cn / tot.cn) * 100 : 0, pshare: tot.pn ? (s.pn / tot.pn) * 100 : 0,
        avgRating: s.rv ? s.rs / s.rv : null, fivePct: s.rv ? (s.fs / s.rv) * 100 : null,
      };
    }).filter((c) => c.cn + c.pn + c.rv > 0);

    // Per listing
    const byListing = new Map<string, Row[]>();
    rows.forEach((r) => { if (!byListing.has(r.l)) byListing.set(r.l, []); byListing.get(r.l)!.push(r); });
    const listings = [...byListing.entries()].map(([id, rs]) => {
      const s = rs.reduce((a, r) => ({ cn: a.cn + r.cn, pn: a.pn + r.pn, cr: a.cr + r.cr, pr: a.pr + r.pr, rv: a.rv + r.rv }), { cn: 0, pn: 0, cr: 0, pr: 0, rv: 0 });
      const adr = s.cn ? s.cr / s.cn : 0, padr = s.pn ? s.pr / s.pn : 0;
      const nightsPct = pct(s.cn, s.pn), adrPct = pct(adr, padr);
      const lows = rs.flatMap((r) => r.low.map((x) => ({ ...x, c: r.c })));
      const topics = new Set<string>();
      lows.forEach((x) => classifyReviewText(x.t).forEach((h) => topics.add(h.topicKey)));
      const perChannel: Record<string, Row> = {};
      rs.forEach((r) => (perChannel[r.c] = r));
      const rated = rs.filter((r) => r.ar !== null && r.rv > 0);
      const worst = rated.sort((a, b) => (a.ar! - b.ar!))[0];
      return {
        id, name: meta.get(id)?.name || id, city: meta.get(id)?.city || "—", ...s, adr, padr,
        nightsPct, revPct: pct(s.cr, s.pr), adrPct, revDelta: s.cr - s.pr,
        lowCount: lows.length, topics, perChannel,
        worstChannel: worst?.c ?? null, worstRating: worst?.ar ?? null,
        flag: flagOf(nightsPct, adrPct, s.pn),
      };
    });

    // Channel substitution: listings rated under 4.8 on a channel
    const substitution = CHANNELS.filter((c) => c !== "Other").map((c) => {
      const hit = listings.filter((l) => { const r = l.perChannel[c]; return r && r.rv >= 2 && r.ar !== null && r.ar < 4.8 && l.pn >= 20; });
      let shifted = 0, lost = 0, stable = 0, chDelta = 0, otherDelta = 0;
      hit.forEach((l) => {
        const r = l.perChannel[c];
        const d = r.cn - r.pn; const od = (l.cn - l.pn) - d;
        chDelta += d; otherDelta += od;
        const chPct = pct(r.cn, r.pn) ?? 0, totPct = l.nightsPct ?? 0;
        if (chPct <= -10 && totPct > -5) shifted++;
        else if (chPct <= -10) lost++;
        else stable++;
      });
      return { channel: c, n: hit.length, shifted, lost, stable, chDelta, otherDelta };
    }).filter((s) => s.n > 0);

    // Topic dollar impact
    const eligible = listings.filter((l) => l.pr > 0);
    const topics = REVIEW_TOPICS.map((t) => {
      const yes = eligible.filter((l) => l.topics.has(t.key));
      const no = eligible.filter((l) => !l.topics.has(t.key));
      const agg = (ls: typeof eligible) => { const cr = ls.reduce((a, l) => a + l.cr, 0), pr = ls.reduce((a, l) => a + l.pr, 0); return { cr, pr, pct: pct(cr, pr) }; };
      const a = agg(yes), b = agg(no);
      const gap = a.pct !== null && b.pct !== null ? a.pct - b.pct : null;
      const atRisk = gap !== null ? (gap / 100) * a.pr : 0;
      return { key: t.key, label: t.label, n: yes.length, revDelta: a.cr - a.pr, flaggedPct: a.pct, otherPct: b.pct, gap, atRisk, avgPerListing: yes.length ? (a.cr - a.pr) / yes.length : 0 };
    }).filter((t) => t.n > 0).sort((x, y) => x.atRisk - y.atRisk);

    const flagCounts = listings.reduce((m, l) => { m[l.flag] = (m[l.flag] || 0) + 1; return m; }, {} as Record<string, number>);
    const cities = [...new Set(listings.map((l) => l.city).filter((c) => c !== "—"))].sort();
    return { channels, listings, substitution, topics, flagCounts, cities };
  }, [data]);

  const board = useMemo(() => {
    if (!model) return [];
    const q = search.toLowerCase();
    return model.listings
      .filter((l) => l.lowCount > 0 || l.flag === "Volume cliff" || l.flag === "Discounting trap")
      .filter((l) => !q || l.name.toLowerCase().includes(q))
      .filter((l) => city === "all" || l.city === city)
      .filter((l) => l.rv >= Number(minReviews))
      .filter((l) => flagFilter === "all" || l.flag === flagFilter)
      .sort((a, b) => a.revDelta - b.revDelta);
  }, [model, search, city, minReviews, flagFilter]);

  const exportCsv = () => {
    if (!model) return;
    const header = ["Property", "City", "Revenue (this period)", "Revenue (last year)", "Revenue change $", "Revenue YoY %", "Nights YoY %", "ADR YoY %", "Flag", "Reviews", "Below-5 reviews", "Lowest-rated channel", "Lowest channel rating", "Complaint topics",
      ...CHANNELS.flatMap((c) => [`${c} nights`, `${c} nights LY`, `${c} rating`])];
    const rows = model.listings.sort((a, b) => a.revDelta - b.revDelta).map((l) => [
      l.name, l.city, l.cr.toFixed(0), l.pr.toFixed(0), l.revDelta.toFixed(0), fmtPct(l.revPct), fmtPct(l.nightsPct), fmtPct(l.adrPct), l.flag, String(l.rv), String(l.lowCount),
      l.worstChannel ?? "", l.worstRating?.toFixed(2) ?? "", [...l.topics].join("; "),
      ...CHANNELS.flatMap((c) => { const r = l.perChannel[c]; return [String(r?.cn ?? 0), String(r?.pn ?? 0), r?.ar != null ? Number(r.ar).toFixed(2) : ""]; }),
    ]);
    downloadCsv(`review-revenue-impact-${fromStr}-to-${toStr}.csv`, [header, ...rows]);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 180 days</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground flex-1">
            Stays from {format(from, "MMM d, yyyy")} to {format(to, "MMM d, yyyy")} compared with the same dates last year. Owner stays excluded.
          </p>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!model}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
        </CardContent>
      </Card>

      {isLoading && <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Crunching reviews and bookings…</div>}
      {error && <p className="text-destructive text-sm">Couldn't load: {(error as Error).message}</p>}

      {model && (
        <Tabs defaultValue="channels" className="space-y-4">
          <TabsList>
            <TabsTrigger value="channels">Channel pace &amp; revenue</TabsTrigger>
            <TabsTrigger value="topics">Cost of complaints</TabsTrigger>
            <TabsTrigger value="properties">Properties at risk</TabsTrigger>
          </TabsList>

          {/* Channels */}
          <TabsContent value="channels" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {model.channels.map((c) => (
                <Card key={c.channel}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><PlatformIcon platform={c.channel} className="h-4 w-4" />{c.channel}</CardTitle>
                    <CardDescription className="flex items-center gap-1">
                      {c.avgRating !== null ? <><Star className="h-3 w-3 fill-current" />{c.avgRating.toFixed(2)} · {c.fivePct!.toFixed(0)}% 5-star · {c.rv} reviews</> : "No reviews in period"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Revenue</span><span>{money(c.cr)} <span className={tone(c.revPct)}>{fmtPct(c.revPct)}</span></span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Nights (pace)</span><span>{c.cn.toLocaleString()} <span className={tone(c.nightsPct)}>{fmtPct(c.nightsPct)}</span></span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">ADR</span><span>{money(c.adr)} <span className={tone(c.adrPct)}>{fmtPct(c.adrPct)}</span></span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Share of nights</span><span>{c.pshare.toFixed(1)}% → {c.share.toFixed(1)}%</span></div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Did the bookings vanish, or move?</CardTitle>
                <CardDescription>Properties averaging under 4.8 on a channel (2+ reviews). "Moved" = that channel fell 10%+ but the property's total nights held. "Lost" = the property lost nights overall.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Channel rated under 4.8</TableHead><TableHead className="text-right">Properties</TableHead>
                    <TableHead className="text-right">Moved to other channels</TableHead><TableHead className="text-right">Lost overall</TableHead><TableHead className="text-right">Held up</TableHead>
                    <TableHead className="text-right">Nights change on that channel</TableHead><TableHead className="text-right">Nights change elsewhere</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {model.substitution.map((s) => (
                      <TableRow key={s.channel}>
                        <TableCell className="font-medium">{s.channel}</TableCell>
                        <TableCell className="text-right">{s.n}</TableCell>
                        <TableCell className="text-right">{s.shifted}</TableCell>
                        <TableCell className="text-right text-destructive">{s.lost}</TableCell>
                        <TableCell className="text-right">{s.stable}</TableCell>
                        <TableCell className={`text-right ${tone(s.chDelta)}`}>{s.chDelta > 0 ? "+" : ""}{s.chDelta.toLocaleString()}</TableCell>
                        <TableCell className={`text-right ${tone(s.otherDelta)}`}>{s.otherDelta > 0 ? "+" : ""}{s.otherDelta.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    {model.substitution.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No properties under 4.8 in this period.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Holding occupancy by cutting rate?</CardTitle>
                <CardDescription>Each property's total nights vs average rate, compared with last year.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {([
                  ["Discounting trap", "Nights held, but rate down 10%+"],
                  ["Volume cliff", "Lost 10%+ nights and 5%+ rate"],
                  ["Volume loss", "Lost 10%+ nights, rate held"],
                  ["Rate-led growth", "Rate up 5%+, nights held"],
                  ["Healthy", "Everything else"],
                ] as [Flag, string][]).map(([f, d]) => (
                  <div key={f} className="rounded-lg border p-3">
                    <div className="text-2xl font-semibold">{model.flagCounts[f] || 0}</div>
                    <div className="text-sm font-medium">{f}</div>
                    <div className="text-xs text-muted-foreground">{d}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Topics */}
          <TabsContent value="topics">
            <Card>
              <CardHeader>
                <CardTitle>What each complaint costs</CardTitle>
                <CardDescription>
                  Properties with at least one below-5 review mentioning a topic, compared with properties that had none. "Revenue at risk" = how far those properties trailed the rest, applied to their last-year revenue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Complaint</TableHead><TableHead className="text-right">Properties</TableHead>
                    <TableHead className="text-right">Their revenue YoY</TableHead><TableHead className="text-right">Everyone else</TableHead>
                    <TableHead className="text-right">Gap</TableHead><TableHead className="text-right">Revenue at risk</TableHead><TableHead className="text-right">Avg change per property</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {model.topics.map((t) => (
                      <TableRow key={t.key}>
                        <TableCell className="font-medium">{t.label}</TableCell>
                        <TableCell className="text-right">{t.n}</TableCell>
                        <TableCell className={`text-right ${tone(t.flaggedPct)}`}>{fmtPct(t.flaggedPct)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtPct(t.otherPct)}</TableCell>
                        <TableCell className={`text-right ${tone(t.gap)}`}>{t.gap === null ? "—" : `${t.gap > 0 ? "+" : ""}${t.gap.toFixed(1)} pts`}</TableCell>
                        <TableCell className={`text-right font-medium ${tone(t.atRisk)}`}>{money(t.atRisk)}</TableCell>
                        <TableCell className={`text-right ${tone(t.avgPerListing)}`}>{money(t.avgPerListing)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-3">This shows association, not proof of cause — a property can have several complaints and other things going on.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Properties */}
          <TabsContent value="properties">
            <Card>
              <CardHeader>
                <CardTitle>Properties at risk</CardTitle>
                <CardDescription>Properties with below-5 reviews or a pace/rate warning, biggest revenue drop first.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Input placeholder="Search property…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
                  <Select value={city} onValueChange={setCity}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="City" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All cities</SelectItem>{model.cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={minReviews} onValueChange={setMinReviews}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any review count</SelectItem><SelectItem value="3">3+ reviews</SelectItem>
                      <SelectItem value="10">10+ reviews</SelectItem><SelectItem value="25">25+ reviews</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={flagFilter} onValueChange={setFlagFilter}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All warnings</SelectItem>
                      {["Discounting trap", "Volume cliff", "Volume loss", "Rate-led growth", "Healthy", "Too little data"].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground self-center">{board.length} properties</span>
                </div>
                <div className="max-h-[640px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10"><TableRow>
                      <TableHead>Property</TableHead><TableHead className="text-right">Revenue change</TableHead>
                      <TableHead className="text-right">Nights</TableHead><TableHead className="text-right">ADR</TableHead>
                      <TableHead>Warning</TableHead><TableHead>Lowest channel</TableHead><TableHead>Complaints</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {board.slice(0, 300).map((l) => (
                        <TableRow key={l.id}>
                          <TableCell><Link to={`/listings/${l.id}`} className="font-medium hover:underline">{l.name}</Link><div className="text-xs text-muted-foreground">{l.city} · {l.rv} reviews · {l.lowCount} below 5</div></TableCell>
                          <TableCell className={`text-right ${tone(l.revPct)}`}>{money(l.revDelta)}<div className="text-xs">{fmtPct(l.revPct)}</div></TableCell>
                          <TableCell className={`text-right ${tone(l.nightsPct)}`}>{fmtPct(l.nightsPct)}</TableCell>
                          <TableCell className={`text-right ${tone(l.adrPct)}`}>{fmtPct(l.adrPct)}</TableCell>
                          <TableCell><Badge variant={flagVariant(l.flag)}>{l.flag}</Badge></TableCell>
                          <TableCell className="text-sm">{l.worstChannel ? `${l.worstChannel} ${Number(l.worstRating).toFixed(2)}` : "—"}</TableCell>
                          <TableCell><div className="flex flex-wrap gap-1">{[...l.topics].slice(0, 4).map((t) => <Badge key={t} variant="outline" className="text-xs">{REVIEW_TOPICS.find((x) => x.key === t)?.label ?? t}</Badge>)}</div></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

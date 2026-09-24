import { useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/reports/format";

type Res = {
  id: string; listing_id: string; check_in: string; check_out: string; nights_count: number;
  fare_accommodation_adjusted: number | null; host_payout: number | null; sub_total: number | null;
  source: string | null; guest_name: string | null; created_at_guesty: string | null; status: string | null;
};

type NightStat = { weekday: number[]; weekend: number[] };
type Audit = {
  res: Res; grossAdr: number; netAdr: number; fee: number;
  weekdayVar: number | null; weekendVar: number | null; overallVar: number | null;
  benchmarkAdr: number | null; benchmarkSource: string; score: number | null;
  weekdayNights: number; weekendNights: number;
};

const CONFIRMED = ["confirmed", "checked_in", "checked_out"];
// Fri & Sat nights are weekend nights
const isWeekend = (d: Date) => d.getDay() === 5 || d.getDay() === 6;
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function scoreFor(v: number | null): number | null {
  if (v === null) return null;
  if (v >= 10) return 5;
  if (v >= 0) return 4;
  if (v >= -10) return 3;
  if (v >= -25) return 2;
  return 1;
}

const scoreClass: Record<number, string> = {
  5: "bg-primary text-primary-foreground",
  4: "bg-primary/70 text-primary-foreground",
  3: "bg-secondary text-secondary-foreground",
  2: "bg-destructive/60 text-destructive-foreground",
  1: "bg-destructive text-destructive-foreground",
};

async function fetchAllPaged<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined || !isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

export function RateAuditor() {
  const [period, setPeriod] = useState("1");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [listingNames, setListingNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const end = new Date();
      const start = subDays(new Date(format(end, "yyyy-MM-dd") + "T00:00:00"), Number(period));
      const reservations = await fetchAllPaged<Res>((f, t) =>
        supabase.from("reservations")
          .select("id, listing_id, check_in, check_out, nights_count, fare_accommodation_adjusted, host_payout, sub_total, source, guest_name, created_at_guesty, status")
          .gte("created_at_guesty", start.toISOString())
          .in("status", CONFIRMED)
          .neq("source", "owner")
          .gt("nights_count", 0)
          .order("created_at_guesty", { ascending: false })
          .range(f, t));

      const listingIds = [...new Set(reservations.map((r) => r.listing_id))];
      if (!listingIds.length) { setAudits([]); return; }

      const [{ data: listings }, { data: peers }] = await Promise.all([
        supabase.from("listings").select("id, nickname").in("id", listingIds),
        supabase.from("portfolio_comparables").select("listing_id, peer_listing_id").in("listing_id", listingIds),
      ]);
      setListingNames(Object.fromEntries((listings || []).map((l: any) => [l.id, l.nickname || l.id])));
      const peerMap = new Map<string, string[]>();
      (peers || []).forEach((p: any) => peerMap.set(p.listing_id, [...(peerMap.get(p.listing_id) || []), p.peer_listing_id]));

      // Prior-year window covering every stay (dates shifted 364 days keep weekday alignment)
      const minIn = reservations.reduce((m, r) => (r.check_in < m ? r.check_in : m), reservations[0].check_in);
      const maxOut = reservations.reduce((m, r) => (r.check_out > m ? r.check_out : m), reservations[0].check_out);
      const pyFrom = format(subDays(parseISO(minIn), 364 + 45), "yyyy-MM-dd");
      const pyTo = format(subDays(parseISO(maxOut), 364 - 45), "yyyy-MM-dd");
      const allIds = [...new Set([...listingIds, ...[...peerMap.values()].flat()])];

      const nights: { listing_id: string; night_date: string; revenue_allocation: number; reservation_id: string }[] = [];
      for (let i = 0; i < allIds.length; i += 50) {
        const chunk = allIds.slice(i, i + 50);
        nights.push(...await fetchAllPaged<any>((f, t) =>
          supabase.from("reservation_nights").select("listing_id, night_date, revenue_allocation, reservation_id")
            .in("listing_id", chunk).gte("night_date", pyFrom).lte("night_date", pyTo)
            .order("night_date").range(f, t)));
      }

      // Exclude prior-year owner stays
      const pyResIds = [...new Set(nights.map((n) => n.reservation_id))];
      const ownerIds = new Set<string>();
      for (let i = 0; i < pyResIds.length; i += 200) {
        const { data } = await supabase.from("reservations").select("id").in("id", pyResIds.slice(i, i + 200)).eq("source", "owner");
        (data || []).forEach((d: any) => ownerIds.add(d.id));
      }

      // Index: exact date and month+daytype per listing
      const exact = new Map<string, number>();
      const bucket = new Map<string, NightStat>();
      for (const n of nights) {
        if (ownerIds.has(n.reservation_id) || !(Number(n.revenue_allocation) > 0)) continue;
        const v = Number(n.revenue_allocation);
        exact.set(`${n.listing_id}|${n.night_date}`, v);
        const d = parseISO(n.night_date);
        const key = `${n.listing_id}|${format(d, "MM")}`;
        const b = bucket.get(key) || { weekday: [], weekend: [] };
        (isWeekend(d) ? b.weekend : b.weekday).push(v);
        bucket.set(key, b);
      }

      const benchFor = (listingId: string, night: Date): { v: number; src: string } | null => {
        const py = subDays(night, 364);
        const pyKey = format(py, "yyyy-MM-dd");
        const e = exact.get(`${listingId}|${pyKey}`);
        if (e) return { v: e, src: "Same night LY" };
        const wk = isWeekend(night);
        const own = bucket.get(`${listingId}|${format(py, "MM")}`);
        const ownAvg = own ? avg(wk ? own.weekend : own.weekday) : null;
        if (ownAvg) return { v: ownAvg, src: "Same month/day-type LY" };
        const vals = (peerMap.get(listingId) || []).flatMap((p) => {
          const b = bucket.get(`${p}|${format(py, "MM")}`);
          return b ? (wk ? b.weekend : b.weekday) : [];
        });
        const pAvg = avg(vals);
        if (pAvg) return { v: pAvg, src: "Portfolio peers LY" };
        return null;
      };

      const result: Audit[] = reservations.map((r) => {
        const fare = Number(r.fare_accommodation_adjusted || 0);
        const grossAdr = fare / r.nights_count;
        // Channel fee estimate: share of subtotal not paid out to host, applied to the fare
        const sub = Number(r.sub_total || 0), payout = Number(r.host_payout || 0);
        const netRatio = sub > 0 && payout > 0 && payout <= sub ? payout / sub : 1;
        const netAdr = grossAdr * netRatio;
        const fee = fare - fare * netRatio;

        const wkd: number[] = [], wke: number[] = [];
        const bWkd: number[] = [], bWke: number[] = [];
        const srcs = new Set<string>();
        let wkdN = 0, wkeN = 0;
        for (let i = 0; i < r.nights_count; i++) {
          const night = addDays(parseISO(r.check_in), i);
          const wk = isWeekend(night);
          wk ? wkeN++ : wkdN++;
          const b = benchFor(r.listing_id, night);
          if (!b) continue;
          srcs.add(b.src);
          if (wk) { wke.push(grossAdr); bWke.push(b.v); } else { wkd.push(grossAdr); bWkd.push(b.v); }
        }
        const v = (a: number[], b: number[]) => {
          const sa = a.reduce((s, x) => s + x, 0), sb = b.reduce((s, x) => s + x, 0);
          return sb > 0 ? ((sa - sb) / sb) * 100 : null;
        };
        const benchAll = [...bWkd, ...bWke];
        const benchmarkAdr = avg(benchAll);
        const overallVar = v([...wkd, ...wke], benchAll);
        return {
          res: r, grossAdr, netAdr, fee,
          weekdayVar: v(wkd, bWkd), weekendVar: v(wke, bWke), overallVar,
          benchmarkAdr, benchmarkSource: [...srcs].join(", ") || "No benchmark",
          score: scoreFor(overallVar), weekdayNights: wkdN, weekendNights: wkeN,
        };
      });
      setAudits(result);
    } catch (e: any) {
      setError(e?.message || "Could not load bookings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period]);

  const channels = useMemo(() => [...new Set(audits.map((a) => a.res.source || "unknown"))].sort(), [audits]);
  const filtered = audits.filter((a) =>
    (scoreFilter === "all" || (scoreFilter === "flagged" ? (a.score ?? 5) <= 2 : String(a.score) === scoreFilter)) &&
    (channelFilter === "all" || (a.res.source || "unknown") === channelFilter));

  const totalNights = filtered.reduce((s, a) => s + a.res.nights_count, 0);
  const avgNet = totalNights ? filtered.reduce((s, a) => s + a.netAdr * a.res.nights_count, 0) / totalNights : null;
  const scored = filtered.filter((a) => a.overallVar !== null);
  const avgVar = avg(scored.map((a) => a.overallVar!));
  const flagged = filtered.filter((a) => (a.score ?? 5) <= 2).length;

  const exportCsv = () => {
    downloadCsv(`rate-audit-${format(new Date(), "yyyy-MM-dd")}.csv`, [
      ["Property", "Guest", "Channel", "Booked", "Check-in", "Check-out", "Nights", "Weekday nights", "Weekend nights", "Gross ADR", "Est. channel fee", "Net ADR", "Benchmark ADR", "Weekday var %", "Weekend var %", "Overall var %", "Score", "Benchmark source"],
      ...filtered.map((a) => [
        listingNames[a.res.listing_id] || a.res.listing_id, a.res.guest_name || "", a.res.source || "",
        a.res.created_at_guesty ? format(new Date(a.res.created_at_guesty), "yyyy-MM-dd") : "",
        a.res.check_in, a.res.check_out, String(a.res.nights_count), String(a.weekdayNights), String(a.weekendNights),
        a.grossAdr.toFixed(2), a.fee.toFixed(2), a.netAdr.toFixed(2), a.benchmarkAdr?.toFixed(2) ?? "",
        a.weekdayVar?.toFixed(1) ?? "", a.weekendVar?.toFixed(1) ?? "", a.overallVar?.toFixed(1) ?? "",
        a.score ? String(a.score) : "", a.benchmarkSource,
      ]),
    ]);
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Booked yesterday+</SelectItem>
              <SelectItem value="7">Booked last 7 days</SelectItem>
              <SelectItem value="30">Booked last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Select value={scoreFilter} onValueChange={setScoreFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scores</SelectItem>
              <SelectItem value="flagged">Flagged (1–2)</SelectItem>
              {[5, 4, 3, 2, 1].map((s) => <SelectItem key={s} value={String(s)}>Score {s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" />Export CSV
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {[
            ["Bookings picked up", String(filtered.length), `${totalNights} nights`],
            ["Avg net ADR", fmt(avgNet), "After estimated channel fees"],
            ["Rate vs benchmark", pct(avgVar), `${scored.length} bookings with a benchmark`],
            ["Flagged bookings", String(flagged), "Score 1–2 (more than 10% below)"],
          ].map(([t, v, d]) => (
            <Card key={t}><CardHeader className="pb-2"><CardDescription>{t}</CardDescription><CardTitle className="text-2xl">{v}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{d}</CardContent></Card>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !filtered.length ? (
              <p className="p-10 text-center text-sm text-muted-foreground">No bookings picked up in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead><TableHead>Guest / channel</TableHead><TableHead>Stay</TableHead>
                    <TableHead className="text-right">Gross ADR</TableHead><TableHead className="text-right">Net ADR</TableHead>
                    <TableHead className="text-right">Benchmark</TableHead><TableHead className="text-right">Weekday</TableHead>
                    <TableHead className="text-right">Weekend</TableHead><TableHead className="text-right">Overall</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => (
                    <TableRow key={a.res.id}>
                      <TableCell className="font-medium">{listingNames[a.res.listing_id] || a.res.listing_id}</TableCell>
                      <TableCell><div>{a.res.guest_name || "—"}</div><div className="text-xs text-muted-foreground">{a.res.source}</div></TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(parseISO(a.res.check_in), "MMM d")} – {format(parseISO(a.res.check_out), "MMM d, yyyy")}
                        <div className="text-xs text-muted-foreground">{a.res.nights_count} nts · {a.weekdayNights} wkday / {a.weekendNights} wkend</div>
                      </TableCell>
                      <TableCell className="text-right">{fmt(a.grossAdr)}</TableCell>
                      <TableCell className="text-right">
                        <Tooltip><TooltipTrigger className="underline decoration-dotted">{fmt(a.netAdr)}</TooltipTrigger>
                          <TooltipContent>Gross {fmt(a.grossAdr)}/nt − {fmt(a.fee / a.res.nights_count)} est. channel fee = {fmt(a.netAdr)} net</TooltipContent></Tooltip>
                      </TableCell>
                      <TableCell className="text-right">
                        <Tooltip><TooltipTrigger>{fmt(a.benchmarkAdr)}</TooltipTrigger><TooltipContent>{a.benchmarkSource}</TooltipContent></Tooltip>
                      </TableCell>
                      {[a.weekdayVar, a.weekendVar, a.overallVar].map((v, i) => (
                        <TableCell key={i} className={cn("text-right", v !== null && v < -10 && "text-destructive", v !== null && v >= 0 && "text-primary", i === 2 && "font-semibold")}>{pct(v)}</TableCell>
                      ))}
                      <TableCell className="text-center">
                        {a.score ? <Badge className={scoreClass[a.score]}>{a.score}</Badge> : <span className="text-xs text-muted-foreground">n/a</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Each night is compared to the same weekday last year (364 days back), falling back to last year's same-month weekday/weekend average, then to your Portfolio Peers. Weekend = Fri & Sat nights. Score: 5 = 10%+ above, 4 = at/above, 3 = up to 10% below, 2 = 10–25% below, 1 = more than 25% below. Rates compare gross accommodation fare; net ADR subtracts the estimated channel fee.
        </p>
      </div>
    </TooltipProvider>
  );
}

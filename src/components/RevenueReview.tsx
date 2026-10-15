import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface Props {
  reservations: any[];
  listingIds: string[];
  listings: any[];
}

const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const minusYear = (d: Date) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number | null) => (n === null || !isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const variance = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

type Stats = { revenue: number; nights: number };
type Window = { start: Date; end: Date; asOf: Date }; // end exclusive

function revOf(r: any) {
  const v = Number(r.sub_total) || Number(r.fare_accommodation_adjusted) || 0;
  return v;
}

export function RevenueReview({ reservations, listingIds, listings }: Props) {
  const navigate = useNavigate();
  const [benchmark, setBenchmark] = useState<"ly" | "target">("ly");

  const today = useMemo(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }, []);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / DAY);
  const daysElapsed = Math.max(1, Math.round((today.getTime() - monthStart.getTime()) / DAY));
  const idSet = useMemo(() => new Set(listingIds), [listingIds]);

  // Blocked nights (excluded from availability)
  const { data: blocked = [] } = useQuery({
    queryKey: ["rr-blocked", listingIds.length, iso(today)],
    enabled: listingIds.length > 0,
    queryFn: async () => {
      const out: { listing_id: string; date: string }[] = [];
      const ids = [...listingIds];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        let from = 0;
        while (true) {
          const { data, error } = await supabase.from("capacity_calendar")
            .select("listing_id,date")
            .in("listing_id", chunk).eq("block_reason", "blocked").eq("status", "unavailable")
            .gte("date", iso(minusYear(monthStart))).lt("date", iso(addDays(today, 90)))
            .range(from, from + 999);
          if (error) throw error;
          out.push(...(data || []));
          if (!data || data.length < 1000) break;
          from += 1000;
        }
      }
      return out;
    },
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["rr-goals", today.getFullYear(), today.getMonth()],
    queryFn: async () => {
      const out: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.from("property_goals")
          .select("listing_id,goal_revenue,projection_revenue")
          .eq("year", today.getFullYear()).eq("month", today.getMonth() + 1)
          .range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      return out;
    },
  });

  const blockedByListing = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const b of blocked) {
      if (!idSet.has(b.listing_id)) continue;
      if (!m.has(b.listing_id)) m.set(b.listing_id, new Set());
      m.get(b.listing_id)!.add(String(b.date).slice(0, 10));
    }
    return m;
  }, [blocked, idSet]);

  const res = useMemo(() => reservations.filter((r) =>
    r.listing_id && idSet.has(r.listing_id) && r.check_in && r.check_out && r.source !== "owner" &&
    ["confirmed", "checked_in", "checked_out"].includes(r.status)
  ), [reservations, idSet]);

  // Per listing stats for a window
  const statsFor = (w: Window, useAsOf: boolean) => {
    const per = new Map<string, Stats>();
    for (const r of res) {
      if (useAsOf) {
        if (!r.created_at_guesty) continue;
        if (new Date(r.created_at_guesty) > addDays(w.asOf, 1)) continue;
      }
      const ci = parse(r.check_in), co = parse(r.check_out);
      const nights = Math.round((co.getTime() - ci.getTime()) / DAY);
      if (nights <= 0) continue;
      const s = Math.max(ci.getTime(), w.start.getTime());
      const e = Math.min(co.getTime(), w.end.getTime());
      if (e <= s) continue;
      const n = Math.round((e - s) / DAY);
      const cur = per.get(r.listing_id) || { revenue: 0, nights: 0 };
      cur.revenue += (revOf(r) / nights) * n;
      cur.nights += n;
      per.set(r.listing_id, cur);
    }
    return per;
  };

  const availFor = (w: Window, ids: string[]) => {
    let total = 0;
    const days = Math.round((w.end.getTime() - w.start.getTime()) / DAY);
    for (const id of ids) {
      const set = blockedByListing.get(id);
      let b = 0;
      if (set) for (let i = 0; i < days; i++) if (set.has(iso(addDays(w.start, i)))) b++;
      total += Math.max(0, days - b);
    }
    return total;
  };

  const sum = (m: Map<string, Stats>) => {
    let revenue = 0, nights = 0;
    m.forEach((v) => { revenue += v.revenue; nights += v.nights; });
    return { revenue, nights };
  };

  const data = useMemo(() => {
    const mtd: Window = { start: monthStart, end: today, asOf: today };
    const mtdLY: Window = { start: minusYear(monthStart), end: minusYear(today), asOf: minusYear(today) };
    const fullM: Window = { start: monthStart, end: monthEnd, asOf: today };
    const fullMLY: Window = { start: minusYear(monthStart), end: minusYear(monthEnd), asOf: minusYear(today) };

    const curMtd = statsFor(mtd, false);
    const lyMtd = statsFor(mtdLY, false);
    const curFull = statsFor(fullM, false);
    const lyFullPace = statsFor(fullMLY, true);

    const c = sum(curMtd), l = sum(lyMtd);
    const availC = availFor(mtd, listingIds), availL = availFor(mtdLY, listingIds);
    const cf = sum(curFull), lf = sum(lyFullPace);

    const goalTotal = goals.filter((g) => idSet.has(g.listing_id))
      .reduce((s, g) => s + (Number(g.goal_revenue) || Number(g.projection_revenue) || 0), 0);
    const goalMtd = goalTotal * (daysElapsed / daysInMonth);

    const otb = [30, 60, 90].map((n) => {
      const w: Window = { start: today, end: addDays(today, n), asOf: today };
      const wl: Window = { start: minusYear(today), end: addDays(minusYear(today), n), asOf: minusYear(today) };
      const cs = sum(statsFor(w, false)), ls = sum(statsFor(wl, true));
      const av = availFor(w, listingIds);
      return { n, cur: cs.revenue, ly: ls.revenue, occ: av ? (cs.nights / av) * 100 : 0, lyNights: ls.nights, nights: cs.nights };
    });

    // Per-listing month pace (full month OTB vs LY pace)
    const name = new Map(listings.map((x: any) => [String(x.id), x.nickname || x.id]));
    const listingById = new Map(listings.map((x: any) => [String(x.id), x]));
    const goalById = new Map(goals.map((g: any) => [g.listing_id, g]));
    const perListing = listingIds.map((id) => ({ id, cur: curFull.get(id) || { revenue: 0, nights: 0 } }));
    const lyFullActual = statsFor(fullMLY, false);
    const daysM = daysInMonth;
    const mS = iso(monthStart), mE = iso(monthEnd);
    const homes = perListing.map((p) => {
      const ly = lyFullPace.get(p.id) || lyFullActual.get(p.id) || { revenue: 0, nights: 0 };
      let blockedM = 0;
      const bs = blockedByListing.get(p.id);
      if (bs) bs.forEach((d) => { if (d >= mS && d < mE) blockedM++; });
      const availNow = Math.max(1, daysM - blockedM);
      const revpar = p.cur.revenue / availNow;
      const lyRevpar = ly.revenue / daysM;
      const adr = p.cur.nights ? p.cur.revenue / p.cur.nights : 0;
      const lyAdr = ly.nights ? ly.revenue / ly.nights : 0;
      const occ = (p.cur.nights / availNow) * 100;
      const lyOcc = (ly.nights / daysM) * 100;
      const g = goalById.get(p.id);
      const goal = g ? Number(g.goal_revenue) || Number(g.projection_revenue) || 0 : 0;
      return {
        id: p.id, name: String(name.get(p.id) || p.id), revenue: p.cur.revenue, ly: ly.revenue, goal,
        revpar, lyRevpar, adr, lyAdr, occ, lyOcc,
        gap: p.cur.revenue - (benchmark === "target" && goal ? goal : ly.revenue),
        varPct: variance(p.cur.revenue, benchmark === "target" && goal ? goal : ly.revenue),
        hasBench: benchmark === "target" ? goal > 0 : ly.revenue > 0,
      };
    });
    const bottom = homes.filter((h) => h.hasBench).sort((a, b) => a.gap - b.gap).slice(0, 10);

    // Owner-impacting issues
    const next30: Window = { start: today, end: addDays(today, 30), asOf: today };
    const n30 = statsFor(next30, false);
    const issues: { id: string; name: string; issue: string; fix: string; severity: "high" | "medium" }[] = [];
    for (const h of homes) {
      const l = listings.find((x: any) => String(x.id) === h.id);
      if (h.hasBench && h.varPct !== null && h.varPct < -25)
        issues.push({ id: h.id, name: h.name, severity: "high", issue: `Month revenue ${pct(h.varPct)} vs ${benchmark === "ly" ? "LY" : "target"}`, fix: h.occ < h.lyOcc ? "Lower near-term rates / relax min-stay to recover occupancy" : "Occupancy is fine — review rate strategy (ADR down)" });
      const r = Number(l?.live_airbnb_rating);
      if (r && r < 4.8)
        issues.push({ id: h.id, name: h.name, severity: r < 4.7 ? "high" : "medium", issue: `Airbnb rating ${r.toFixed(2)}`, fix: "Review recent feedback, fix root cause, dispute eligible reviews" });
      const set = blockedByListing.get(h.id);
      let b30 = 0;
      if (set) for (let i = 0; i < 30; i++) if (set.has(iso(addDays(today, i)))) b30++;
      if (b30 >= 10)
        issues.push({ id: h.id, name: h.name, severity: "medium", issue: `${b30} of next 30 nights blocked`, fix: "Confirm blocks with owner / maintenance; reopen if not needed" });
      if (!n30.get(h.id) && b30 < 25)
        issues.push({ id: h.id, name: h.name, severity: "high", issue: "No bookings in next 30 days", fix: "Check listing visibility and pricing; run last-minute discount" });
    }
    const grouped = new Map<string, { id: string; name: string; severity: "high" | "medium"; items: { issue: string; fix: string; severity: "high" | "medium" }[] }>();
    for (const i of issues) {
      const g = grouped.get(i.id) ?? { id: i.id, name: i.name, severity: "medium" as const, items: [] };
      g.items.push({ issue: i.issue, fix: i.fix, severity: i.severity });
      if (i.severity === "high") g.severity = "high";
      grouped.set(i.id, g);
    }
    const groupedIssues = [...grouped.values()].sort((a, b) =>
      a.severity !== b.severity ? (a.severity === "high" ? -1 : 1) : b.items.length - a.items.length);

    return {
      mtd: { rev: c.revenue, lyRev: l.revenue, goalMtd, occ: availC ? (c.nights / availC) * 100 : 0, lyOcc: availL ? (l.nights / availL) * 100 : 0,
        adr: c.nights ? c.revenue / c.nights : 0, lyAdr: l.nights ? l.revenue / l.nights : 0,
        revpar: availC ? c.revenue / availC : 0, lyRevpar: availL ? l.revenue / availL : 0,
        goalRevpar: availC ? goalMtd / availC : 0 },
      pace: { cur: cf.revenue, ly: lf.revenue, goal: goalTotal },
      otb, bottom, issues: groupedIssues, issueCount: issues.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, listingIds, blockedByListing, goals, benchmark, listings]);

  const useTarget = benchmark === "target";
  const m = data.mtd;
  const paceBench = useTarget ? data.pace.goal : data.pace.ly;
  const paceVar = variance(data.pace.cur, paceBench);

  const rows: { metric: string; actual: string; bench: string; pace: string; behind: boolean; fix: string }[] = [
    {
      metric: "Gross booking revenue (MTD)", actual: money(m.rev),
      bench: useTarget ? (m.goalMtd ? money(m.goalMtd) : "No goals") : money(m.lyRev),
      pace: `${pct(variance(m.rev, useTarget ? m.goalMtd : m.lyRev))} MTD · ${pct(paceVar)} month OTB`,
      behind: (variance(m.rev, useTarget ? m.goalMtd : m.lyRev) ?? 0) < 0,
      fix: "Push rest-of-month: discount open nights in next 14 days, relax min-stay, fill gaps",
    },
    {
      metric: "Occupancy", actual: `${m.occ.toFixed(1)}%`, bench: useTarget ? "—" : `${m.lyOcc.toFixed(1)}%`,
      pace: useTarget ? "—" : `${m.occ - m.lyOcc >= 0 ? "+" : ""}${(m.occ - m.lyOcc).toFixed(1)} pts`,
      behind: !useTarget && m.occ < m.lyOcc,
      fix: "Lower close-in rates, open orphan nights (1–2 night gaps), shorten min-stay",
    },
    {
      metric: "ADR", actual: money(m.adr), bench: useTarget ? "—" : money(m.lyAdr),
      pace: useTarget ? "—" : pct(variance(m.adr, m.lyAdr)), behind: !useTarget && m.adr < m.lyAdr,
      fix: "If occupancy is ahead, raise rates on high-demand dates; check Rate Auditor for leaks",
    },
    {
      metric: "RevPAR", actual: money(m.revpar), bench: useTarget ? (m.goalRevpar ? money(m.goalRevpar) : "No goals") : money(m.lyRevpar),
      pace: pct(variance(m.revpar, useTarget ? m.goalRevpar : m.lyRevpar)),
      behind: (variance(m.revpar, useTarget ? m.goalRevpar : m.lyRevpar) ?? 0) < 0,
      fix: "Balance ADR vs occupancy — whichever is behind LY is the lever to pull",
    },
    ...data.otb.map((o) => ({
      metric: `On the books: next ${o.n} days`, actual: `${money(o.cur)} · ${o.occ.toFixed(0)}% occ`,
      bench: `${money(o.ly)} (LY same point)`, pace: pct(variance(o.cur, o.ly)),
      behind: o.cur < o.ly,
      fix: o.n === 30 ? "Last-minute: targeted discounts & gap fills" : o.n === 60 ? "Check pricing vs compset; adjust 31–60 day rates" : "Hold rates if pace OK; open early-bird promos if behind",
    })),
  ];

  const exportCsv = () => {
    const lines = [["Metric", "Actual", "Benchmark", "Pace", "Fix if behind"],
      ...rows.map((r) => [r.metric, r.actual, r.bench, r.pace, r.behind ? r.fix : ""]),
      [], ["Bottom 10 homes", "Month OTB", "Benchmark", "Variance", "Driver"],
      ...data.bottom.map((h) => [h.name, money(h.revenue), money(useTarget ? h.goal : h.ly), pct(h.varPct), h.occ < h.lyOcc ? "Occupancy" : "ADR"]),
      [], ["Owner-impacting issues", "Issue", "Fix"],
      ...data.issues.map((i) => [i.name, i.items.map((x) => x.issue).join("; "), i.items.map((x) => x.fix).join("; ")])];
    const csv = lines.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `revenue-review-${iso(today)}.csv`;
    a.click();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Revenue Review</CardTitle>
          <CardDescription>
            {today.toLocaleString("default", { month: "long", year: "numeric" })} · {listingIds.length} properties · MTD through yesterday, OTB as of today vs same point last year
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" size="sm" value={benchmark} onValueChange={(v) => v && setBenchmark(v as any)}>
            <ToggleGroupItem value="ly">vs LY</ToggleGroupItem>
            <ToggleGroupItem value="target">vs Target</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Metric</TableHead>
              <TableHead>Actual</TableHead>
              <TableHead>{useTarget ? "Target" : "LY"}</TableHead>
              <TableHead>Pace</TableHead>
              <TableHead>Fix if behind</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.metric}>
                <TableCell className="font-medium">{r.metric}</TableCell>
                <TableCell>{r.actual}</TableCell>
                <TableCell className="text-muted-foreground">{r.bench}</TableCell>
                <TableCell className={r.behind ? "text-destructive font-medium" : "text-primary font-medium"}>{r.pace}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.behind ? r.fix : "On pace"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div>
          <h3 className="font-semibold mb-2">Bottom 10 homes <span className="text-xs font-normal text-muted-foreground">(this month OTB vs {useTarget ? "target" : "LY same point"})</span></h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead><TableHead>Month OTB</TableHead><TableHead>{useTarget ? "Target" : "LY"}</TableHead>
                <TableHead>Variance</TableHead><TableHead>Occ (vs LY)</TableHead><TableHead>ADR (vs LY)</TableHead><TableHead>Fix</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.bottom.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No properties with a benchmark</TableCell></TableRow>}
              {data.bottom.map((h) => (
                <TableRow key={h.id} className="cursor-pointer" onClick={() => navigate(`/listings/${h.id}`)}>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>{money(h.revenue)}</TableCell>
                  <TableCell className="text-muted-foreground">{money(useTarget ? h.goal : h.ly)}</TableCell>
                  <TableCell className="text-destructive font-medium">{pct(h.varPct)}</TableCell>
                  <TableCell>{h.occ.toFixed(0)}% <span className="text-muted-foreground">({h.lyOcc.toFixed(0)}%)</span></TableCell>
                  <TableCell>{money(h.adr)} <span className="text-muted-foreground">({money(h.lyAdr)})</span></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{h.occ < h.lyOcc ? "Occupancy gap — lower rates / fill gaps" : "Rate gap — review pricing vs compset"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Owner-impacting issues <Badge variant="secondary" className="ml-1">{data.issues.length} properties · {data.issueCount} issues</Badge></h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Property</TableHead><TableHead>Severity</TableHead><TableHead>Issues</TableHead><TableHead>Fix</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.issues.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No issues detected</TableCell></TableRow>}
              {data.issues.slice(0, 25).map((i) => (
                <TableRow key={i.id} className="cursor-pointer align-top" onClick={() => navigate(`/listings/${i.id}`)}>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell><Badge variant={i.severity === "high" ? "destructive" : "secondary"}>{i.severity}</Badge></TableCell>
                  <TableCell><ul className="list-disc pl-4 space-y-1">{i.items.map((x, k) => <li key={k}>{x.issue}</li>)}</ul></TableCell>
                  <TableCell className="text-sm text-muted-foreground"><ul className="list-disc pl-4 space-y-1">{i.items.map((x, k) => <li key={k}>{x.fix}</li>)}</ul></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.issues.length > 25 && <p className="text-xs text-muted-foreground mt-2">Showing 25 of {data.issues.length} — export CSV for all.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

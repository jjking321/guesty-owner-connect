import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, endOfMonth, format, getDaysInMonth, parseISO, subDays, subYears } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw, Download } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  leadDays: number | null; windowBucket: string; typicalLead: number | null; leadVar: number | null;
  futureVar: number | null; recentLowCount: number; diagnosis: Diagnosis;
  stayMonth: string; revpar: number | null; benchRevpar: number | null; revparVar: number | null;
  occ: number | null; benchOcc: number | null; revparSource: string;
  losTier: string; losAllowance: number; netCredit: number; adjVar: number | null; relLead: number | null;
  holiday: string | null; holidayNights: number;
  calAdr: number | null; calVar: number | null; calBenchVar: number | null; origin: Origin | null;
};

// ---- Holiday calendar (US). Floating holidays are matched holiday-to-holiday year over year ----
type HolidayWin = { key: string; name: string; start: Date; nights: number };
const nthDow = (y: number, m: number, dow: number, n: number) => {
  const first = new Date(y, m, 1);
  return new Date(y, m, 1 + ((dow - first.getDay() + 7) % 7) + (n - 1) * 7);
};
const lastDow = (y: number, m: number, dow: number) => {
  const last = new Date(y, m + 1, 0);
  return new Date(y, m, last.getDate() - ((last.getDay() - dow + 7) % 7));
};
const holidayCache = new Map<number, HolidayWin[]>();
function holidayWindows(y: number): HolidayWin[] {
  const c = holidayCache.get(y); if (c) return c;
  const monWeekend = (key: string, name: string, mon: Date) => ({ key, name, start: addDays(mon, -3), nights: 3 }); // Fri, Sat, Sun nights
  const tg = nthDow(y, 10, 4, 4);
  const w: HolidayWin[] = [
    monWeekend("mlk", "MLK weekend", nthDow(y, 0, 1, 3)),
    monWeekend("presidents", "Presidents' Day weekend", nthDow(y, 1, 1, 3)),
    monWeekend("memorial", "Memorial Day weekend", lastDow(y, 4, 1)),
    { key: "july4", name: "July 4th", start: new Date(y, 6, 2), nights: 4 },
    monWeekend("labor", "Labor Day weekend", nthDow(y, 8, 1, 1)),
    { key: "thanksgiving", name: "Thanksgiving", start: addDays(tg, -1), nights: 4 },
    { key: "xmas_ny", name: "Christmas / New Year's", start: new Date(y, 11, 22), nights: 10 },
  ];
  holidayCache.set(y, w); return w;
}
const dayDiff = (a: Date, b: Date) => Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 86400000);
function holidayOf(d: Date): { win: HolidayWin; offset: number } | null {
  for (const win of holidayWindows(d.getFullYear())) {
    const off = dayDiff(d, win.start);
    if (off >= 0 && off < win.nights) return { win, offset: off };
  }
  return null;
}

// Where a discount came from: the calendar was set low, or the booking landed below the calendar rate
type Origin = "calendar" | "promo" | "mixed" | "aligned";
const ORIGIN: Record<Origin, { label: string; tip: string }> = {
  calendar: { label: "Calendar priced low", tip: "Booked at roughly the calendar rate, but the calendar rate itself is below benchmark. Fix the base/min price or pricing-tool settings." },
  promo: { label: "Discount below calendar", tip: "Calendar rate looked fine, but the booking came in 10%+ under it beyond the expected stay-length discount. Check OTA promotions, non-refundable / stacked discounts or manual overrides." },
  mixed: { label: "Calendar + discount", tip: "Calendar rate was low AND the booking came in further below it. Both pricing and discount rules need review." },
  aligned: { label: "Matches calendar", tip: "Booked rate is in line with the calendar and the calendar is near benchmark." },
};

const WINDOWS: [string, number, number][] = [
  ["Last-minute", 0, 7], ["Near-term", 8, 30], ["Standard", 31, 60], ["Advance", 61, 120], ["Far advance", 121, 99999],
];
const bucketOf = (d: number | null) => (d === null ? "Unknown" : (WINDOWS.find(([, a, b]) => d >= a && d <= b)?.[0] ?? "Unknown"));
const leadOf = (booked: string | null, checkIn: string) =>
  booked ? Math.max(0, Math.round((parseISO(checkIn).getTime() - new Date(booked).getTime()) / 86400000)) : null;

type Diagnosis = "distress" | "leak" | "drag" | "systemic" | "yield" | "tactical" | "isolated" | "on_target" | "unknown";
const DIAG: Record<Diagnosis, { label: string; cls: string; tip: string }> = {
  distress: { label: "Distress selling", cls: "bg-destructive text-destructive-foreground", tip: "Rate over 20% below benchmark AND stay-month RevPAR more than 20% behind. Discounting isn't driving enough volume — review the whole month's strategy." },
  leak: { label: "True pricing leak", cls: "bg-destructive/80 text-destructive-foreground", tip: "Rate over 10% below benchmark while stay-month RevPAR is behind (over 5%). The discount isn't paying for itself in occupancy." },
  drag: { label: "Overpriced / pacing drag", cls: "bg-accent text-accent-foreground", tip: "Booked at a premium, but the stay month's RevPAR is more than 15% behind. High rates may be costing occupancy on other nights." },
  systemic: { label: "Recurring discount", cls: "bg-destructive/60 text-destructive-foreground", tip: "Repeated low pickups or upcoming open dates priced well below benchmark, with no clear RevPAR signal. Review base/min price." },
  yield: { label: "Yield strategy", cls: "bg-primary text-primary-foreground", tip: "Rate below benchmark, but stay-month RevPAR is ahead (5%+). Trading rate for occupancy is working." },
  tactical: { label: "Last-minute fill", cls: "bg-secondary text-secondary-foreground", tip: "Discount booked within 7 days of arrival — expected liquidation of unsold nights." },
  isolated: { label: "One-off", cls: "bg-accent text-accent-foreground", tip: "Single discounted booking; month pacing and future rates look fine. Monitor only." },
  on_target: { label: "On target", cls: "bg-primary/70 text-primary-foreground", tip: "Booked at or near benchmark with no pacing concern." },
  unknown: { label: "No benchmark", cls: "border bg-transparent text-muted-foreground", tip: "Not enough history to diagnose." },
};

// Length-of-stay tiers: expected discount tolerance (pts) for longer stays
const losOf = (n: number): [string, number] => (n >= 28 ? ["Monthly", 15] : n >= 7 ? ["Weekly", 10] : ["Standard", 0]);
// Max acceptable LOS discount before it counts as over-discounting (weekly 5–15%, monthly 10–20%)
const losCeiling = (tier: string) => (tier === "Monthly" ? 20 : tier === "Weekly" ? 15 : 0);
const overDisc = (a: { losTier: string; overallVar: number | null }) => { const c = losCeiling(a.losTier); return c && a.overallVar !== null && -a.overallVar > c ? -a.overallVar - c : 0; };
// Late relative to this property's own curve: within 30% of typical lead (or ≤7d absolute)
const isLate = (lead: number | null, rel: number | null) => (lead !== null && lead <= 7) || (rel !== null && rel <= 0.3);

function diagnose(a: { adjVar: number | null; leadDays: number | null; relLead: number | null; futureVar: number | null; recentLowCount: number; revparVar: number | null }): Diagnosis {
  const v = a.adjVar, rv = a.revparVar;
  if (v === null) return "unknown";
  if (rv !== null) {
    if (v < -20 && rv < -20) return "distress";
    if (v >= 10 && rv < -15) return "drag";
    if (v < -10 && rv >= 5) return "yield";
  }
  if (v >= -10) return "on_target";
  if (isLate(a.leadDays, a.relLead)) return "tactical";
  if (rv !== null && rv < -5) return "leak";
  const futureLow = a.futureVar !== null && a.futureVar < -10;
  const farAhead = (a.relLead !== null ? a.relLead > 1.5 : (a.leadDays ?? 0) > 30) && v < -20;
  if (futureLow || a.recentLowCount >= 2 || farAhead) return "systemic";
  return "isolated";
}

// Context-aware score: late discounts (vs the property's own curve) are expected; discounts locked in far ahead are penalized harder
function adjustScore(base: number | null, lead: number | null, rel: number | null, v: number | null): number | null {
  if (base === null || v === null) return base;
  if (isLate(lead, rel) && v < 0 && v >= -25) return Math.max(base, 3);
  const far = rel !== null ? rel > 1.5 : (lead ?? 0) > 60;
  if (far && v < -10) return Math.max(1, base - 1);
  return base;
}

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
const monthLabel = (m?: string) => { const d = m ? parseISO(`${m}-01`) : null; return d && !isNaN(d.getTime()) ? format(d, "MMM") : "Stay-month"; };
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

export function RateAuditor() {
  const [period, setPeriod] = useState("1");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [windowFilter, setWindowFilter] = useState("all");
  const [diagFilter, setDiagFilter] = useState("all");
  const [sortKey, setSortKey] = useState("newest");
  const [loading, setLoading] = useState(false);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [listingNames, setListingNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Audit | null>(null);

  const reqRef = useRef(0);
  const load = async () => {
    const reqId = ++reqRef.current;
    const stale = () => reqId !== reqRef.current;
    setLoading(true);
    setError(null);
    setAudits([]);
    try {
      const end = new Date();
      const start = subDays(new Date(format(end, "yyyy-MM-dd") + "T00:00:00"), Number(period));
      const reservations = await fetchAllPaged<Res>((f, t) =>
        supabase.from("reservations")
          .select("id, listing_id, check_in, check_out, nights_count, fare_accommodation_adjusted, host_payout, sub_total, source, guest_name, created_at_guesty, status")
          .gte("created_at_guesty", start.toISOString())
          .lte("created_at_guesty", end.toISOString())
          .in("status", CONFIRMED)
          .or("source.is.null,source.neq.owner")
          .gt("nights_count", 0)
          .order("created_at_guesty", { ascending: false })
          .range(f, t));

      const listingIds = [...new Set(reservations.map((r) => r.listing_id))];
      if (stale()) return;
      if (!listingIds.length) { setAudits([]); return; }

      const [{ data: listings }, { data: peers }] = await Promise.all([
        supabase.from("listings").select("id, nickname").in("id", listingIds),
        supabase.from("portfolio_comparables").select("listing_id, peer_listing_id").in("listing_id", listingIds),
      ]);
      if (stale()) return;
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
        // Holiday nights benchmark against the same holiday last year (dates shift year to year)
        const h = holidayOf(night);
        if (h) {
          const lyWin = holidayWindows(night.getFullYear() - 1).find((w) => w.key === h.win.key);
          if (lyWin) {
            const same = exact.get(`${listingId}|${format(addDays(lyWin.start, Math.min(h.offset, lyWin.nights - 1)), "yyyy-MM-dd")}`);
            if (same) return { v: same, src: "Same holiday LY" };
            const vals: number[] = [];
            for (let i = 0; i < lyWin.nights; i++) {
              const x = exact.get(`${listingId}|${format(addDays(lyWin.start, i), "yyyy-MM-dd")}`);
              if (x) vals.push(x);
            }
            const ha = avg(vals);
            if (ha) return { v: ha, src: "Same holiday LY" };
            const pv = (peerMap.get(listingId) || []).flatMap((p) => {
              const out: number[] = [];
              for (let i = 0; i < lyWin.nights; i++) {
                const x = exact.get(`${p}|${format(addDays(lyWin.start, i), "yyyy-MM-dd")}`);
                if (x) out.push(x);
              }
              return out;
            });
            const pa = avg(pv);
            if (pa) return { v: pa, src: "Portfolio peers same holiday LY" };
          }
        }
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

      // Typical lead time per listing + stay month, from stays checked in over the past 2 years
      const histFrom = format(subDays(new Date(), 730), "yyyy-MM-dd");
      const histTo = format(new Date(), "yyyy-MM-dd");
      const leadMap = new Map<string, number[]>();
      for (let i = 0; i < listingIds.length; i += 50) {
        const hist = await fetchAllPaged<any>((f, t) =>
          supabase.from("reservations").select("listing_id, check_in, created_at_guesty")
            .in("listing_id", listingIds.slice(i, i + 50)).in("status", CONFIRMED)
            .or("source.is.null,source.neq.owner").gte("check_in", histFrom).lt("check_in", histTo)
            .not("created_at_guesty", "is", null).order("id").range(f, t));
        for (const h of hist) {
          const l = leadOf(h.created_at_guesty, h.check_in);
          if (l === null) continue;
          for (const k of [`${h.listing_id}|${h.check_in.slice(5, 7)}`, `${h.listing_id}|all`]) {
            const arr = leadMap.get(k) || []; arr.push(l); leadMap.set(k, arr);
          }
        }
      }
      const typicalFor = (id: string, checkIn: string) => {
        const m = leadMap.get(`${id}|${checkIn.slice(5, 7)}`);
        if (m && m.length >= 3) return avg(m);
        return avg(leadMap.get(`${id}|all`) || []);
      };

      const result: Audit[] = reservations.map((r) => {
        const leadDays = leadOf(r.created_at_guesty, r.check_in);
        const typicalLead = typicalFor(r.listing_id, r.check_in);
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
        let wkdN = 0, wkeN = 0, holN = 0;
        const hols = new Set<string>();
        for (let i = 0; i < r.nights_count; i++) {
          const night = addDays(parseISO(r.check_in), i);
          const wk = isWeekend(night);
          wk ? wkeN++ : wkdN++;
          const h = holidayOf(night);
          if (h) { holN++; hols.add(h.win.name); }
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
          leadDays, windowBucket: bucketOf(leadDays), typicalLead, leadVar: leadDays !== null && typicalLead !== null ? leadDays - typicalLead : null,
          futureVar: null, recentLowCount: 0, diagnosis: "unknown" as Diagnosis,
          stayMonth: r.check_in.slice(0, 7), revpar: null, benchRevpar: null, revparVar: null, occ: null, benchOcc: null, revparSource: "—",
          losTier: "Standard", losAllowance: 0, netCredit: 0, adjVar: overallVar, relLead: null,
          holiday: hols.size ? [...hols].join(", ") : null, holidayNights: holN,
          calAdr: null, calVar: null, calBenchVar: null, origin: null,
        };
      });
      // Calendar rate on the stay nights (latest synced Guesty calendar price) to locate where a discount came from
      const calMap = new Map<string, number>();
      {
        const minStay = reservations.reduce((m, r) => (r.check_in < m ? r.check_in : m), reservations[0].check_in);
        const maxStay = reservations.reduce((m, r) => (r.check_out > m ? r.check_out : m), reservations[0].check_out);
        for (let i = 0; i < listingIds.length; i += 50) {
          const cal = await fetchAllPaged<any>((f, t) =>
            supabase.from("capacity_calendar").select("listing_id, date, price")
              .in("listing_id", listingIds.slice(i, i + 50)).gte("date", minStay).lt("date", maxStay)
              .gt("price", 0).order("id").range(f, t));
          cal.forEach((c) => calMap.set(`${c.listing_id}|${c.date}`, Number(c.price)));
        }
      }
      if (stale()) return;
      result.forEach((a) => {
        const ps: number[] = [];
        for (let i = 0; i < a.res.nights_count; i++) {
          const p = calMap.get(`${a.res.listing_id}|${format(addDays(parseISO(a.res.check_in), i), "yyyy-MM-dd")}`);
          if (p) ps.push(p);
        }
        if (ps.length < Math.ceil(a.res.nights_count / 2)) return;
        a.calAdr = avg(ps);
        a.calVar = a.calAdr ? ((a.grossAdr - a.calAdr) / a.calAdr) * 100 : null;
        a.calBenchVar = a.calAdr && a.benchmarkAdr ? ((a.calAdr - a.benchmarkAdr) / a.benchmarkAdr) * 100 : null;
      });
      // Forward-looking: open calendar asking rates for the next 60 days vs the same benchmark
      const today = format(new Date(), "yyyy-MM-dd");
      const fwdTo = format(addDays(new Date(), 60), "yyyy-MM-dd");
      const futureVarMap = new Map<string, number>();
      for (let i = 0; i < listingIds.length; i += 50) {
        const cal = await fetchAllPaged<any>((f, t) =>
          supabase.from("capacity_calendar").select("listing_id, date, price, is_available")
            .in("listing_id", listingIds.slice(i, i + 50)).gte("date", today).lte("date", fwdTo)
            .eq("is_available", true).order("id").range(f, t));
        const agg = new Map<string, { a: number; b: number }>();
        for (const c of cal) {
          const p = Number(c.price);
          if (!(p > 0)) continue;
          const b = benchFor(c.listing_id, parseISO(c.date));
          if (!b) continue;
          const g = agg.get(c.listing_id) || { a: 0, b: 0 };
          g.a += p; g.b += b.v; agg.set(c.listing_id, g);
        }
        agg.forEach((g, id) => g.b > 0 && futureVarMap.set(id, ((g.a - g.b) / g.b) * 100));
      }
      // Stay-month RevPAR pacing: on-the-books now vs on-the-books at the same point last year
      const months = [...new Set(result.map((a) => a.stayMonth))].sort();
      const curStart = `${months[0]}-01`;
      const curEnd = format(endOfMonth(parseISO(`${months[months.length - 1]}-01`)), "yyyy-MM-dd");
      const lyStart = format(subYears(parseISO(curStart), 1), "yyyy-MM-dd");
      const lyEnd = format(endOfMonth(subYears(parseISO(`${months[months.length - 1]}-01`), 1)), "yyyy-MM-dd");
      const lyCutoff = subDays(new Date(), 364).toISOString();
      const nowIso = new Date().toISOString();
      // key listing|yyyy-MM -> { rev, nights }
      const cur = new Map<string, { rev: number; n: number }>();
      const ly = new Map<string, { rev: number; n: number }>();
      const loadRange = async (from: string, to: string, cutoff: string, target: Map<string, { rev: number; n: number }>) => {
        for (let i = 0; i < allIds.length; i += 50) {
          const chunk = allIds.slice(i, i + 50);
          const resv = await fetchAllPaged<any>((f, t) =>
            supabase.from("reservations").select("id, created_at_guesty")
              .in("listing_id", chunk).in("status", CONFIRMED).or("source.is.null,source.neq.owner")
              .gte("check_out", from).lte("check_in", to).order("id").range(f, t));
          const ok = new Set(resv.filter((x) => !x.created_at_guesty || x.created_at_guesty <= cutoff).map((x) => x.id));
          const ns = await fetchAllPaged<any>((f, t) =>
            supabase.from("reservation_nights").select("listing_id, night_date, revenue_allocation, reservation_id")
              .in("listing_id", chunk).gte("night_date", from).lte("night_date", to).order("id").range(f, t));
          for (const n of ns) {
            if (!ok.has(n.reservation_id)) continue;
            const k = `${n.listing_id}|${n.night_date.slice(0, 7)}`;
            const g = target.get(k) || { rev: 0, n: 0 };
            g.rev += Number(n.revenue_allocation) || 0; g.n += 1; target.set(k, g);
          }
        }
      };
      await Promise.all([loadRange(curStart, curEnd, nowIso, cur), loadRange(lyStart, lyEnd, lyCutoff, ly)]);
      const metric = (m: Map<string, { rev: number; n: number }>, id: string, month: string) => {
        const g = m.get(`${id}|${month}`);
        const days = getDaysInMonth(parseISO(`${month}-01`));
        return g ? { revpar: g.rev / days, occ: Math.min(100, (g.n / days) * 100) } : null;
      };

      const netSums = new Map<string, number[]>();
      result.forEach((a) => a.grossAdr > 0 && netSums.set(a.res.listing_id, [...(netSums.get(a.res.listing_id) || []), a.netAdr / a.grossAdr]));
      const netAvg = new Map<string, number>();
      netSums.forEach((v, k) => netAvg.set(k, avg(v)!));
      const lowCount = new Map<string, number>();
      result.forEach((a) => (a.overallVar ?? 0) < -15 && lowCount.set(a.res.listing_id, (lowCount.get(a.res.listing_id) || 0) + 1));
      result.forEach((a) => {
        const fv = futureVarMap.get(a.res.listing_id) ?? null;
        a.futureVar = fv;
        a.recentLowCount = lowCount.get(a.res.listing_id) || 0;
        const id = a.res.listing_id;
        const lyMonth = format(subYears(parseISO(`${a.stayMonth}-01`), 1), "yyyy-MM");
        const mine = metric(cur, id, a.stayMonth) || { revpar: 0, occ: 0 };
        a.revpar = mine.revpar; a.occ = mine.occ;
        const own = metric(ly, id, lyMonth);
        if (own && own.revpar > 0) {
          a.benchRevpar = own.revpar; a.benchOcc = own.occ; a.revparSource = "Same month LY (pace)";
        } else {
          // Fallback: peers' current on-the-books RevPAR for the same month
          const ps = (peerMap.get(id) || []).map((p) => metric(cur, p, a.stayMonth)).filter((x): x is { revpar: number; occ: number } => !!x);
          const pr = avg(ps.map((x) => x.revpar));
          if (pr && pr > 0) { a.benchRevpar = pr; a.benchOcc = avg(ps.map((x) => x.occ)); a.revparSource = `Portfolio peers (${ps.length})`; }
        }
        a.revparVar = a.benchRevpar ? ((a.revpar! - a.benchRevpar) / a.benchRevpar) * 100 : null;
        // LOS allowance + net-yield credit (channel with better take-home than this listing's average)
        const [tier, allow] = losOf(a.res.nights_count);
        a.losTier = tier; a.losAllowance = allow;
        const avgRatio = netAvg.get(id);
        const ratio = a.grossAdr > 0 ? a.netAdr / a.grossAdr : 1;
        a.netCredit = avgRatio && avgRatio > 0 ? Math.max(0, (ratio / avgRatio - 1) * 100) : 0;
        a.relLead = a.leadDays !== null && a.typicalLead ? a.leadDays / a.typicalLead : null;
        a.adjVar = a.overallVar === null ? null
          : a.overallVar >= 0 ? a.overallVar : Math.min(0, a.overallVar + allow + a.netCredit);
        a.score = adjustScore(scoreFor(a.adjVar), a.leadDays, a.relLead, a.adjVar);
        a.diagnosis = diagnose(a);
      });
      if (stale()) return;
      setAudits(result);
    } catch (e: any) {
      if (!stale()) setError(e?.message || "Could not load bookings");
    } finally {
      if (!stale()) setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period]);

  const channels = useMemo(() => [...new Set(audits.map((a) => a.res.source || "unknown"))].sort(), [audits]);
  const nullLast = (x: number | null | undefined, y: number | null | undefined, dir: number) =>
    x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * dir;
  const sorters: Record<string, (a: Audit, b: Audit) => number> = {
    newest: (a, b) => (b.res.created_at_guesty || "").localeCompare(a.res.created_at_guesty || ""),
    worst: (a, b) => nullLast(a.score, b.score, 1) || nullLast(a.overallVar, b.overallVar, 1),
    best: (a, b) => nullLast(a.score, b.score, -1) || nullLast(a.overallVar, b.overallVar, -1),
    discount: (a, b) => nullLast(a.overallVar, b.overallVar, 1),
    premium: (a, b) => nullLast(a.overallVar, b.overallVar, -1),
    arrival: (a, b) => a.res.check_in.localeCompare(b.res.check_in),
    arrival_late: (a, b) => b.res.check_in.localeCompare(a.res.check_in),
    lead_short: (a, b) => nullLast(a.leadDays, b.leadDays, 1),
    lead_long: (a, b) => nullLast(a.leadDays, b.leadDays, -1),
    rate_high: (a, b) => b.grossAdr - a.grossAdr,
    rate_low: (a, b) => a.grossAdr - b.grossAdr,
  };
  const toggle = (x: string, y: string) => setSortKey(sortKey === x ? y : x);
  const arrow = (x: string, y: string) => (sortKey === x ? " ↑" : sortKey === y ? " ↓" : "");

  const filtered = audits.filter((a) =>
    (scoreFilter === "all" || (scoreFilter === "flagged" ? (a.score ?? 5) <= 2 : String(a.score) === scoreFilter)) &&
    (channelFilter === "all" || (a.res.source || "unknown") === channelFilter) &&
    (windowFilter === "all" || a.windowBucket === windowFilter) &&
    (diagFilter === "all" || (diagFilter === "overdisc" ? overDisc(a) > 0 && a.losTier === "Monthly" : diagFilter === "overdisc_any" ? overDisc(a) > 0 : a.diagnosis === diagFilter))).sort(sorters[sortKey] || sorters.newest);

  const totalNights = filtered.reduce((s, a) => s + a.res.nights_count, 0);
  const avgNet = totalNights ? filtered.reduce((s, a) => s + a.netAdr * a.res.nights_count, 0) / totalNights : null;
  const scored = filtered.filter((a) => a.overallVar !== null);
  const avgVar = avg(scored.map((a) => a.overallVar!));
  const flagged = filtered.filter((a) => (a.score ?? 5) <= 2).length;
  const leads = filtered.filter((a) => a.leadDays !== null);
  const avgLead = avg(leads.map((a) => a.leadDays!));
  const lastMinPct = leads.length ? (leads.filter((a) => a.leadDays! <= 7).length / leads.length) * 100 : null;
  const avgLeadVar = avg(leads.filter((a) => a.leadVar !== null).map((a) => a.leadVar!));

  const exportCsv = () => {
    downloadCsv(`rate-audit-${format(new Date(), "yyyy-MM-dd")}.csv`, [
      ["Property", "Guest", "Channel", "Booked", "Check-in", "Check-out", "Nights", "Weekday nights", "Weekend nights", "Gross ADR", "Est. channel fee", "Net ADR", "Benchmark ADR", "Weekday var %", "Weekend var %", "Overall var %", "Score", "Benchmark source", "Lead days", "Booking window", "Typical lead days", "Lead vs typical (days)", "Diagnosis", "Next 60d asking vs benchmark %", "Low pickups in period", "Stay month", "Stay-month RevPAR", "Benchmark RevPAR", "RevPAR var %", "Stay-month occupancy %", "Benchmark occupancy %", "RevPAR benchmark source", "LOS tier", "LOS allowance pts", "LOS discount ceiling %", "Excess discount pts"],
      ...filtered.map((a) => [
        listingNames[a.res.listing_id] || a.res.listing_id, a.res.guest_name || "", a.res.source || "",
        a.res.created_at_guesty ? format(new Date(a.res.created_at_guesty), "yyyy-MM-dd") : "",
        a.res.check_in, a.res.check_out, String(a.res.nights_count), String(a.weekdayNights), String(a.weekendNights),
        a.grossAdr.toFixed(2), a.fee.toFixed(2), a.netAdr.toFixed(2), a.benchmarkAdr?.toFixed(2) ?? "",
        a.weekdayVar?.toFixed(1) ?? "", a.weekendVar?.toFixed(1) ?? "", a.overallVar?.toFixed(1) ?? "",
        a.score ? String(a.score) : "", a.benchmarkSource,
        a.leadDays?.toString() ?? "", a.windowBucket, a.typicalLead?.toFixed(0) ?? "", a.leadVar?.toFixed(0) ?? "",
        DIAG[a.diagnosis].label, a.futureVar?.toFixed(1) ?? "", String(a.recentLowCount),
        a.stayMonth, a.revpar?.toFixed(2) ?? "", a.benchRevpar?.toFixed(2) ?? "", a.revparVar?.toFixed(1) ?? "", a.occ?.toFixed(1) ?? "", a.benchOcc?.toFixed(1) ?? "", a.revparSource,
        a.losTier, String(a.losAllowance), String(losCeiling(a.losTier) || ""), overDisc(a) ? overDisc(a).toFixed(1) : "",
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
              <SelectItem value="90">Booked last 90 days</SelectItem>
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
          <Select value={windowFilter} onValueChange={setWindowFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All booking windows</SelectItem>
              {WINDOWS.map(([w, a, b]) => <SelectItem key={w} value={w}>{w} ({b > 9999 ? `${a}+` : `${a}–${b}`}d)</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={diagFilter} onValueChange={setDiagFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All diagnoses</SelectItem>
              <SelectItem value="overdisc">Excessive monthly discounts</SelectItem>
              <SelectItem value="overdisc_any">Any stay over discount ceiling</SelectItem>
              {(Object.keys(DIAG) as Diagnosis[]).map((d) => <SelectItem key={d} value={d}>{d === "leak" ? "True pricing leaks" : DIAG[d].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={setSortKey}>
            <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Sort: Newest booked</SelectItem>
              <SelectItem value="worst">Sort: Worst score first</SelectItem>
              <SelectItem value="discount">Sort: Steepest discount</SelectItem>
              <SelectItem value="best">Sort: Best score first</SelectItem>
              <SelectItem value="arrival">Sort: Soonest arrival</SelectItem>
              <SelectItem value="rate_high">Sort: Highest booked rate</SelectItem>
              {["premium", "arrival_late", "lead_short", "lead_long", "rate_low"].includes(sortKey) && (
                <SelectItem value={sortKey}>Sort: Column ({sortKey.replace("_", " ")})</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" />Export CSV
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          {[
            ["Bookings picked up", String(filtered.length), `${totalNights} nights`],
            ["Avg net ADR", fmt(avgNet), "After estimated channel fees"],
            ["Rate vs benchmark", pct(avgVar), `${scored.length} bookings with a benchmark`],
            ["Flagged bookings", String(flagged), `${filtered.filter((a) => ["leak", "distress"].includes(a.diagnosis)).length} true leaks · ${filtered.filter((a) => a.diagnosis === "yield").length} yield plays`],
            ["Avg booking window", avgLead === null ? "—" : `${Math.round(avgLead)}d`, avgLeadVar === null ? "No history" : `${Math.abs(Math.round(avgLeadVar))}d ${avgLeadVar >= 0 ? "earlier" : "later"} than typical`],
            ["Last-minute share", lastMinPct === null ? "—" : `${lastMinPct.toFixed(0)}%`, "Booked 0–7 days before arrival"],
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
              <div className="max-h-[70vh] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggle("worst", "best")}>Score / Property{arrow("worst", "best")}</TableHead>
                    <TableHead>Diagnosis</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggle("arrival", "arrival_late")}>Stay{arrow("arrival", "arrival_late")}</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => toggle("lead_short", "lead_long")}>Booking window{arrow("lead_short", "lead_long")}</TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => toggle("rate_low", "rate_high")}>Booked rate{arrow("rate_low", "rate_high")}</TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => toggle("discount", "premium")}>vs benchmark{arrow("discount", "premium")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => {
                    const diverge = a.weekdayVar !== null && a.weekendVar !== null && Math.abs(a.weekdayVar - a.weekendVar) >= 10;
                    const earlyLeak = a.leadVar !== null && a.leadVar >= 14 && (a.overallVar ?? 0) < -10;
                    return (
                    <TableRow key={a.res.id} className="cursor-pointer odd:bg-muted/30 hover:bg-muted/60" onClick={() => setSelected(a)}>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2">
                          {a.score ? <Badge className={cn("w-6 justify-center", scoreClass[a.score])}>{a.score}</Badge> : <Badge variant="outline">–</Badge>}
                          <span className="font-medium">{listingNames[a.res.listing_id] || a.res.listing_id}</span>
                        </div>
                        <div className="ml-8 text-xs text-muted-foreground">{a.res.guest_name || "Guest"} · {a.res.source || "unknown"}</div>
                      </TableCell>
                      <TableCell>
                        <Tooltip><TooltipTrigger asChild><Badge className={cn("whitespace-nowrap", DIAG[a.diagnosis].cls)}>{DIAG[a.diagnosis].label}</Badge></TooltipTrigger>
                          <TooltipContent className="max-w-xs">{DIAG[a.diagnosis].tip}</TooltipContent></Tooltip>
                        {overDisc(a) > 0 && <Badge variant="outline" className="ml-1 border-destructive text-destructive whitespace-nowrap">Excessive {a.losTier.toLowerCase()} discount</Badge>}
                        <div className={cn("text-xs mt-1", a.revparVar !== null && a.revparVar < -5 ? "text-destructive" : "text-muted-foreground")}>{monthLabel(a.stayMonth)} RevPAR {pct(a.revparVar)}</div>
                        {a.futureVar !== null && <div className="text-xs text-muted-foreground">Next 60d {pct(a.futureVar)}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(parseISO(a.res.check_in), "MMM d")} – {format(parseISO(a.res.check_out), "MMM d")}
                        <div className="text-xs text-muted-foreground">{a.res.nights_count} nights</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm">{a.leadDays === null ? "—" : `${a.leadDays}d out`} <Badge variant="outline" className={cn("ml-1", earlyLeak && "border-accent text-accent-foreground bg-accent")}>{a.windowBucket}</Badge></div>
                        <div className="text-xs text-muted-foreground">
                          {a.leadVar === null ? "No history" : Math.abs(a.leadVar) < 3 ? `About typical (${Math.round(a.typicalLead!)}d)` : `${Math.abs(Math.round(a.leadVar))}d ${a.leadVar >= 0 ? "earlier" : "later"} than typical (${Math.round(a.typicalLead!)}d)`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-semibold">{fmt(a.grossAdr)}</div>
                        <div className="text-xs text-muted-foreground">{fmt(a.netAdr)} net</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={cn(a.overallVar !== null && a.overallVar < -10 && "border-destructive text-destructive", a.overallVar !== null && a.overallVar >= 0 && "border-primary text-primary")}>{pct(a.overallVar)}</Badge>
                        <div className="text-xs text-muted-foreground mt-1">vs {fmt(a.benchmarkAdr)}</div>
                        {diverge && <div className="text-xs text-muted-foreground">Wkday {pct(a.weekdayVar)} · Wkend {pct(a.weekendVar)}</div>}
                      </TableCell>
                    </TableRow>
                  );})}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            {selected && (() => {
              const s = selected;
              const rows: [string, string][] = [
                ["Guest", s.res.guest_name || "—"], ["Channel", s.res.source || "—"],
                ["Booked", s.res.created_at_guesty ? format(new Date(s.res.created_at_guesty), "MMM d, yyyy") : "—"],
                ["Stay", `${format(parseISO(s.res.check_in), "MMM d")} – ${format(parseISO(s.res.check_out), "MMM d, yyyy")}`],
                ["Nights", `${s.res.nights_count} (${s.weekdayNights} weekday / ${s.weekendNights} weekend)`],
                ["Booking window", s.leadDays === null ? "—" : `${s.leadDays} days · ${s.windowBucket}`],
                ["Typical window", s.typicalLead === null ? "No history" : `${Math.round(s.typicalLead)} days`],
                ["Accommodation fare", fmt(Number(s.res.fare_accommodation_adjusted || 0))],
                ["Subtotal", fmt(Number(s.res.sub_total || 0))],
                ["Est. channel fee", fmt(s.fee)],
                ["Gross rate / night", fmt(s.grossAdr)], ["Net rate / night", fmt(s.netAdr)],
                ["Benchmark / night", fmt(s.benchmarkAdr)], ["Benchmark based on", s.benchmarkSource],
                ["Weekday vs benchmark", pct(s.weekdayVar)], ["Weekend vs benchmark", pct(s.weekendVar)],
                ["Overall vs benchmark", pct(s.overallVar)],
                ["Diagnosis", DIAG[s.diagnosis].label],
                ["Stay length tier", s.losTier === "Standard" ? "Standard (no LOS allowance)" : `${s.losTier} · ${s.losAllowance}% allowance · ${losCeiling(s.losTier)}% max`],
                ...(overDisc(s) > 0 ? [["Over-discount", `Raw ${pct(s.overallVar)} vs ${losCeiling(s.losTier)}% max allowed: ${overDisc(s).toFixed(1)} pts excess`] as [string, string]] : []),
                ["Stay-month RevPAR (on the books)", `${fmt(s.revpar)} · ${s.occ === null ? "—" : s.occ.toFixed(0)}% occ`],
                ["Benchmark RevPAR", `${fmt(s.benchRevpar)} · ${s.benchOcc === null ? "—" : s.benchOcc.toFixed(0)}% occ`],
                ["RevPAR vs benchmark", pct(s.revparVar)], ["RevPAR benchmark", s.revparSource],
                ["Next 60d open-date rates vs benchmark", pct(s.futureVar)],
                ["Low pickups (>15% below) this period", String(s.recentLowCount)],
              ];
              return (<>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    {s.score && <Badge className={scoreClass[s.score]}>{s.score}</Badge>}
                    {listingNames[s.res.listing_id] || s.res.listing_id}
                  </SheetTitle>
                </SheetHeader>
                <p className="mt-3 rounded-md bg-muted p-3 text-sm">{DIAG[s.diagnosis].tip}</p>
                <dl className="mt-4 divide-y text-sm">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
                  ))}
                </dl>
              </>);
            })()}
          </SheetContent>
        </Sheet>
        <p className="text-xs text-muted-foreground">
          Each night is compared to the same weekday last year (364 days back), falling back to last year's same-month weekday/weekend average, then to your Portfolio Peers. Weekend = Fri & Sat nights. Score: 5 = 10%+ above, 4 = at/above, 3 = up to 10% below, 2 = 10–25% below, 1 = more than 25% below. Rates compare gross accommodation fare; net ADR subtracts the estimated channel fee. Booking window = days between booking and check-in, compared to the property's typical lead time for that arrival month (past 2 years). Last-minute discounts (0–7d) score no lower than 3; bookings locked in 60+ days out at more than 10% below benchmark lose an extra point. Diagnosis weighs rate against stay-month RevPAR pacing: the property's on-the-books RevPAR for the arrival month vs what it had on the books for the same month at this point last year (falls back to Portfolio Peers' current RevPAR for that month). Yield strategy = rate 10%+ below but RevPAR 5%+ ahead; True pricing leak = rate 10%+ below and RevPAR 5%+ behind; Distress selling = rate 20%+ below and RevPAR 20%+ behind; Overpriced = rate 10%+ above but RevPAR 15%+ behind; Last-minute fill = discounted within 7 days of arrival; Recurring discount = repeated low pickups or low upcoming rates without a RevPAR signal; One-off = isolated discount. Monthly goals are not used as the benchmark.
        </p>
      </div>
    </TooltipProvider>
  );
}

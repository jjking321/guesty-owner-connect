import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/reports/format";

interface ImpactEvent {
  review_id: string; listing_id: string; listing_name: string | null; review_date: string; rating: number;
  review_snippet: string; is_removed: boolean; peer_count: number; post_complete: boolean;
  score_before: number | null; score_after: number | null; reviews_before: number;
  pre_bookings: number; pre_nights: number; pre_revenue: number;
  post_bookings: number; post_nights: number; post_revenue: number;
  hist_pre_bookings: number; hist_pre_nights: number; hist_pre_revenue: number;
  hist_post_bookings: number; hist_post_nights: number; hist_post_revenue: number;
  peer_pre_bookings: number; peer_pre_nights: number; peer_pre_revenue: number;
  peer_post_bookings: number; peer_post_nights: number; peer_post_revenue: number;
}

const n = (v: unknown) => Number(v) || 0;
const ratio = (a: number, b: number) => (b > 0 ? a / b - 1 : null);
const adr = (rev: number, nights: number) => (nights > 0 ? rev / nights : null);
const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const pts = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`);
const money = (v: number | null) => (v === null ? "—" : `$${Math.round(v).toLocaleString()}`);
const tone = (v: number | null) => (v === null ? "" : v < -0.02 ? "text-destructive" : v > 0.02 ? "text-primary" : "text-muted-foreground");
const score = (v: number | null) => (v === null || v === undefined ? "—" : Number(v).toFixed(2));

const SCORE_BANDS = [
  { label: "Below 4.50", min: 0, max: 4.5 },
  { label: "4.50 – 4.69", min: 4.5, max: 4.7 },
  { label: "4.70 – 4.79", min: 4.7, max: 4.8 },
  { label: "4.80 – 4.89", min: 4.8, max: 4.9 },
  { label: "4.90 and up", min: 4.9, max: 6 },
];

const VOLUME_BANDS = [
  { label: "Under 10 reviews", min: 0, max: 10 },
  { label: "10 – 29 reviews", min: 10, max: 30 },
  { label: "30 – 99 reviews", min: 30, max: 100 },
  { label: "100+ reviews", min: 100, max: Infinity },
];

const THRESHOLDS = [4.9, 4.8, 4.7];
function crossedThreshold(e: ImpactEvent) {
  const before = e.score_before === null ? null : Number(e.score_before);
  const after = e.score_after === null ? null : Number(e.score_after);
  if (before === null || after === null) return null;
  return THRESHOLDS.find((t) => before >= t && after < t) ?? null;
}

function summarize(evs: ImpactEvent[]) {
  const s = (k: keyof ImpactEvent) => evs.reduce((t, e) => t + n(e[k]), 0);
  const own = ratio(s("post_nights"), s("pre_nights"));
  const hist = ratio(s("hist_post_nights"), s("hist_pre_nights"));
  const peerEvs = evs.filter((e) => e.peer_count > 0);
  const ps = (k: keyof ImpactEvent) => peerEvs.reduce((t, e) => t + n(e[k]), 0);
  const peer = ratio(ps("peer_post_nights"), ps("peer_pre_nights"));
  const ownAdr = ratio(adr(s("post_revenue"), s("post_nights")) ?? 0, adr(s("pre_revenue"), s("pre_nights")) ?? 0);
  const histAdr = ratio(adr(s("hist_post_revenue"), s("hist_post_nights")) ?? 0, adr(s("hist_pre_revenue"), s("hist_pre_nights")) ?? 0);
  const peerAdr = ratio(adr(ps("peer_post_revenue"), ps("peer_post_nights")) ?? 0, adr(ps("peer_pre_revenue"), ps("peer_pre_nights")) ?? 0);
  const withScore = evs.filter((e) => e.score_before !== null);
  return {
    count: evs.length, own, hist, peer, ownAdr, histAdr, peerAdr,
    avgScore: withScore.length ? withScore.reduce((t, e) => t + Number(e.score_before), 0) / withScore.length : null,
    avgVolume: evs.length ? evs.reduce((t, e) => t + n(e.reviews_before), 0) / evs.length : null,
    vsHist: own !== null && hist !== null ? own - hist : null,
    vsPeer: own !== null && peer !== null ? own - peer : null,
    adrVsHist: ownAdr !== null && histAdr !== null ? ownAdr - histAdr : null,
    adrVsPeer: ownAdr !== null && peerAdr !== null ? ownAdr - peerAdr : null,
  };
}

function eventMetrics(e: ImpactEvent) {
  const own = ratio(n(e.post_nights), n(e.pre_nights));
  const hist = ratio(n(e.hist_post_nights), n(e.hist_pre_nights));
  const peer = e.peer_count > 0 ? ratio(n(e.peer_post_nights), n(e.peer_pre_nights)) : null;
  const preAdr = adr(n(e.pre_revenue), n(e.pre_nights));
  const postAdr = adr(n(e.post_revenue), n(e.post_nights));
  return {
    own, preAdr, postAdr,
    adrChange: preAdr && postAdr ? postAdr / preAdr - 1 : null,
    vsHist: own !== null && hist !== null ? own - hist : null,
    vsPeer: own !== null && peer !== null ? own - peer : null,
  };
}

export default function ReviewImpact() {
  const [months, setMonths] = useState("24");
  const [windowDays, setWindowDays] = useState("30");
  const [maxRating, setMaxRating] = useState("4");
  const [scoreBand, setScoreBand] = useState("all");
  const [volumeBand, setVolumeBand] = useState("all");

  const { data: rawEvents = [], isLoading, error } = useQuery({
    queryKey: ["review-impact", months, windowDays, maxRating],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_review_impact_events_v2", {
        p_start_date: format(subMonths(new Date(), Number(months)), "yyyy-MM-dd"),
        p_end_date: format(new Date(), "yyyy-MM-dd"),
        p_max_rating: Number(maxRating),
        p_window_days: Number(windowDays),
        p_source: "Airbnb",
      });
      if (error) throw error;
      return (data ?? []) as ImpactEvent[];
    },
  });

  const events = useMemo(() => {
    const sb = SCORE_BANDS.find((b) => b.label === scoreBand);
    const vb = VOLUME_BANDS.find((b) => b.label === volumeBand);
    return rawEvents.filter((e) => {
      if (sb) {
        if (e.score_before === null) return false;
        const s = Number(e.score_before);
        if (s < sb.min || s >= sb.max) return false;
      }
      if (vb) {
        const v = n(e.reviews_before);
        if (v < vb.min || v >= vb.max) return false;
      }
      return true;
    });
  }, [rawEvents, scoreBand, volumeBand]);

  const complete = useMemo(() => events.filter((e) => e.post_complete), [events]);
  const overall = useMemo(() => summarize(complete), [complete]);
  const byRating = useMemo(
    () => [
      { label: "1–2 stars", evs: complete.filter((e) => n(e.rating) <= 2) },
      { label: "3 stars", evs: complete.filter((e) => n(e.rating) > 2 && n(e.rating) <= 3) },
      { label: "4 stars", evs: complete.filter((e) => n(e.rating) > 3) },
    ].filter((g) => g.evs.length > 0).map((g) => ({ label: g.label, ...summarize(g.evs) })),
    [complete],
  );

  const byScore = useMemo(
    () => SCORE_BANDS.map((b) => ({
      label: b.label,
      evs: complete.filter((e) => e.score_before !== null && Number(e.score_before) >= b.min && Number(e.score_before) < b.max),
    })).filter((g) => g.evs.length > 0).map((g) => ({ label: g.label, ...summarize(g.evs) })),
    [complete],
  );

  const byVolume = useMemo(
    () => VOLUME_BANDS.map((b) => ({
      label: b.label,
      evs: complete.filter((e) => n(e.reviews_before) >= b.min && n(e.reviews_before) < b.max),
    })).filter((g) => g.evs.length > 0).map((g) => ({ label: g.label, ...summarize(g.evs) })),
    [complete],
  );

  const crossings = useMemo(() => complete.filter((e) => crossedThreshold(e) !== null), [complete]);
  const crossingStats = useMemo(() => summarize(crossings), [crossings]);

  const handleExport = () => {
    const header = ["Review date", "Property", "Rating", "Score before", "Score after", "Reviews before", "Crossed threshold",
      "Removed", "Pre nights", "Post nights", "Pickup change",
      "Vs own history (pts)", "Vs peers (pts)", "Pre ADR", "Post ADR", "ADR change", "Peers", "Review"];
    const rows = events.map((e) => {
      const m = eventMetrics(e);
      const f = (v: number | null) => (v === null ? "" : (v * 100).toFixed(1));
      const x = crossedThreshold(e);
      return [format(new Date(e.review_date), "yyyy-MM-dd"), e.listing_name ?? e.listing_id, String(e.rating),
        score(e.score_before), score(e.score_after), String(n(e.reviews_before)), x ? x.toFixed(2) : "",
        e.is_removed ? "yes" : "no", String(e.pre_nights), String(e.post_nights), f(m.own), f(m.vsHist), f(m.vsPeer),
        m.preAdr ? m.preAdr.toFixed(2) : "", m.postAdr ? m.postAdr.toFixed(2) : "", f(m.adrChange),
        String(e.peer_count), e.review_snippet];
    });
    downloadCsv(`review-impact-airbnb.csv`, [header, ...rows]);
  };

  const bandTable = (rows: ReturnType<typeof summarize> & { label: string }[] | Array<{ label: string } & ReturnType<typeof summarize>>, firstCol: string) => (
    <Table>
      <TableHeader><TableRow>
        <TableHead>{firstCol}</TableHead><TableHead className="text-right">Reviews</TableHead>
        <TableHead className="text-right">Avg score</TableHead><TableHead className="text-right">Avg review count</TableHead>
        <TableHead className="text-right">Nights change</TableHead>
        <TableHead className="text-right">vs history</TableHead><TableHead className="text-right">vs peers</TableHead>
        <TableHead className="text-right">Rate change</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {(rows as Array<{ label: string } & ReturnType<typeof summarize>>).map((g) => (
          <TableRow key={g.label}>
            <TableCell className="font-medium">{g.label}</TableCell>
            <TableCell className="text-right">{g.count}</TableCell>
            <TableCell className="text-right">{score(g.avgScore)}</TableCell>
            <TableCell className="text-right">{g.avgVolume === null ? "—" : Math.round(g.avgVolume)}</TableCell>
            <TableCell className={`text-right ${tone(g.own)}`}>{pct(g.own)}</TableCell>
            <TableCell className={`text-right ${tone(g.vsHist)}`}>{pts(g.vsHist)}</TableCell>
            <TableCell className={`text-right ${tone(g.vsPeer)}`}>{pts(g.vsPeer)}</TableCell>
            <TableCell className={`text-right ${tone(g.ownAdr)}`}>{pct(g.ownAdr)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><TrendingDown className="h-7 w-7" /> Review Impact</h1>
            <p className="text-muted-foreground mt-1">
              How Airbnb reviews of {maxRating} stars or below affect bookings and rates in the days after they post,
              compared to the property's own history (same dates last year) and its portfolio peers.
            </p>
          </div>
          <Button variant="outline" onClick={handleExport} disabled={!events.length}>
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Reviews from</Label>
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="12">Last 12 months</SelectItem>
                <SelectItem value="24">Last 24 months</SelectItem>
                <SelectItem value="36">Last 36 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Window before / after</Label>
            <Select value={windowDays} onValueChange={setWindowDays}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rating at or below</Label>
            <Select value={maxRating} onValueChange={setMaxRating}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 stars</SelectItem>
                <SelectItem value="3">3 stars</SelectItem>
                <SelectItem value="2">2 stars</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Property score at the time</Label>
            <Select value={scoreBand} onValueChange={setScoreBand}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any score</SelectItem>
                {SCORE_BANDS.map((b) => <SelectItem key={b.label} value={b.label}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Reviews collected so far</Label>
            <Select value={volumeBand} onValueChange={setVolumeBand}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any review count</SelectItem>
                {VOLUME_BANDS.map((b) => <SelectItem key={b.label} value={b.label}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" /> Crunching bookings around each review…
          </div>
        ) : error ? (
          <Card><CardContent className="p-6 text-destructive">Couldn't load the analysis: {(error as Error).message}</CardContent></Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card><CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Low reviews analyzed</p>
                <p className="text-3xl font-bold">{overall.count}</p>
                <p className="text-xs text-muted-foreground">{events.length - complete.length} too recent to measure yet</p>
              </CardContent></Card>
              <Card><CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Booked nights after vs before</p>
                <p className={`text-3xl font-bold ${tone(overall.own)}`}>{pct(overall.own)}</p>
                <p className="text-xs text-muted-foreground">Raw change, not adjusted for season</p>
              </CardContent></Card>
              <Card><CardContent className="p-6">
                <p className="text-sm text-muted-foreground">True impact vs own history</p>
                <p className={`text-3xl font-bold ${tone(overall.vsHist)}`}>{pts(overall.vsHist)}</p>
                <p className="text-xs text-muted-foreground">Same property, same dates last year: {pct(overall.hist)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Reviews that dropped a score below 4.90 / 4.80 / 4.70</p>
                <p className={`text-3xl font-bold ${tone(crossingStats.vsHist)}`}>{crossings.length}</p>
                <p className="text-xs text-muted-foreground">Those properties ran {pts(crossingStats.vsHist)} vs their own history</p>
              </CardContent></Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Where the damage starts: impact by property score</CardTitle>
                <CardDescription>
                  Each review is grouped by the property's overall Airbnb score just before the review posted.
                  Negative "pts" means the property did worse than its benchmark afterwards.
                </CardDescription>
              </CardHeader>
              <CardContent>{bandTable(byScore, "Score before review")}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Impact by how many reviews the property had</CardTitle>
                <CardDescription>A single low review moves a young listing's score far more than a mature one's.</CardDescription>
              </CardHeader>
              <CardContent>{bandTable(byVolume, "Reviews collected")}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Impact by star rating</CardTitle>
                <CardDescription>Negative "pts" means the property did worse than its benchmark after the review.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Rating</TableHead><TableHead className="text-right">Reviews</TableHead>
                    <TableHead className="text-right">Nights change</TableHead>
                    <TableHead className="text-right">vs history</TableHead><TableHead className="text-right">vs peers</TableHead>
                    <TableHead className="text-right">Rate change</TableHead>
                    <TableHead className="text-right">Rate vs history</TableHead><TableHead className="text-right">Rate vs peers</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {byRating.map((g) => (
                      <TableRow key={g.label}>
                        <TableCell className="font-medium">{g.label}</TableCell>
                        <TableCell className="text-right">{g.count}</TableCell>
                        <TableCell className={`text-right ${tone(g.own)}`}>{pct(g.own)}</TableCell>
                        <TableCell className={`text-right ${tone(g.vsHist)}`}>{pts(g.vsHist)}</TableCell>
                        <TableCell className={`text-right ${tone(g.vsPeer)}`}>{pts(g.vsPeer)}</TableCell>
                        <TableCell className={`text-right ${tone(g.ownAdr)}`}>{pct(g.ownAdr)}</TableCell>
                        <TableCell className={`text-right ${tone(g.adrVsHist)}`}>{pts(g.adrVsHist)}</TableCell>
                        <TableCell className={`text-right ${tone(g.adrVsPeer)}`}>{pts(g.adrVsPeer)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Every low review</CardTitle>
                <CardDescription>Bookings made in the {windowDays} days before and after each review.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Property</TableHead><TableHead>Rating</TableHead>
                    <TableHead className="text-right">Score before → after</TableHead>
                    <TableHead className="text-right">Reviews</TableHead>
                    <TableHead className="text-right">Nights before → after</TableHead>
                    <TableHead className="text-right">vs history</TableHead><TableHead className="text-right">vs peers</TableHead>
                    <TableHead className="text-right">Rate before → after</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {events.slice(0, 300).map((e) => {
                      const m = eventMetrics(e);
                      const crossed = crossedThreshold(e);
                      return (
                        <TableRow key={e.review_id}>
                          <TableCell className="whitespace-nowrap">{format(new Date(e.review_date), "MMM d, yyyy")}</TableCell>
                          <TableCell>
                            <Link className="hover:underline" to={`/listings/${e.listing_id}`}>{e.listing_name ?? e.listing_id}</Link>
                            {e.review_snippet && <p className="text-xs text-muted-foreground line-clamp-1 max-w-md">{e.review_snippet}</p>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{n(e.rating)}★</Badge>
                            {e.is_removed && <Badge variant="secondary" className="ml-1">Removed</Badge>}
                            {!e.post_complete && <Badge variant="secondary" className="ml-1">In progress</Badge>}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {score(e.score_before)} → {score(e.score_after)}
                            {crossed && <Badge variant="destructive" className="ml-1">Fell below {crossed.toFixed(2)}</Badge>}
                          </TableCell>
                          <TableCell className="text-right">{n(e.reviews_before)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{n(e.pre_nights)} → {n(e.post_nights)}</TableCell>
                          <TableCell className={`text-right ${tone(m.vsHist)}`}>{pts(m.vsHist)}</TableCell>
                          <TableCell className={`text-right ${tone(m.vsPeer)}`}>{e.peer_count ? pts(m.vsPeer) : "No peers"}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{money(m.preAdr)} → {money(m.postAdr)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

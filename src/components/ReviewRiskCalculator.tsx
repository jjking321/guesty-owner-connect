import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, subYears, addDays } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, ShieldCheck, Calculator } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Channel = "Airbnb" | "VRBO" | "Booking.com";
const CHANNELS: Channel[] = ["Airbnb", "VRBO", "Booking.com"];
const matchesChannel = (src: string | null, ch: Channel) => {
  const s = (src || "").toLowerCase();
  if (ch === "Airbnb") return s.includes("airbnb");
  if (ch === "VRBO") return s.includes("vrbo") || s.includes("homeaway");
  return s.includes("booking");
};

/** Airbnb-only issue types. weight = how much harder it hits bookings; dispute = rough removal odds. */
const ISSUES = [
  { key: "cleanliness", label: "Cleanliness & odor", weight: 1.3, dispute: 0.05, note: "Shown as its own score on the listing — guests filter on it. Almost never removed." },
  { key: "accuracy", label: "Listing accuracy / not as described", weight: 1.25, dispute: 0.2, note: "Accuracy under 4.70 can trigger search penalties. Removable only if the listing clearly disclosed it." },
  { key: "maintenance", label: "Maintenance, HVAC, pool/spa", weight: 1.1, dispute: 0.1, note: "Emotional 1-star risk; future guests forgive it if your reply shows it was fixed fast." },
  { key: "value", label: "Value & fees", weight: 0.9, dispute: 0.05, note: "Drags the value score; pairs badly with high rates." },
  { key: "checkin", label: "Check-in & access", weight: 0.9, dispute: 0.15, note: "Usually a one-off; a clear fix in your reply limits the damage." },
  { key: "communication", label: "Communication", weight: 0.8, dispute: 0.1, note: "Rarely the main driver of lost bookings on Airbnb." },
  { key: "tech", label: "Wi-Fi, TV & minor tech", weight: 0.6, dispute: 0.1, note: "Annoying but rarely stops a leisure guest from booking." },
  { key: "external", label: "Outside our control (noise, weather, construction)", weight: 0.5, dispute: 0.55, note: "Good odds of removal — save the messages and plan to dispute." },
];

const SEVERITY = [
  { stars: 1, label: "Severe — likely 1★" },
  { stars: 2, label: "High — likely 2★" },
  { stars: 3, label: "Moderate — likely 3★" },
  { stars: 4, label: "Mild — likely 4★" },
];
const STAR_DRAG: Record<number, number> = { 1: 0.1, 2: 0.08, 3: 0.05, 4: 0.02 };
const AIRBNB_CLIFFS = [
  { t: 4.9, extra: 0.04, label: "Guest Favorite range (4.90)" },
  { t: 4.8, extra: 0.08, label: "Superhost range (4.80)" },
  { t: 4.7, extra: 0.15, label: "Search cliff (4.70)" },
];
const OTHER_CLIFFS = [{ t: 4.5, extra: 0.06, label: "4.50 visibility line" }];
const IMPACT_DAYS = 60; // a new review sits near the top of the listing ~2 months

const shieldOf = (n: number) => (n < 10 ? 1.4 : n < 30 ? 1.2 : n < 100 ? 0.8 : 0.4);
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

interface Res {
  id: string; guest_name: string | null; check_in: string | null; check_out: string | null; nights_count: number | null;
  fare_accommodation_adjusted: number | null; sub_total: number | null; source: string | null; status: string | null; created_at_guesty: string | null;
}
const revOf = (r: Res) => Number(r.fare_accommodation_adjusted ?? r.sub_total ?? 0) || 0;

export function ReviewRiskCalculator() {
  const [listingId, setListingId] = useState<string>("");
  const [channel, setChannel] = useState<Channel>("Airbnb");
  const [resId, setResId] = useState<string>("none");
  const [issue, setIssue] = useState("cleanliness");
  const [stars, setStars] = useState("2");

  const { data: listings = [] } = useQuery({
    queryKey: ["risk-calc-listings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("listings")
        .select("id, nickname, live_airbnb_rating, live_airbnb_review_count")
        .eq("is_listed", true).order("nickname");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["risk-calc-detail", listingId],
    enabled: !!listingId,
    queryFn: async () => {
      const today = new Date();
      const [rv, rs] = await Promise.all([
        supabase.from("reviews").select("rating, source").eq("listing_id", listingId).eq("is_removed", false).not("rating", "is", null).limit(5000),
        supabase.from("reservations")
          .select("id, guest_name, check_in, check_out, nights_count, fare_accommodation_adjusted, sub_total, source, status, created_at_guesty")
          .eq("listing_id", listingId).in("status", ["confirmed", "closed"]).neq("source", "owner")
          .or(`created_at_guesty.gte.${subYears(subDays(today, 90), 1).toISOString()},check_out.gte.${format(subDays(today, 3), "yyyy-MM-dd")}`)
          .limit(5000),
      ]);
      if (rv.error) throw rv.error;
      if (rs.error) throw rs.error;
      return { reviews: rv.data ?? [], reservations: (rs.data ?? []) as Res[] };
    },
  });

  const listing = listings.find((l) => l.id === listingId);
  const today = new Date();

  const stays = useMemo(() => {
    if (!data) return [];
    const from = format(subDays(today, 3), "yyyy-MM-dd");
    const to = format(addDays(today, 14), "yyyy-MM-dd");
    return data.reservations
      .filter((r) => r.check_out && r.check_in && r.check_out >= from && r.check_in <= to)
      .sort((a, b) => (a.check_in! < b.check_in! ? -1 : 1));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRes = stays.find((r) => r.id === resId);

  const result = useMemo(() => {
    if (!data || !listing) return null;
    const chReviews = data.reviews.filter((r) => r.source === channel);
    const avg = chReviews.length ? chReviews.reduce((t, r) => t + Number(r.rating), 0) / chReviews.length : null;
    let current = avg, count = chReviews.length;
    if (channel === "Airbnb" && listing.live_airbnb_rating) {
      current = Number(listing.live_airbnb_rating);
      count = Math.max(count, Number(listing.live_airbnb_review_count) || 0);
    }
    // Expected pickup on this channel for the next 30 days: last 90 days' bookings, or same window last year.
    const chRes = data.reservations.filter((r) => matchesChannel(r.source, channel) && r.created_at_guesty);
    const inWin = (from: Date, to: Date) => chRes.filter((r) => { const d = new Date(r.created_at_guesty!); return d >= from && d < to; })
      .reduce((t, r) => t + revOf(r), 0);
    const recent = inWin(subDays(today, 90), today);
    const lastYear = inWin(subYears(today, 1), subYears(addDays(today, 90), 1));
    const monthly = (recent || lastYear) / 3;
    const pickupSource = recent ? "last 90 days of bookings" : lastYear ? "same 90 days last year" : "no recent bookings";

    const s = Number(stars);
    if (current === null) return { current, count, monthly, pickupSource, noScore: true as const };
    const after = (current * count + s) / (count + 1);
    const cliffs = channel === "Airbnb" ? AIRBNB_CLIFFS : OTHER_CLIFFS;
    const crossed = cliffs.filter((c) => current >= c.t && after < c.t);
    const shield = shieldOf(count);
    const iss = ISSUES.find((i) => i.key === issue)!;
    const issueWeight = channel === "Airbnb" ? iss.weight : 1;
    const dispute = channel === "Airbnb" ? iss.dispute : 0;
    const drag = Math.min(0.5, (STAR_DRAG[s] * shield + crossed.reduce((t, c) => t + c.extra, 0)) * issueWeight);
    const gross = monthly * (IMPACT_DAYS / 30) * drag;
    const atRisk = gross * (1 - dispute);
    const stayTotal = selectedRes ? revOf(selectedRes) : null;
    const nightly = selectedRes && selectedRes.nights_count ? revOf(selectedRes) / selectedRes.nights_count : null;
    const cap = stayTotal !== null ? Math.min(atRisk, stayTotal) : atRisk;
    const level = atRisk >= 1000 || crossed.some((c) => c.t <= 4.8) ? "Severe" : atRisk >= 300 || crossed.length ? "Moderate" : "Low";
    const nextCliff = cliffs.filter((c) => after >= c.t).sort((a, b) => a.t - b.t)[0];
    return { current, count, after, crossed, shield, drag, gross, atRisk, dispute, cap, level, nightly, stayTotal, monthly, pickupSource, iss, nextCliff, noScore: false as const };
  }, [data, listing, channel, stars, issue, selectedRes]); // eslint-disable-line react-hooks/exhaustive-deps

  const recommendation = (() => {
    if (!result || result.noScore) return null;
    const { level, cap, nightly, dispute } = result;
    if (channel === "Airbnb" && dispute >= 0.5) return "Keep the gesture small (apology, small credit). Save every message — this kind of review has good odds of being removed.";
    if (level === "Severe") return `Worth going out of your way. Offer a meaningful refund${nightly ? ` (about 1 night ≈ ${money(nightly)})` : ""} — anything up to ${money(cap)} still pays for itself.`;
    if (level === "Moderate") return `A moderate gesture fits: refund a fee or part of a night, roughly ${money(Math.min(cap, Math.max(100, cap * 0.5)))}.`;
    return `Low impact. A sincere apology or a small courtesy (under ${money(Math.max(50, Math.min(cap, 100)))}) is enough — save refund budget for more exposed listings.`;
  })();

  const tone = result && !result.noScore ? (result.level === "Severe" ? "destructive" : result.level === "Moderate" ? "secondary" : "outline") : "outline";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> Review risk & concession calculator</CardTitle>
          <CardDescription>
            Estimate what a bad review from a current guest would cost this property, so you know how far to go to fix the stay.
            Airbnb includes issue type and Airbnb's score thresholds; VRBO and Booking.com use the property's score on that channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Property</Label>
            <Select value={listingId} onValueChange={(v) => { setListingId(v); setResId("none"); }}>
              <SelectTrigger><SelectValue placeholder="Search or pick a property" /></SelectTrigger>
              <SelectContent>
                {listings.map((l) => <SelectItem key={l.id} value={l.id}>{l.nickname || l.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Channel the review would post on</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Guest (current or upcoming stay)</Label>
            <Select value={resId} onValueChange={setResId} disabled={!listingId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific guest</SelectItem>
                {stays.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.guest_name || "Guest"} · {r.check_in} → {r.check_out} · {money(revOf(r))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">How bad is it?</Label>
            <Select value={stars} onValueChange={setStars}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITY.map((s) => <SelectItem key={s.stars} value={String(s.stars)}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {channel === "Airbnb" && (
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs">Issue type</Label>
              <Select value={issue} onValueChange={setIssue}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ISSUES.map((i) => <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {!listingId && <p className="text-sm text-muted-foreground">Pick a property to see the estimate.</p>}
      {listingId && isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading property data…</div>}

      {result?.noScore && (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">
          This property has no {channel} reviews yet, so there's no score to simulate. The first review will set the score entirely — treat any unhappy guest as high risk.
        </CardContent></Card>
      )}

      {result && !result.noScore && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card><CardHeader className="pb-2"><CardDescription>Risk level</CardDescription>
              <CardTitle className="flex items-center gap-2">
                {result.level === "Low" ? <ShieldCheck className="h-5 w-5 text-primary" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
                <Badge variant={tone as "destructive" | "secondary" | "outline"} className="text-base">{result.level}</Badge>
              </CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">{result.count} {channel} reviews on file</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription>{channel} score</CardDescription>
              <CardTitle>{result.current!.toFixed(2)} → <span className={result.crossed.length ? "text-destructive" : ""}>{result.after.toFixed(2)}</span></CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {result.crossed.length ? `Falls below ${result.crossed.map((c) => c.t.toFixed(2)).join(", ")}` :
                  result.nextCliff ? `${(result.after - result.nextCliff.t).toFixed(2)} above ${result.nextCliff.t.toFixed(2)} after this review` : "No threshold crossed"}
              </CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Estimated revenue at risk (next {IMPACT_DAYS} days)</CardDescription>
              <CardTitle className="text-destructive">−{money(result.atRisk)}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">≈ {(result.drag * 100).toFixed(0)}% fewer bookings on ~{money(result.monthly)}/mo ({result.pickupSource})</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Most it's worth spending</CardDescription>
              <CardTitle>{money(result.cap)}</CardTitle></CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {result.stayTotal !== null ? `Stay total ${money(result.stayTotal)}` : "Pick a guest to cap this at their stay total"}
              </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Recommendation</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="font-medium">{recommendation}</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {result.crossed.map((c) => <li key={c.t}>This review would push the score below the {c.label}.</li>)}
                <li>
                  Review count {result.count < 30 ? "is low, so one review moves the score a lot" : result.count >= 100 ? "is high, which cushions the score" : "gives moderate protection"}.
                </li>
                {channel === "Airbnb" && (
                  <>
                    <li>{result.iss.label}: {result.iss.note}</li>
                    <li>Chance of getting it removed: about {Math.round(result.dispute * 100)}% (already factored into the estimate).</li>
                  </>
                )}
                {channel !== "Airbnb" && <li>{channel} doesn't give category scores, so issue type isn't used — the estimate is based on the score change alone.</li>}
              </ul>
              <p className="text-xs text-muted-foreground">
                Estimates use the patterns from the Event Study tab (bigger drops for fewer reviews and for crossing 4.90 / 4.80 / 4.70). Treat them as a guide, not a guarantee.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

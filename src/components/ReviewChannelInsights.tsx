import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { subDays } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangeFilter, DateRange } from "@/components/DateRangeFilter";
import { PlatformIcon } from "@/components/icons/PlatformIcon";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/reports/format";
import { REVIEW_TOPICS, TOPIC_LABELS, classifyReviewText } from "@/lib/reviewTopics";
import { Star, Download, Loader2, AlertTriangle } from "lucide-react";

interface CategoryStat {
  category: string;
  avg_all: number | null;
  avg_sub5: number | null;
  sub5_hits: number;
  samples: number;
}

interface ChannelRow {
  source: string;
  total_reviews: number;
  avg_rating: number | null;
  five_star_count: number;
  sub_five_count: number;
  with_text_count: number;
  with_categories_count: number;
  category_stats: CategoryStat[];
}

interface CriticalReview {
  id: string;
  listing_id: string;
  source: string | null;
  rating: number | null;
  review_text: string | null;
  review_date: string | null;
  guest_name: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  cleanliness: "Cleanliness",
  communication: "Communication",
  checkin: "Check-in",
  accuracy: "Accuracy",
  location: "Location",
  value: "Value",
  respect_house_rules: "House rules",
};

const prettyCategory = (key: string) =>
  CATEGORY_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

export function ReviewChannelInsights() {
  const [selectedProperty, setSelectedProperty] = useState("all");
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 364),
    to: new Date(),
    preset: "last365",
  });

  const fromStr = dateRange.from.toISOString().split("T")[0];
  const toStr = dateRange.to.toISOString().split("T")[0];

  const { data: properties = [] } = useQuery({
    queryKey: ["listings", "insights-filter"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname")
        .order("nickname");
      if (error) throw error;
      return data || [];
    },

  });

  const listingNames = useMemo(
    () => new Map(properties.map((p) => [p.id, p.nickname || p.id])),
    [properties],
  );

  const { data: channels = [], isLoading: channelsLoading } = useQuery({
    queryKey: ["review-channel-insights", selectedProperty, fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_review_channel_insights", {
        p_listing_id: selectedProperty === "all" ? null : selectedProperty,
        p_start_date: fromStr,
        p_end_date: toStr,
      });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        ...row,
        avg_rating: row.avg_rating === null ? null : Number(row.avg_rating),
        category_stats: (row.category_stats || []) as CategoryStat[],
      })) as ChannelRow[];
    },
  });

  // Only sub-5-star reviews are pulled for text mining — keeps the payload small.
  const { data: criticalReviews = [], isLoading: textLoading } = useQuery({
    queryKey: ["review-critical-text", selectedProperty, fromStr, toStr],
    queryFn: async () => {
      const rows: CriticalReview[] = [];
      const BATCH = 1000;
      for (let offset = 0; offset < 20000; offset += BATCH) {
        let q = supabase
          .from("reviews")
          .select("id, listing_id, source, rating, review_text, review_date, guest_name")
          .eq("is_removed", false)
          .lt("rating", 5)
          .not("review_text", "is", null)
          .gte("review_date", fromStr)
          .lte("review_date", toStr)
          .order("review_date", { ascending: false })
          .range(offset, offset + BATCH - 1);
        if (selectedProperty !== "all") q = q.eq("listing_id", selectedProperty);

        const { data, error } = await q;
        if (error) throw error;
        rows.push(...((data || []) as CriticalReview[]));
        if (!data || data.length < BATCH) break;
      }
      return rows;
    },
  });

  const channelOptions = useMemo(() => channels.map((c) => c.source), [channels]);

  const visibleChannels = useMemo(
    () => (selectedChannel === "all" ? channels : channels.filter((c) => c.source === selectedChannel)),
    [channels, selectedChannel],
  );

  const scopedReviews = useMemo(
    () =>
      selectedChannel === "all"
        ? criticalReviews
        : criticalReviews.filter((r) => (r.source || "Unknown") === selectedChannel),
    [criticalReviews, selectedChannel],
  );

  // Rule-based topic classification of the critical review text.
  const classified = useMemo(
    () =>
      scopedReviews.map((r) => ({
        review: r,
        hits: classifyReviewText(r.review_text),
      })),
    [scopedReviews],
  );

  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { hits } of classified) {
      for (const h of hits) counts.set(h.topicKey, (counts.get(h.topicKey) || 0) + 1);
    }
    return REVIEW_TOPICS.map((t) => ({ key: t.key, label: t.label, count: counts.get(t.key) || 0 }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [classified]);

  // Topic counts split per channel, for the correlation table.
  const topicByChannel = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    const totals = new Map<string, number>();
    for (const { review, hits } of classified) {
      const src = review.source || "Unknown";
      totals.set(src, (totals.get(src) || 0) + 1);
      if (!map.has(src)) map.set(src, new Map());
      const inner = map.get(src)!;
      for (const h of hits) inner.set(h.topicKey, (inner.get(h.topicKey) || 0) + 1);
    }
    return { map, totals };
  }, [classified]);

  const filteredFeed = useMemo(() => {
    const list = activeTopic
      ? classified.filter((c) => c.hits.some((h) => h.topicKey === activeTopic))
      : classified.filter((c) => c.hits.length > 0);
    return list.slice(0, 100);
  }, [classified, activeTopic]);

  const propertyLeaderboard = useMemo(() => {
    const map = new Map<string, { total: number; topics: Map<string, number> }>();
    for (const { review, hits } of classified) {
      if (hits.length === 0) continue;
      if (activeTopic && !hits.some((h) => h.topicKey === activeTopic)) continue;
      if (!map.has(review.listing_id)) map.set(review.listing_id, { total: 0, topics: new Map() });
      const entry = map.get(review.listing_id)!;
      entry.total += 1;
      for (const h of hits) entry.topics.set(h.topicKey, (entry.topics.get(h.topicKey) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([listingId, v]) => ({
        listingId,
        name: listingNames.get(listingId) || listingId,
        total: v.total,
        topTopics: Array.from(v.topics.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [classified, activeTopic, listingNames]);

  const handleExport = () => {
    const header = ["Date", "Channel", "Property", "Guest", "Rating", "Topics", "Keywords", "Snippet"];
    const rows: string[][] = classified
      .filter((c) => c.hits.length > 0)
      .map(({ review, hits }) => [
        fmtDate(review.review_date),
        review.source || "Unknown",
        listingNames.get(review.listing_id) || review.listing_id,
        review.guest_name || "",
        review.rating != null ? String(review.rating) : "",
        hits.map((h) => TOPIC_LABELS[h.topicKey]).join(" | "),
        hits.flatMap((h) => h.matchedKeywords).slice(0, 8).join("; "),
        hits[0]?.snippet || "",
      ]);
    downloadCsv("review-issue-analysis.csv", [header, ...rows]);

  };

  const loading = channelsLoading || textLoading;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          <CardDescription>
            Break ratings down by booking channel and find the issues behind them
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Select value={selectedProperty} onValueChange={setSelectedProperty}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="All properties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Properties</SelectItem>
              {properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nickname || p.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedChannel} onValueChange={setSelectedChannel}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              {channelOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          <Button variant="outline" onClick={handleExport} disabled={loading} className="ml-auto">
            <Download className="mr-2 h-4 w-4" />
            Export issues
          </Button>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing reviews…
        </div>
      )}

      {!loading && channels.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No reviews found for this period.
          </CardContent>
        </Card>
      )}

      {!loading && channels.length > 0 && (
        <>
          {/* Channel scorecards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleChannels.map((c) => {
              const fivePct = c.total_reviews ? (c.five_star_count / c.total_reviews) * 100 : 0;
              const subPct = c.total_reviews ? (c.sub_five_count / c.total_reviews) * 100 : 0;
              return (
                <Card key={c.source}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PlatformIcon platform={c.source} className="h-4 w-4" />
                      {c.source}
                    </CardTitle>
                    <CardDescription>{c.total_reviews.toLocaleString()} reviews</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold">{c.avg_rating?.toFixed(2) ?? "—"}</span>
                      <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">5-star share</span>
                        <span className="font-medium">{fivePct.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-yellow-400" style={{ width: `${fivePct}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Below 5 stars</span>
                      <Badge variant={subPct > 30 ? "destructive" : "secondary"}>
                        {c.sub_five_count.toLocaleString()} · {subPct.toFixed(1)}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.with_categories_count > 0
                        ? `${c.with_categories_count.toLocaleString()} with category scorecards`
                        : "No category scorecards from this channel — text analysis only"}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Why isn't it 5 stars — category drag */}
          {visibleChannels.some((c) => c.category_stats.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Why isn't it 5 stars?</CardTitle>
                <CardDescription>
                  For reviews below 5 stars, which sub-scores are dragging the rating down
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {visibleChannels
                  .filter((c) => c.category_stats.length > 0)
                  .map((c) => {
                    const stats = [...c.category_stats].sort((a, b) => b.sub5_hits - a.sub5_hits);
                    const max = Math.max(...stats.map((s) => s.sub5_hits), 1);
                    return (
                      <div key={c.source} className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <PlatformIcon platform={c.source} className="h-4 w-4" />
                          {c.source}
                        </div>
                        {stats.map((s) => (
                          <div key={s.category} className="flex items-center gap-3">
                            <span className="w-32 shrink-0 text-sm">{prettyCategory(s.category)}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full bg-destructive/70"
                                style={{ width: `${(s.sub5_hits / max) * 100}%` }}
                              />
                            </div>
                            <span className="w-40 shrink-0 text-right text-xs text-muted-foreground">
                              {s.sub5_hits.toLocaleString()} low scores · avg{" "}
                              {s.avg_sub5 != null ? Number(s.avg_sub5).toFixed(2) : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          )}

          {/* Topic mining */}
          <Card>
            <CardHeader>
              <CardTitle>What guests actually complain about</CardTitle>
              <CardDescription>
                {scopedReviews.length.toLocaleString()} reviews below 5 stars scanned. Select a topic to
                drill in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={activeTopic === null ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setActiveTopic(null)}
                >
                  All topics
                </Badge>
                {topicCounts.map((t) => (
                  <Badge
                    key={t.key}
                    variant={activeTopic === t.key ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setActiveTopic(activeTopic === t.key ? null : t.key)}
                  >
                    {t.label} ({t.count.toLocaleString()})
                  </Badge>
                ))}
                {topicCounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No recurring themes detected in this period.
                  </p>
                )}
              </div>

              {/* Channel correlation */}
              {topicCounts.length > 0 && selectedChannel === "all" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-4 font-medium">Topic</th>
                        {channels.map((c) => (
                          <th key={c.source} className="py-2 pr-4 text-right font-medium">
                            {c.source}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {topicCounts.map((t) => (
                        <tr key={t.key} className="border-b last:border-0">
                          <td className="py-2 pr-4">{t.label}</td>
                          {channels.map((c) => {
                            const n = topicByChannel.map.get(c.source)?.get(t.key) || 0;
                            const total = topicByChannel.totals.get(c.source) || 0;
                            const pct = total ? (n / total) * 100 : 0;
                            return (
                              <td key={c.source} className="py-2 pr-4 text-right">
                                {n === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span className={pct >= 25 ? "font-semibold text-destructive" : ""}>
                                    {pct.toFixed(0)}%{" "}
                                    <span className="text-xs text-muted-foreground">({n})</span>
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Share of each channel's below-5-star reviews that mention the topic.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Property leaderboard */}
          {propertyLeaderboard.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Properties to look at
                </CardTitle>
                <CardDescription>
                  Most flagged reviews {activeTopic ? `for ${TOPIC_LABELS[activeTopic]}` : "overall"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {propertyLeaderboard.map((p) => (
                    <div
                      key={p.listingId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <Link
                        to={`/listings/${p.listingId}`}
                        className="font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        {p.topTopics.map(([key, n]) => (
                          <Badge key={key} variant="outline">
                            {TOPIC_LABELS[key]} · {n}
                          </Badge>
                        ))}
                        <Badge variant="secondary">{p.total} flagged</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Review feed */}
          <Card>
            <CardHeader>
              <CardTitle>
                {activeTopic ? TOPIC_LABELS[activeTopic] : "Flagged"} feedback
              </CardTitle>
              <CardDescription>
                Showing {filteredFeed.length} of the most recent matching reviews
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredFeed.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing matches this selection.</p>
              )}
              {filteredFeed.map(({ review, hits }) => (
                <div key={review.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <PlatformIcon platform={review.source || "Unknown"} className="h-4 w-4" />
                    <Link
                      to={`/listings/${review.listing_id}`}
                      className="font-medium hover:underline"
                    >
                      {listingNames.get(review.listing_id) || review.listing_id}
                    </Link>
                    <Badge variant="secondary">{review.rating ?? "—"}★</Badge>
                    <span className="text-muted-foreground">
                      {review.guest_name || "Guest"} · {fmtDate(review.review_date)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {hits.find((h) => h.topicKey === activeTopic)?.snippet || hits[0]?.snippet}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {hits.map((h) => (
                      <Badge key={h.topicKey} variant="outline" className="text-xs">
                        {TOPIC_LABELS[h.topicKey]}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

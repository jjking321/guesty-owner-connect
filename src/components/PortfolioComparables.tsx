import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bed, Bath, Users, Plus, Trash2, Wand2, Pin, PinOff, Building2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  suggestPeers,
  amenityBadges,
  average,
  median,
  type PortfolioListing,
  type PeerMetrics,
} from "@/lib/portfolioComps";

interface PortfolioComparablesProps {
  listingId: string;
}

const fmtMoney = (v: number | null | undefined) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toFixed(1)}%`;

export function PortfolioComparables({ listingId }: PortfolioComparablesProps) {
  const queryClient = useQueryClient();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [listingToAdd, setListingToAdd] = useState("");

  const { data: listings, isLoading: listingsLoading } = useQuery({
    queryKey: ["portfolio-listings-for-comps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, bedrooms, bathrooms, accommodates, property_type, amenities, address, thumbnail, is_listed")
        .eq("archived", false)
        .order("nickname");
      if (error) throw error;
      return (data || []) as unknown as PortfolioListing[];
    },
  });

  const { data: peerRows, isLoading: peersLoading } = useQuery({
    queryKey: ["portfolio-comparables", listingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_comparables")
        .select("id, peer_listing_id, is_pinned, match_score, created_at")
        .eq("listing_id", listingId)
        .order("is_pinned", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const peerIds = useMemo(() => (peerRows || []).map((p) => p.peer_listing_id), [peerRows]);

  const { data: metrics } = useQuery({
    queryKey: ["portfolio-peer-metrics", listingId, peerIds.join(",")],
    enabled: peerIds.length > 0 || !!listingId,
    queryFn: async () => {
      const ids = Array.from(new Set([listingId, ...peerIds]));
      const { data, error } = await supabase.rpc("get_portfolio_peer_metrics", {
        p_listing_ids: ids,
      });
      if (error) throw error;
      const map = new Map<string, PeerMetrics>();
      (data || []).forEach((row: any) => map.set(row.listing_id, row as PeerMetrics));
      return map;
    },
  });

  const subject = useMemo(
    () => (listings || []).find((l) => l.id === listingId) || null,
    [listings, listingId],
  );

  const peerListings = useMemo(
    () =>
      (peerRows || [])
        .map((row) => {
          const listing = (listings || []).find((l) => l.id === row.peer_listing_id);
          return listing ? { row, listing } : null;
        })
        .filter(Boolean) as { row: any; listing: PortfolioListing }[],
    [peerRows, listings],
  );

  const suggestions = useMemo(() => {
    if (!subject || !listings) return [];
    const pool = listings.filter((l) => l.is_listed !== false && !peerIds.includes(l.id));
    return suggestPeers(subject, pool, 8);
  }, [subject, listings, peerIds]);

  const addPeers = useMutation({
    mutationFn: async (rows: { peer_listing_id: string; match_score?: number | null; match_reasons?: any }[]) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("portfolio_comparables").upsert(
        rows.map((r) => ({
          listing_id: listingId,
          peer_listing_id: r.peer_listing_id,
          match_score: r.match_score ?? null,
          match_reasons: r.match_reasons ?? null,
          created_by: userData?.user?.id ?? null,
        })),
        { onConflict: "listing_id,peer_listing_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-comparables", listingId] });
      toast.success("Peer properties added");
    },
    onError: (e: any) => toast.error(e.message || "Could not add peer"),
  });

  const removePeer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolio_comparables").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-comparables", listingId] });
      toast.success("Peer removed");
    },
    onError: (e: any) => toast.error(e.message || "Could not remove peer"),
  });

  const togglePin = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from("portfolio_comparables")
        .update({ is_pinned: pinned })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["portfolio-comparables", listingId] }),
  });

  const summary = useMemo(() => {
    if (!metrics) return null;
    const rows = peerListings
      .map(({ listing }) => metrics.get(listing.id))
      .filter(Boolean) as PeerMetrics[];
    if (!rows.length) return null;
    return {
      count: rows.length,
      avgAdr: average(rows.map((r) => Number(r.ttm_adr)).filter((n) => Number.isFinite(n))),
      medAdr: median(rows.map((r) => Number(r.ttm_adr)).filter((n) => Number.isFinite(n))),
      avgOcc: average(rows.map((r) => Number(r.ttm_occupancy)).filter((n) => Number.isFinite(n))),
      avgRevenue: average(rows.map((r) => Number(r.ttm_revenue)).filter((n) => Number.isFinite(n))),
      avgAsking: average(rows.map((r) => Number(r.future_asking_adr)).filter((n) => Number.isFinite(n))),
    };
  }, [metrics, peerListings]);

  const subjectMetrics = metrics?.get(listingId);

  const addOptions = useMemo(
    () =>
      (listings || [])
        .filter((l) => l.id !== listingId && !peerIds.includes(l.id))
        .map((l) => ({
          value: l.id,
          label: `${l.nickname || l.id}${l.bedrooms != null ? ` · ${l.bedrooms} BR` : ""}`,
        })),
    [listings, listingId, peerIds],
  );

  const loading = listingsLoading || peersLoading;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Portfolio Peers
            </CardTitle>
            <CardDescription>
              Similar properties from your own portfolio, benchmarked on live PMS data.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSuggestions((s) => !s)}
              disabled={loading || !subject}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              {showSuggestions ? "Hide suggestions" : "Auto-suggest peers"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Add by search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[260px] flex-1">
            <SearchableSelect
              value={listingToAdd}
              onValueChange={setListingToAdd}
              options={addOptions}
              placeholder="Search your properties to add a peer..."
              searchPlaceholder="Search by name..."
              emptyMessage="No properties found."
            />
          </div>
          <Button
            size="sm"
            disabled={!listingToAdd || addPeers.isPending}
            onClick={() => {
              addPeers.mutate([{ peer_listing_id: listingToAdd }]);
              setListingToAdd("");
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add peer
          </Button>
        </div>

        {/* Suggestions */}
        {showSuggestions && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">
                Suggested peers{subject?.bedrooms != null ? ` for ${subject.bedrooms} BR` : ""}
                {subject && amenityBadges(subject.amenities).length > 0
                  ? ` · ${amenityBadges(subject.amenities).join(", ")}`
                  : ""}
              </p>
              {suggestions.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    addPeers.mutate(
                      suggestions.slice(0, 5).map((s) => ({
                        peer_listing_id: s.listing.id,
                        match_score: s.score,
                        match_reasons: s.reasons,
                      })),
                    )
                  }
                >
                  Add top 5
                </Button>
              )}
            </div>

            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No close matches found. Amenities may still need to sync from Guesty, or try adding peers manually.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <div
                    key={s.listing.id}
                    className="flex items-start justify-between gap-3 rounded-md border bg-background p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.listing.nickname || s.listing.id}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.reasons.slice(0, 4).map((r) => (
                          <Badge key={r} variant="secondary" className="text-xs">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        addPeers.mutate([
                          { peer_listing_id: s.listing.id, match_score: s.score, match_reasons: s.reasons },
                        ])
                      }
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Peer avg ADR", value: fmtMoney(summary.avgAdr), sub: `median ${fmtMoney(summary.medAdr)}` },
              { label: "Peer avg occupancy", value: fmtPct(summary.avgOcc), sub: "trailing 12 months" },
              { label: "Peer avg revenue", value: fmtMoney(summary.avgRevenue), sub: "trailing 12 months" },
              { label: "Peer forward ADR", value: fmtMoney(summary.avgAsking), sub: "next 90 days asking" },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-semibold">{card.value}</p>
                <p className="text-xs text-muted-foreground">{card.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Peers table */}
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : peerListings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No portfolio peers yet. Use auto-suggest or search above to add similar properties.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Key amenities</TableHead>
                  <TableHead className="text-right">TTM revenue</TableHead>
                  <TableHead className="text-right">TTM ADR</TableHead>
                  <TableHead className="text-right">Occupancy</TableHead>
                  <TableHead className="text-right">Last 30d ADR</TableHead>
                  <TableHead className="text-right">Fwd 90d ADR</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subject && (
                  <TableRow className="bg-muted/40 font-medium">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {subject.nickname || subject.id}
                        <Badge variant="outline" className="text-xs">This property</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Bed className="h-3 w-3" />{subject.bedrooms ?? "—"}</span>
                        <span className="flex items-center gap-1"><Bath className="h-3 w-3" />{subject.bathrooms ?? "—"}</span>
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{subject.accommodates ?? "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {amenityBadges(subject.amenities).map((a) => (
                          <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(subjectMetrics?.ttm_revenue)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(subjectMetrics?.ttm_adr)}</TableCell>
                    <TableCell className="text-right">{fmtPct(subjectMetrics?.ttm_occupancy)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(subjectMetrics?.last30_adr)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(subjectMetrics?.future_asking_adr)}</TableCell>
                    <TableCell />
                  </TableRow>
                )}

                {peerListings.map(({ row, listing }) => {
                  const m = metrics?.get(listing.id);
                  const adrDelta =
                    m?.ttm_adr != null && subjectMetrics?.ttm_adr != null && Number(subjectMetrics.ttm_adr) > 0
                      ? ((Number(m.ttm_adr) - Number(subjectMetrics.ttm_adr)) / Number(subjectMetrics.ttm_adr)) * 100
                      : null;

                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {listing.nickname || listing.id}
                          {row.is_pinned && <Pin className="h-3 w-3 text-primary" />}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Bed className="h-3 w-3" />{listing.bedrooms ?? "—"}</span>
                          <span className="flex items-center gap-1"><Bath className="h-3 w-3" />{listing.bathrooms ?? "—"}</span>
                          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{listing.accommodates ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {amenityBadges(listing.amenities).map((a) => (
                            <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{fmtMoney(m?.ttm_revenue)}</TableCell>
                      <TableCell className="text-right">
                        <div>{fmtMoney(m?.ttm_adr)}</div>
                        {adrDelta != null && (
                          <div
                            className={cn(
                              "text-xs",
                              adrDelta >= 0 ? "text-emerald-600" : "text-destructive",
                            )}
                          >
                            {adrDelta >= 0 ? "+" : ""}
                            {adrDelta.toFixed(1)}%
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{fmtPct(m?.ttm_occupancy)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(m?.last30_adr)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(m?.future_asking_adr)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => togglePin.mutate({ id: row.id, pinned: !row.is_pinned })}
                            title={row.is_pinned ? "Unpin" : "Pin"}
                          >
                            {row.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removePeer.mutate(row.id)}
                            title="Remove peer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Wand2, X, Check, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  PortfolioListing,
  StayProfile,
  Suggestion,
  suggestPeers,
  stayTierOf,
  stayTierLabel,
  cityLabel,
} from "@/lib/portfolioComps";

interface ExistingPeer {
  listing_id: string;
  peer_listing_id: string;
}

export function BulkPortfolioPeers() {
  const queryClient = useQueryClient();
  const [targetCount, setTargetCount] = useState(5);
  const [minScore, setMinScore] = useState(40);
  const [onlyNeedy, setOnlyNeedy] = useState(true);
  const [search, setSearch] = useState("");
  const [removed, setRemoved] = useState<Record<string, Set<string>>>({});
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const { data: listings, isLoading: l1 } = useQuery({
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

  const { data: existing, isLoading: l2 } = useQuery({
    queryKey: ["portfolio-comparables-all"],
    queryFn: async () => {
      const all: ExistingPeer[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("portfolio_comparables")
          .select("listing_id, peer_listing_id")
          .range(from, from + 999);
        if (error) throw error;
        all.push(...((data || []) as ExistingPeer[]));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });

  const { data: stayProfiles, isLoading: l3 } = useQuery({
    queryKey: ["listing-stay-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_listing_stay_profiles", { p_listing_ids: null });
      if (error) throw error;
      const map = new Map<string, StayProfile>();
      (data || []).forEach((row: any) => map.set(row.listing_id, row as StayProfile));
      return map;
    },
  });

  const existingMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    (existing || []).forEach((e) => {
      if (!m.has(e.listing_id)) m.set(e.listing_id, new Set());
      m.get(e.listing_id)!.add(e.peer_listing_id);
    });
    return m;
  }, [existing]);

  const proposals = useMemo(() => {
    if (!listings || !stayProfiles) return [];
    const active = listings.filter((l) => l.is_listed !== false);
    const q = search.trim().toLowerCase();
    return active
      .filter((l) => !q || (l.nickname || "").toLowerCase().includes(q))
      .map((subject) => {
        const have = existingMap.get(subject.id) || new Set<string>();
        const needed = Math.max(0, targetCount - have.size);
        const pool = active.filter((c) => !have.has(c.id));
        const suggestions: Suggestion[] =
          needed > 0
            ? suggestPeers(subject, pool, needed, stayProfiles).filter((s) => s.score >= minScore)
            : [];
        return { subject, haveCount: have.size, needed, suggestions };
      })
      .filter((p) => (onlyNeedy ? p.needed > 0 : true));
  }, [listings, stayProfiles, existingMap, targetCount, minScore, onlyNeedy, search]);

  const visibleSuggestions = (p: (typeof proposals)[number]) =>
    p.suggestions.filter((s) => !removed[p.subject.id]?.has(s.listing.id));

  const selected = proposals.filter((p) => !unchecked.has(p.subject.id) && visibleSuggestions(p).length > 0);
  const totalLinks = selected.reduce((sum, p) => sum + visibleSuggestions(p).length, 0);

  const save = useMutation({
    mutationFn: async (items: typeof proposals) => {
      const { data: userData } = await supabase.auth.getUser();
      const rows = items.flatMap((p) =>
        visibleSuggestions(p).map((s) => ({
          listing_id: p.subject.id,
          peer_listing_id: s.listing.id,
          match_score: s.score,
          match_reasons: s.reasons,
          created_by: userData?.user?.id ?? null,
        })),
      );
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from("portfolio_comparables")
          .upsert(rows.slice(i, i + 500), { onConflict: "listing_id,peer_listing_id" });
        if (error) throw error;
      }
      return { links: rows.length, properties: items.length };
    },
    onSuccess: ({ links, properties }) => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-comparables-all"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-comparables"] });
      setRemoved({});
      setUnchecked(new Set());
      toast.success(`Saved ${links} peers across ${properties} properties`);
    },
    onError: (e: any) => toast.error(e.message || "Could not save peers"),
  });

  const removeSuggestion = (subjectId: string, peerId: string) =>
    setRemoved((prev) => {
      const next = { ...prev, [subjectId]: new Set(prev[subjectId] || []) };
      next[subjectId].add(peerId);
      return next;
    });

  const toggle = (id: string) =>
    setUnchecked((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const loading = l1 || l2 || l3;
  const withPeers = (listings || []).filter((l) => l.is_listed !== false && (existingMap.get(l.id)?.size || 0) >= targetCount).length;
  const activeCount = (listings || []).filter((l) => l.is_listed !== false).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="w-5 h-5" /> Portfolio Peers — Bulk Assign
        </CardTitle>
        <CardDescription>
          Review suggested peers from your own properties for every listing, remove any that don't fit, then confirm them all at once.
          {activeCount > 0 && ` ${withPeers} of ${activeCount} active properties already have ${targetCount}+ peers.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="peer-target">Peers per property</Label>
            <Input id="peer-target" type="number" min={1} max={15} className="w-24" value={targetCount}
              onChange={(e) => setTargetCount(Math.min(15, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="peer-min">Minimum match score</Label>
            <Input id="peer-min" type="number" min={0} max={200} className="w-24" value={minScore}
              onChange={(e) => setMinScore(Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="peer-search">Search</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input id="peer-search" className="pl-8 w-56" placeholder="Property name" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="peer-needy" checked={onlyNeedy} onCheckedChange={setOnlyNeedy} />
            <Label htmlFor="peer-needy">Only properties missing peers</Label>
          </div>
          <div className="ml-auto">
            <Button disabled={!totalLinks || save.isPending} onClick={() => save.mutate(selected)}>
              {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Confirm {totalLinks} peers for {selected.length} properties
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Every property already has enough peers.</p>
        ) : (
          <div className="border rounded-md max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Property</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Suggested peers (click × to remove)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => {
                  const vis = visibleSuggestions(p);
                  const tier = stayTierOf(stayProfiles?.get(p.subject.id)?.typical_min_nights ?? null);
                  return (
                    <TableRow key={p.subject.id}>
                      <TableCell>
                        <Checkbox checked={!unchecked.has(p.subject.id) && vis.length > 0} disabled={!vis.length}
                          onCheckedChange={() => toggle(p.subject.id)} />
                      </TableCell>
                      <TableCell className="min-w-[200px]">
                        <Link to={`/properties/${p.subject.id}`} className="font-medium hover:underline">
                          {p.subject.nickname || p.subject.id}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {p.subject.bedrooms ?? "?"} BR · {stayTierLabel(tier)} · {cityLabel(p.subject)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.haveCount >= targetCount ? "default" : "secondary"}>{p.haveCount}/{targetCount}</Badge>
                      </TableCell>
                      <TableCell>
                        {vis.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {p.needed === 0 ? "Complete" : "No matches above the minimum score"}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {vis.map((s) => (
                              <Badge key={s.listing.id} variant="outline" className="gap-1 pr-1" title={s.reasons.join(" · ")}>
                                {s.listing.nickname || s.listing.id}
                                <span className="text-muted-foreground">({s.score})</span>
                                <button type="button" aria-label={`Remove ${s.listing.nickname}`}
                                  onClick={() => removeSuggestion(p.subject.id, s.listing.id)}
                                  className="rounded hover:bg-muted p-0.5">
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
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

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Loader2, Copy, CheckCircle2, AlertCircle, Search } from "lucide-react";

interface CopyGoalsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingIds: string[];
  groupName: string;
  onSuccess?: () => void;
}

export function CopyGoalsDialog({
  open,
  onOpenChange,
  listingIds,
  groupName,
  onSuccess,
}: CopyGoalsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState(currentYear);
  const [sourceListingId, setSourceListingId] = useState<string | null>(null);
  const [targetListingIds, setTargetListingIds] = useState<string[]>([]);
  const [skipLocked, setSkipLocked] = useState(true);
  const [isCopying, setIsCopying] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");

  // Fetch listing details
  const { data: listings } = useQuery({
    queryKey: ["copy-goals-listings", listingIds],
    queryFn: async () => {
      if (listingIds.length === 0) return [];
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, is_composite")
        .in("id", listingIds)
        .eq("is_composite", false) // Exclude composite listings
        .order("nickname");
      if (error) throw error;
      return data || [];
    },
    enabled: open && listingIds.length > 0,
  });

  // Fetch all goals for the year (batched for large portfolios)
  const { data: goalsData } = useQuery({
    queryKey: ["copy-goals-data", listingIds, year],
    queryFn: async () => {
      if (listingIds.length === 0) return [];
      const BATCH_SIZE = 60;
      const chunks: string[][] = [];
      for (let i = 0; i < listingIds.length; i += BATCH_SIZE) {
        chunks.push(listingIds.slice(i, i + BATCH_SIZE));
      }
      const promises = chunks.map((batch) =>
        supabase
          .from("property_goals")
          .select("listing_id, month, projection_revenue, locked")
          .in("listing_id", batch)
          .eq("year", year)
      );
      const results = await Promise.all(promises);
      const all: any[] = [];
      for (const res of results) {
        if (res.error) throw res.error;
        if (res.data) all.push(...res.data);
      }
      return all;
    },
    enabled: open && listingIds.length > 0,
  });

  // Calculate goals summary per listing
  const listingsWithGoals = useMemo(() => {
    if (!listings || !goalsData) return [];

    return listings.map((listing) => {
      const listingGoals = goalsData.filter((g) => g.listing_id === listing.id);
      const totalGoal = listingGoals.reduce(
        (sum, g) => sum + (Number(g.projection_revenue) || 0),
        0
      );
      const hasGoals = listingGoals.length > 0;
      const lockedMonths = listingGoals.filter((g) => g.locked).length;

      return {
        ...listing,
        totalGoal,
        hasGoals,
        monthsWithGoals: listingGoals.length,
        lockedMonths,
      };
    });
  }, [listings, goalsData]);

  // Filter listings with goals for source selection
  const sourceOptions = listingsWithGoals.filter((l) => l.hasGoals);

  // Filter target options (exclude source)
  const targetOptions = listingsWithGoals.filter(
    (l) => l.id !== sourceListingId
  );

  const handleSelectAll = () => {
    setTargetListingIds(targetOptions.map((l) => l.id));
  };

  const handleDeselectAll = () => {
    setTargetListingIds([]);
  };

  const handleTargetToggle = (listingId: string) => {
    setTargetListingIds((prev) =>
      prev.includes(listingId)
        ? prev.filter((id) => id !== listingId)
        : [...prev, listingId]
    );
  };

  const handleCopy = async () => {
    if (!sourceListingId || targetListingIds.length === 0) return;

    setIsCopying(true);
    try {
      // Get source goals
      const sourceGoals = goalsData?.filter(
        (g) => g.listing_id === sourceListingId
      ) || [];

      if (sourceGoals.length === 0) {
        toast({
          title: "No goals to copy",
          description: "The source property has no goals for this year.",
          variant: "destructive",
        });
        return;
      }

      // Build locked months map for targets if skipLocked is enabled
      const lockedMonthsMap = new Map<string, Set<number>>();
      if (skipLocked) {
        goalsData
          ?.filter((g) => targetListingIds.includes(g.listing_id) && g.locked)
          .forEach((g) => {
            if (!lockedMonthsMap.has(g.listing_id)) {
              lockedMonthsMap.set(g.listing_id, new Set());
            }
            lockedMonthsMap.get(g.listing_id)!.add(g.month);
          });
      }

      // Create upsert records
      const upserts = targetListingIds.flatMap((targetId) => {
        const lockedMonths = lockedMonthsMap.get(targetId) || new Set();

        return sourceGoals
          .filter((goal) => !skipLocked || !lockedMonths.has(goal.month))
          .map((goal) => ({
            listing_id: targetId,
            year: year,
            month: goal.month,
            projection_revenue: goal.projection_revenue,
            locked: false, // Don't lock copied goals
          }));
      });

      if (upserts.length === 0) {
        toast({
          title: "No goals copied",
          description: "All target months are locked.",
          variant: "destructive",
        });
        return;
      }

      // Upsert goals
      const { error } = await supabase
        .from("property_goals")
        .upsert(upserts, { onConflict: "listing_id,year,month" });

      if (error) throw error;

      toast({
        title: "Goals copied successfully",
        description: `Copied ${sourceGoals.length} months to ${targetListingIds.length} properties (${upserts.length} total updates).`,
      });

      // Invalidate queries and close
      queryClient.invalidateQueries({ queryKey: ["group-goals"] });
      queryClient.invalidateQueries({ queryKey: ["copy-goals-data"] });
      onSuccess?.();
      onOpenChange(false);

      // Reset state
      setSourceListingId(null);
      setTargetListingIds([]);
    } catch (error: any) {
      toast({
        title: "Failed to copy goals",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCopying(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Copy Goals - {groupName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {/* Year Selection */}
          <div className="flex items-center gap-4">
            <Label>Year:</Label>
            <Select
              value={year.toString()}
              onValueChange={(v) => {
                setYear(parseInt(v));
                setSourceListingId(null);
                setTargetListingIds([]);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Step 1: Select Source */}
          <div className="space-y-3">
            <Label className="text-base font-medium">
              Step 1: Select Source Property
            </Label>
            {sourceOptions.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground p-4 border rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span>No properties have goals for {year}</span>
              </div>
            ) : (
              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {sourceOptions.map((listing) => (
                    <div
                      key={listing.id}
                      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                        sourceListingId === listing.id
                          ? "bg-primary/10 border border-primary"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => {
                        setSourceListingId(listing.id);
                        // Remove source from targets if it was selected
                        setTargetListingIds((prev) =>
                          prev.filter((id) => id !== listing.id)
                        );
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            sourceListingId === listing.id
                              ? "border-primary bg-primary"
                              : "border-muted-foreground"
                          }`}
                        >
                          {sourceListingId === listing.id && (
                            <div className="w-2 h-2 rounded-full bg-white" />
                          )}
                        </div>
                        <span className="font-medium">
                          {listing.nickname || "Unnamed Property"}
                        </span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatCurrency(listing.totalGoal)} ({listing.monthsWithGoals} months)
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Step 2: Select Targets */}
          {sourceListingId && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">
                  Step 2: Select Target Properties ({targetOptions.length} available)
                </Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeselectAll}
                  >
                    Deselect All
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-48 border rounded-lg">
                <div className="p-2 space-y-1">
                  {targetOptions.map((listing) => (
                    <div
                      key={listing.id}
                      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted ${
                        targetListingIds.includes(listing.id)
                          ? "bg-primary/5"
                          : ""
                      }`}
                      onClick={() => handleTargetToggle(listing.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={targetListingIds.includes(listing.id)}
                          onCheckedChange={() => handleTargetToggle(listing.id)}
                        />
                        <span className="font-medium">
                          {listing.nickname || "Unnamed Property"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {listing.hasGoals ? (
                          <>
                            <span>{formatCurrency(listing.totalGoal)}</span>
                            {listing.lockedMonths > 0 && (
                              <span className="text-orange-500">
                                ({listing.lockedMonths} locked)
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground/60">
                            No goals
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Skip Locked Option */}
              <div className="flex items-center gap-2 pt-2">
                <Checkbox
                  id="skip-locked"
                  checked={skipLocked}
                  onCheckedChange={(checked) => setSkipLocked(checked as boolean)}
                />
                <Label htmlFor="skip-locked" className="cursor-pointer">
                  Skip locked goals on target properties
                </Label>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCopy}
            disabled={
              !sourceListingId ||
              targetListingIds.length === 0 ||
              isCopying
            }
          >
            {isCopying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Copying...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Copy Goals ({targetListingIds.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

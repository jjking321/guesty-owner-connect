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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, CheckCircle2, AlertCircle, Search } from "lucide-react";

interface CopyGoalsFromPropertyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetListingId: string;
  targetListingName: string;
  onSuccess?: () => void;
}

export function CopyGoalsFromPropertyDialog({
  open,
  onOpenChange,
  targetListingId,
  targetListingName,
  onSuccess,
}: CopyGoalsFromPropertyDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState(currentYear);
  const [sourceListingId, setSourceListingId] = useState<string | null>(null);
  const [skipLocked, setSkipLocked] = useState(true);
  const [isCopying, setIsCopying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch all non-composite, non-archived listings (except the target)
  const { data: listings } = useQuery({
    queryKey: ["copy-goals-all-listings", targetListingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, guesty_account_id")
        .eq("is_composite", false)
        .eq("archived", false)
        .neq("id", targetListingId)
        .order("nickname");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  // Fetch goals for all listings for the selected year
  const { data: goalsData } = useQuery({
    queryKey: ["copy-goals-all-data", year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_goals")
        .select("listing_id, month, projection_revenue, locked")
        .eq("year", year);
      if (error) throw error;
      return data || [];
    },
    enabled: open,
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

      return {
        ...listing,
        totalGoal,
        hasGoals,
        monthsWithGoals: listingGoals.length,
      };
    });
  }, [listings, goalsData]);

  // Filter listings with goals for source selection
  const sourceOptions = useMemo(() => {
    const filtered = listingsWithGoals.filter((l) => l.hasGoals);
    if (!searchQuery) return filtered;
    return filtered.filter((l) =>
      (l.nickname || "").toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [listingsWithGoals, searchQuery]);

  // Get target's locked months
  const targetLockedMonths = useMemo(() => {
    if (!goalsData) return new Set<number>();
    return new Set(
      goalsData
        .filter((g) => g.listing_id === targetListingId && g.locked)
        .map((g) => g.month)
    );
  }, [goalsData, targetListingId]);

  const handleCopy = async () => {
    if (!sourceListingId) return;

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

      // Filter out locked months if skip option is enabled
      const goalsToUpsert = sourceGoals
        .filter((goal) => !skipLocked || !targetLockedMonths.has(goal.month))
        .map((goal) => ({
          listing_id: targetListingId,
          year: year,
          month: goal.month,
          projection_revenue: goal.projection_revenue,
          locked: false,
        }));

      if (goalsToUpsert.length === 0) {
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
        .upsert(goalsToUpsert, { onConflict: "listing_id,year,month" });

      if (error) throw error;

      toast({
        title: "Goals copied successfully",
        description: `Copied ${goalsToUpsert.length} months of goals.`,
      });

      // Invalidate queries and close
      queryClient.invalidateQueries({ queryKey: ["property-goals"] });
      queryClient.invalidateQueries({ queryKey: ["copy-goals-all-data"] });
      onSuccess?.();
      onOpenChange(false);

      // Reset state
      setSourceListingId(null);
      setSearchQuery("");
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
      <DialogContent className="max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Copy Goals to {targetListingName}
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

          {/* Source Selection */}
          <div className="space-y-3">
            <Label className="text-base font-medium">
              Select Source Property
            </Label>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search properties..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {sourceOptions.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground p-4 border rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {searchQuery
                    ? "No matching properties found"
                    : `No properties have goals for ${year}`}
                </span>
              </div>
            ) : (
              <ScrollArea className="h-64 border rounded-lg">
                <div className="p-2 space-y-1">
                  {sourceOptions.map((listing) => (
                    <div
                      key={listing.id}
                      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                        sourceListingId === listing.id
                          ? "bg-primary/10 border border-primary"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => setSourceListingId(listing.id)}
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

          {/* Skip Locked Option */}
          {targetLockedMonths.size > 0 && (
            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="skip-locked"
                checked={skipLocked}
                onCheckedChange={(checked) => setSkipLocked(checked as boolean)}
              />
              <Label htmlFor="skip-locked" className="cursor-pointer">
                Skip locked months ({targetLockedMonths.size} locked on this property)
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCopy}
            disabled={!sourceListingId || isCopying}
          >
            {isCopying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Copying...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Copy Goals
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

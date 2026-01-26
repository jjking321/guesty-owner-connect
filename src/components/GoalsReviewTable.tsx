import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, Unlock, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Listing {
  id: string;
  nickname: string | null;
  thumbnail: string | null;
}

interface Goal {
  id: string;
  listing_id: string;
  year: number;
  month: number;
  projection_revenue: number | null;
  locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
}

interface GoalsReviewTableProps {
  listings: Listing[];
  goals: Goal[];
  historicalByListingMonth: Record<string, Record<number, number>>;
  compsetByListingMonth: Record<string, Record<number, number>>;
  selectedYear: number;
  selectedListings: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onGoalsSaved: () => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GoalsReviewTable({
  listings,
  goals,
  historicalByListingMonth,
  compsetByListingMonth,
  selectedYear,
  selectedListings,
  onSelectionChange,
  onGoalsSaved,
}: GoalsReviewTableProps) {
  const navigate = useNavigate();
  const [editedGoals, setEditedGoals] = useState<Record<string, number>>({});
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());

  const getGoalKey = (listingId: string, month: number) => `${listingId}-${month}`;

  const getGoalValue = (listingId: string, month: number): number => {
    const key = getGoalKey(listingId, month);
    if (editedGoals[key] !== undefined) return editedGoals[key];
    const goal = goals.find((g) => g.listing_id === listingId && g.month === month);
    return goal?.projection_revenue || 0;
  };

  const isLocked = (listingId: string, month: number): boolean => {
    const goal = goals.find((g) => g.listing_id === listingId && g.month === month);
    return goal?.locked || false;
  };

  const handleGoalChange = (listingId: string, month: number, value: string) => {
    const key = getGoalKey(listingId, month);
    const numValue = parseFloat(value) || 0;
    setEditedGoals((prev) => ({ ...prev, [key]: numValue }));
  };

  const handleToggleSelection = (listingId: string) => {
    const newSelection = new Set(selectedListings);
    if (newSelection.has(listingId)) {
      newSelection.delete(listingId);
    } else {
      newSelection.add(listingId);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (selectedListings.size === listings.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(listings.map((l) => l.id)));
    }
  };

  const handleSaveRow = async (listingId: string) => {
    setSavingRows((prev) => new Set(prev).add(listingId));

    try {
      const rowEdits = Object.entries(editedGoals)
        .filter(([key]) => key.startsWith(`${listingId}-`))
        .map(([key, value]) => {
          const month = parseInt(key.split("-").pop()!, 10);
          return { listing_id: listingId, year: selectedYear, month, projection_revenue: value };
        });

      if (rowEdits.length === 0) {
        toast({ title: "No changes", description: "No edits to save for this property" });
        return;
      }

      for (const edit of rowEdits) {
        const existingGoal = goals.find(
          (g) => g.listing_id === edit.listing_id && g.month === edit.month
        );

        if (existingGoal) {
          await supabase
            .from("property_goals")
            .update({ projection_revenue: edit.projection_revenue, updated_at: new Date().toISOString() })
            .eq("id", existingGoal.id);
        } else {
          await supabase.from("property_goals").insert(edit);
        }
      }

      // Clear edited state for this row
      setEditedGoals((prev) => {
        const newState = { ...prev };
        Object.keys(newState)
          .filter((key) => key.startsWith(`${listingId}-`))
          .forEach((key) => delete newState[key]);
        return newState;
      });

      toast({ title: "Saved", description: "Goals updated successfully" });
      onGoalsSaved();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save goals";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setSavingRows((prev) => {
        const newSet = new Set(prev);
        newSet.delete(listingId);
        return newSet;
      });
    }
  };

  const handleLockRow = async (listingId: string, lock: boolean) => {
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;

    const { error } = await supabase
      .from("property_goals")
      .update({
        locked: lock,
        locked_at: lock ? new Date().toISOString() : null,
        locked_by: lock ? userId : null,
      })
      .eq("year", selectedYear)
      .eq("listing_id", listingId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: lock ? "Locked" : "Unlocked", description: `Goals ${lock ? "locked" : "unlocked"} for property` });
      onGoalsSaved();
    }
  };

  const hasRowEdits = useCallback(
    (listingId: string) => {
      return Object.keys(editedGoals).some((key) => key.startsWith(`${listingId}-`));
    },
    [editedGoals]
  );

  const getRowTotals = (listingId: string) => {
    let goalTotal = 0;
    let lyTotal = 0;
    let compTotal = 0;

    for (let m = 1; m <= 12; m++) {
      goalTotal += getGoalValue(listingId, m);
      lyTotal += historicalByListingMonth[listingId]?.[m] || 0;
      compTotal += compsetByListingMonth[listingId]?.[m] || 0;
    }

    return { goalTotal, lyTotal, compTotal };
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}k`;
    }
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="border rounded-lg overflow-auto max-h-[calc(100vh-300px)]">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead className="w-10 sticky left-0 bg-background z-20">
              <Checkbox
                checked={selectedListings.size === listings.length && listings.length > 0}
                onCheckedChange={handleSelectAll}
              />
            </TableHead>
            <TableHead className="sticky left-10 bg-background z-20 min-w-[220px]">Property</TableHead>
            {MONTHS.map((month) => (
              <TableHead key={month} className="text-center min-w-[200px]">
                <div className="text-xs font-medium">{month}</div>
                <div className="flex text-[10px] text-muted-foreground mt-1">
                  <span className="flex-1">Goal</span>
                  <span className="flex-1">LY</span>
                  <span className="flex-1">Comp</span>
                </div>
              </TableHead>
            ))}
            <TableHead className="text-center min-w-[140px]">
              <div className="text-xs font-medium">Totals</div>
              <div className="flex text-[10px] text-muted-foreground mt-1">
                <span className="flex-1">Goal</span>
                <span className="flex-1">LY</span>
              </div>
            </TableHead>
            <TableHead className="w-24 text-center">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => {
            const { goalTotal, lyTotal } = getRowTotals(listing.id);
            const allLocked = Array.from({ length: 12 }, (_, i) => i + 1).every((m) =>
              isLocked(listing.id, m)
            );

            return (
              <TableRow key={listing.id}>
                <TableCell className="sticky left-0 bg-background">
                  <Checkbox
                    checked={selectedListings.has(listing.id)}
                    onCheckedChange={() => handleToggleSelection(listing.id)}
                  />
                </TableCell>
                <TableCell className="sticky left-10 bg-background">
                  <div className="flex items-center gap-2">
                    {listing.thumbnail && (
                      <img
                        src={listing.thumbnail}
                        alt=""
                        className="w-8 h-8 rounded object-cover"
                      />
                    )}
                    <button
                      onClick={() => navigate(`/listings/${listing.id}`)}
                      className="font-medium text-sm hover:underline hover:text-primary text-left whitespace-nowrap"
                    >
                      {listing.nickname || listing.id}
                    </button>
                  </div>
                </TableCell>
                {MONTHS.map((_, monthIndex) => {
                  const month = monthIndex + 1;
                  const goalValue = getGoalValue(listing.id, month);
                  const lyValue = historicalByListingMonth[listing.id]?.[month] || 0;
                  const compValue = compsetByListingMonth[listing.id]?.[month] || 0;
                  const locked = isLocked(listing.id, month);
                  const key = getGoalKey(listing.id, month);
                  const isEdited = editedGoals[key] !== undefined;

                  return (
                    <TableCell key={month} className="p-1">
                      <div className="flex gap-1 text-xs">
                        <div className={cn(
                          "flex-1 relative",
                          locked && "bg-muted rounded"
                        )}>
                          {locked ? (
                            <div className="flex items-center justify-center h-7 text-muted-foreground">
                              <Lock className="h-3 w-3 mr-1 text-green-600" />
                              {formatCurrency(goalValue)}
                            </div>
                          ) : (
                            <Input
                              type="number"
                              value={goalValue || ""}
                              onChange={(e) => handleGoalChange(listing.id, month, e.target.value)}
                              className={cn(
                                "h-7 text-xs px-2 text-center w-full",
                                isEdited && "border-primary"
                              )}
                            />
                          )}
                        </div>
                        <div className="flex-1 flex items-center justify-center h-7 text-muted-foreground">
                          {formatCurrency(lyValue)}
                        </div>
                        <div className="flex-1 flex items-center justify-center h-7 text-blue-600">
                          {formatCurrency(compValue)}
                        </div>
                      </div>
                    </TableCell>
                  );
                })}
                <TableCell className="p-1">
                  <div className="flex gap-1 text-xs">
                    <div className={cn(
                      "flex-1 flex items-center justify-center h-7 font-semibold",
                      goalTotal > lyTotal ? "text-green-600" : goalTotal < lyTotal ? "text-red-600" : ""
                    )}>
                      {formatCurrency(goalTotal)}
                    </div>
                    <div className="flex-1 flex items-center justify-center h-7 text-muted-foreground font-medium">
                      {formatCurrency(lyTotal)}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="p-1">
                  <div className="flex gap-1 justify-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleLockRow(listing.id, !allLocked)}
                      title={allLocked ? "Unlock all months" : "Lock all months"}
                    >
                      {allLocked ? (
                        <Unlock className="h-3 w-3" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleSaveRow(listing.id)}
                      disabled={!hasRowEdits(listing.id) || savingRows.has(listing.id)}
                      title="Save changes"
                    >
                      <Save className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

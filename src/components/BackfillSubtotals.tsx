import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { SyncProgressCard } from "@/components/SyncProgressCard";

export function BackfillSubtotals() {
  const { organizationId } = useUserRole();
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(true);

  const { data: accounts } = useQuery({
    queryKey: ["guesty-accounts-backfill", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guesty_accounts")
        .select("id, account_name");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // 48 months back + 18 months forward (covers historic data and OTB future bookings)
  const now = new Date();
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 66 }, (_, i) => {
        // i = 0 → +18 months (future); i = 65 → -47 months (past)
        const offset = 17 - i;
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = format(d, "MMM yyyy");
        return { value, label };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const earliest = monthOptions[monthOptions.length - 1]?.value;

  // Per-month missing-subtotal counts so the user can target only months that still need work.
  const { data: missingByMonth } = useQuery({
    queryKey: ["backfill-missing-by-month", organizationId, earliest],
    enabled: !!organizationId && !!earliest,
    queryFn: async () => {
      const [y, m] = earliest!.split("-").map(Number);
      const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const counts = new Map<string, { missing: number; total: number }>();
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("reservations")
          .select("check_out, sub_total")
          .gte("check_out", startDate)
          .in("status", ["confirmed", "checked_in", "checked_out"])
          .neq("source", "owner")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data as Array<{ check_out: string | null; sub_total: number | null }>) {
          if (!r.check_out) continue;
          const key = r.check_out.slice(0, 7);
          const entry = counts.get(key) ?? { missing: 0, total: 0 };
          entry.total += 1;
          if (r.sub_total == null) entry.missing += 1;
          counts.set(key, entry);
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return Object.fromEntries(counts);
    },
  });

  const toggleMonth = (month: string) => {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month]
    );
  };

  const selectAllMissing = () => {
    if (!missingByMonth) return;
    const withMissing = monthOptions
      .map((m) => m.value)
      .filter((v) => (missingByMonth[v]?.missing ?? 0) > 0);
    setSelectedMonths(withMissing);
  };

  const clearSelection = () => setSelectedMonths([]);

  const totalMissingSelected = selectedMonths.reduce(
    (sum, m) => sum + (missingByMonth?.[m]?.missing ?? 0),
    0
  );

  const runBackfill = async () => {
    if (!accounts || accounts.length === 0) {
      toast.error("No Guesty accounts found");
      return;
    }
    if (selectedMonths.length === 0) {
      toast.error("Please select at least one month");
      return;
    }

    setIsRunning(true);
    try {
      for (const account of accounts) {
        const { error } = await supabase.functions.invoke(
          "backfill-reservation-subtotals",
          {
            body: {
              guestyAccountId: account.id,
              checkOutMonths: selectedMonths.sort(),
              onlyMissing,
            },
          }
        );
        if (error) throw error;
      }
      toast.success(
        onlyMissing
          ? `Backfill started for ${selectedMonths.length} month(s), only updating reservations missing sub_total.`
          : `Backfill started for ${selectedMonths.length} month(s). Check sync jobs for progress.`
      );
    } catch (err: any) {
      console.error("Backfill error:", err);
      toast.error(err.message || "Failed to start backfill");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Backfill Subtotals</h3>
        <p className="text-sm text-muted-foreground">
          Fetch <code className="text-xs bg-muted px-1 py-0.5 rounded">money.subTotal</code> from
          Guesty for reservations that are missing it. Badges show how many reservations in each
          month still need a subtotal.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Switch id="only-missing" checked={onlyMissing} onCheckedChange={setOnlyMissing} disabled={isRunning} />
          <Label htmlFor="only-missing" className="text-sm cursor-pointer">
            Only update reservations missing sub_total
          </Label>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={selectAllMissing} disabled={isRunning || !missingByMonth}>
            Select months with missing data
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={isRunning || selectedMonths.length === 0}>
            Clear
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {monthOptions.map((m) => {
          const stat = missingByMonth?.[m.value];
          const missing = stat?.missing ?? 0;
          const total = stat?.total ?? 0;
          return (
            <label
              key={m.value}
              className="flex items-center justify-between gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 hover:bg-accent transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Checkbox
                  checked={selectedMonths.includes(m.value)}
                  onCheckedChange={() => toggleMonth(m.value)}
                  disabled={isRunning}
                />
                <span className="truncate">{m.label}</span>
              </span>
              {total > 0 && (
                <Badge
                  variant={missing > 0 ? "destructive" : "secondary"}
                  className="text-[10px] whitespace-nowrap"
                  title={`${missing} of ${total} reservations missing sub_total`}
                >
                  {missing}/{total}
                </Badge>
              )}
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={runBackfill} disabled={isRunning || selectedMonths.length === 0}>
          {isRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {isRunning ? "Running..." : "Run Backfill"}
        </Button>
        {selectedMonths.length > 0 && (
          <>
            <Badge variant="secondary">
              {selectedMonths.length} month{selectedMonths.length > 1 ? "s" : ""} selected
            </Badge>
            {onlyMissing && missingByMonth && (
              <Badge variant="outline">
                {totalMissingSelected} missing reservation{totalMissingSelected === 1 ? "" : "s"} to update
              </Badge>
            )}
          </>
        )}
      </div>

      {accounts && accounts.length > 0 && (
        <SyncProgressCard
          accountId={accounts[0].id}
          syncType="backfill_subtotals"
        />
      )}
    </div>
  );
}

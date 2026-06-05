import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SyncProgressCard } from "@/components/SyncProgressCard";

export function BackfillSubtotals() {
  const { organizationId } = useUserRole();
  const [isRunning, setIsRunning] = useState<null | "all" | "missing">(null);

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

  // 48 months back + 18 months forward
  const allMonths = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 66 }, (_, i) => {
      const offset = 17 - i;
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }).sort();
  }, []);

  const earliest = allMonths[0];

  // Aggregate missing counts across the whole range
  const { data: missingStats } = useQuery({
    queryKey: ["backfill-missing-total", organizationId, earliest],
    enabled: !!organizationId && !!earliest,
    queryFn: async () => {
      const [y, m] = earliest!.split("-").map(Number);
      const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      let missing = 0;
      let total = 0;
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("reservations")
          .select("sub_total")
          .gte("check_out", startDate)
          .in("status", ["confirmed", "checked_in", "checked_out"])
          .neq("source", "owner")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data as Array<{ sub_total: number | null }>) {
          total += 1;
          if (r.sub_total == null) missing += 1;
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return { missing, total };
    },
  });

  const runBackfill = async (mode: "all" | "missing") => {
    if (!accounts || accounts.length === 0) {
      toast.error("No Guesty accounts found");
      return;
    }

    setIsRunning(mode);
    try {
      for (const account of accounts) {
        const { error } = await supabase.functions.invoke(
          "backfill-reservation-subtotals",
          {
            body: {
              guestyAccountId: account.id,
              checkOutMonths: allMonths,
              onlyMissing: mode === "missing",
            },
          }
        );
        if (error) throw error;
      }
      toast.success(
        mode === "missing"
          ? "Backfill started — only updating reservations missing sub_total."
          : "Backfill started for all reservations in range."
      );
    } catch (err: any) {
      console.error("Backfill error:", err);
      toast.error(err.message || "Failed to start backfill");
    } finally {
      setIsRunning(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Backfill Subtotals</h3>
        <p className="text-sm text-muted-foreground">
          Fetch <code className="text-xs bg-muted px-1 py-0.5 rounded">money.subTotal</code> from
          Guesty for confirmed reservations across the last 48 months and next 18 months.
        </p>
      </div>

      {missingStats && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={missingStats.missing > 0 ? "destructive" : "secondary"}>
            {missingStats.missing} missing
          </Badge>
          <Badge variant="outline">{missingStats.total} total in range</Badge>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => runBackfill("missing")} disabled={isRunning !== null}>
          {isRunning === "missing" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Backfill missing only
        </Button>
        <Button
          variant="outline"
          onClick={() => runBackfill("all")}
          disabled={isRunning !== null}
        >
          {isRunning === "all" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Backfill all
        </Button>
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

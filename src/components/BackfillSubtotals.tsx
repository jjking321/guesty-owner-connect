import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { SyncProgressCard } from "@/components/SyncProgressCard";

export function BackfillSubtotals() {
  const { organizationId } = useUserRole();
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

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

  // Generate last 24 months as options
  const now = new Date();
  const monthOptions = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = format(d, "MMMM yyyy");
    return { value, label };
  });

  const toggleMonth = (month: string) => {
    setSelectedMonths((prev) =>
      prev.includes(month)
        ? prev.filter((m) => m !== month)
        : [...prev, month]
    );
  };

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
              checkInMonths: selectedMonths.sort(),
            },
          }
        );
        if (error) throw error;
      }
      toast.success(
        `Backfill started for ${selectedMonths.length} month(s). Check sync jobs for progress.`
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
          Guesty for reservations that are missing it. Select the check-in months to backfill.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {monthOptions.map((m) => (
          <label
            key={m.value}
            className="flex items-center gap-2 text-sm cursor-pointer rounded-md border px-3 py-2 hover:bg-accent transition-colors"
          >
            <Checkbox
              checked={selectedMonths.includes(m.value)}
              onCheckedChange={() => toggleMonth(m.value)}
              disabled={isRunning}
            />
            {m.label}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={runBackfill} disabled={isRunning || selectedMonths.length === 0}>
          {isRunning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {isRunning ? "Running..." : "Run Backfill"}
        </Button>
        {selectedMonths.length > 0 && (
          <Badge variant="secondary">
            {selectedMonths.length} month{selectedMonths.length > 1 ? "s" : ""} selected
          </Badge>
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

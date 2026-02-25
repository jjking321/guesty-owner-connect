import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, EyeOff, Eye, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export function TaxExemptTable() {
  const { organizationId } = useUserRole();
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear().toString());
  const [month, setMonth] = useState((now.getMonth()).toString());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(0);

  const refreshReservation = async (reservationId: string, listingId: string) => {
    const now = Date.now();
    if (now - lastRefreshAt < 2000) {
      toast.error("Please wait a couple seconds between refreshes");
      return;
    }
    setRefreshingId(reservationId);
    setLastRefreshAt(Date.now());
    try {
      const { error } = await supabase.functions.invoke('sync-listing-reservations', {
        body: { listingId },
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["tax-exempt-reservations"] });
      toast.success("Reservation refreshed from Guesty");
    } catch (e: any) {
      toast.error(e.message || "Failed to refresh reservation");
    } finally {
      setRefreshingId(null);
    }
  };

  const selectedYear = parseInt(year);
  const selectedMonth = parseInt(month);
  const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
  const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split("T")[0];

  const { data: listings } = useQuery({
    queryKey: ["tax-listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname")
        .eq("archived", false);
      if (error) throw error;
      return data;
    },
  });

  const { data: exemptReservations, isLoading } = useQuery({
    queryKey: ["tax-exempt-reservations", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, listing_id, guest_name, fare_accommodation_adjusted, source, check_in, check_out, tax_amount, status")
        .gte("check_out", startDate)
        .lte("check_out", endDate + "T23:59:59")
        .in("status", ["confirmed", "checked_in", "checked_out"])
        .eq("source", "manual")
        .or("tax_amount.is.null,tax_amount.eq.0")
        .gt("fare_accommodation_adjusted", 0);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const listingMap = new Map(listings?.map((l) => [l.id, l.nickname]) || []);
  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const months = Array.from({ length: 12 }, (_, i) => ({
    value: (i + 1).toString(),
    label: format(new Date(2000, i, 1), "MMMM"),
  }));
  const years = Array.from({ length: 5 }, (_, i) => (now.getFullYear() - 2 + i).toString());

  const visibleReservations = exemptReservations?.filter((r) => !hiddenIds.has(r.id)) || [];
  const hiddenReservations = exemptReservations?.filter((r) => hiddenIds.has(r.id)) || [];
  const totalAccommodation = visibleReservations.reduce((sum, r) => sum + (r.fare_accommodation_adjusted || 0), 0);

  const toggleHide = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderRow = (r: NonNullable<typeof exemptReservations>[number], isHidden: boolean) => (
    <TableRow key={r.id} className={isHidden ? "opacity-50" : ""}>
      <TableCell className="text-sm font-medium">
        {listingMap.get(r.listing_id) || r.listing_id}
      </TableCell>
      <TableCell className="text-sm">
        <a
          href={`https://app.guesty.com/reservations/${r.id}/summary`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {r.guest_name || "—"}
        </a>
      </TableCell>
      <TableCell className="text-sm">{r.source || "—"}</TableCell>
      <TableCell className="text-sm">{r.check_in ? format(new Date(r.check_in), "MM/dd/yyyy") : "—"}</TableCell>
      <TableCell className="text-sm">{r.check_out ? format(new Date(r.check_out), "MM/dd/yyyy") : "—"}</TableCell>
      <TableCell className="text-right text-sm">{fmt(r.fare_accommodation_adjusted || 0)}</TableCell>
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={refreshingId === r.id}
            onClick={() => refreshReservation(r.id, r.listing_id)}
            title="Refresh from Guesty"
          >
            {refreshingId === r.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => toggleHide(r.id)}
            title={isHidden ? "Show in report" : "Hide from report"}
          >
            {isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Manual reservations with $0 tax that need to be reported separately.
      </p>
      <div className="flex items-center gap-4">
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hiddenReservations.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHidden(!showHidden)}
          >
            {showHidden ? "Hide" : "Show"} {hiddenReservations.length} hidden
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !exemptReservations?.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No tax-exempt reservations found for the selected period.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Guest Name</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Check-out</TableHead>
                <TableHead className="text-right">Accommodation</TableHead>
                <TableHead className="text-center w-[90px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleReservations.map((r) => renderRow(r, false))}
              {showHidden && hiddenReservations.map((r) => renderRow(r, true))}
              <TableRow className="font-bold bg-muted/50">
                <TableCell colSpan={5}>Total</TableCell>
                <TableCell className="text-right">{fmt(totalAccommodation)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

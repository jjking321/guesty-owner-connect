import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import Papa from "papaparse";

interface ReportRow {
  permitNumber: string;
  propertyAddress: string;
  listingNickname: string;
  category: string; // "Behalf Platforms" or "Other"
  totalRevenue: number;
  countyTax: number;
  stateTax: number;
  totalTax: number;
}

export function TaxReportGenerator() {
  const { organizationId } = useUserRole();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear().toString());
  const [month, setMonth] = useState((now.getMonth()).toString()); // previous month default

  const selectedYear = parseInt(year);
  const selectedMonth = parseInt(month);

  const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
  const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split("T")[0]; // last day of month

  const { data: taxSettings } = useQuery({
    queryKey: ["listing-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_tax_settings").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: listings } = useQuery({
    queryKey: ["tax-listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, address")
        .eq("archived", false);
      if (error) throw error;
      return data;
    },
  });

  const { data: reservations, isLoading } = useQuery({
    queryKey: ["tax-reservations", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, listing_id, source, fare_accommodation_adjusted, tax_amount, total_paid, guest_name, check_in, check_out, status")
        .gte("check_out", startDate)
        .lte("check_out", endDate + "T23:59:59")
        .in("status", ["confirmed", "checked_in", "checked_out"]);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const generateReport = (): ReportRow[] => {
    if (!reservations || !taxSettings || !listings) return [];

    const rows: ReportRow[] = [];
    const listingMap = new Map(listings.map((l) => [l.id, l]));
    const settingsMap = new Map(taxSettings.map((s) => [s.listing_id, s]));

    // Group reservations by listing
    const byListing = new Map<string, typeof reservations>();
    for (const res of reservations) {
      if (!byListing.has(res.listing_id)) byListing.set(res.listing_id, []);
      byListing.get(res.listing_id)!.push(res);
    }

    for (const [listingId, listingReservations] of byListing) {
      const listing = listingMap.get(listingId);
      const settings = settingsMap.get(listingId);
      const behalfPlatforms = settings?.behalf_platforms || [];
      const permitNumber = settings?.permit_number || "";
      const propertyAddress = settings?.property_address || "";
      const nickname = listing?.nickname || listingId;

      // Split into behalf vs other
      const behalf = listingReservations.filter((r) => behalfPlatforms.includes(r.source || ""));
      const other = listingReservations.filter((r) => !behalfPlatforms.includes(r.source || ""));

      const sumGroup = (group: typeof listingReservations) => {
        let totalRevenue = 0;
        let totalTax = 0;
        for (const r of group) {
          totalRevenue += r.fare_accommodation_adjusted || 0;
          totalTax += r.tax_amount || 0;
        }
        const countyTax = totalTax * (5 / 12);
        const stateTax = totalTax * (7 / 12);
        return { totalRevenue, countyTax, stateTax, totalTax };
      };

      if (behalf.length > 0) {
        const sums = sumGroup(behalf);
        rows.push({
          permitNumber,
          propertyAddress,
          listingNickname: nickname,
          category: "Behalf Platforms",
          ...sums,
        });
      }

      if (other.length > 0) {
        const sums = sumGroup(other);
        rows.push({
          permitNumber,
          propertyAddress,
          listingNickname: nickname,
          category: "Other",
          ...sums,
        });
      }
    }

    return rows.sort((a, b) => a.listingNickname.localeCompare(b.listingNickname));
  };

  const reportRows = generateReport();

  const totals = reportRows.reduce(
    (acc, r) => ({
      totalRevenue: acc.totalRevenue + r.totalRevenue,
      countyTax: acc.countyTax + r.countyTax,
      stateTax: acc.stateTax + r.stateTax,
      totalTax: acc.totalTax + r.totalTax,
    }),
    { totalRevenue: 0, countyTax: 0, stateTax: 0, totalTax: 0 }
  );

  const downloadCSV = () => {
    const csvRows = reportRows.map((r) => ({
      "Permit Number": r.permitNumber,
      "Property Address": r.propertyAddress,
      "Property Name": r.listingNickname,
      "Category": r.category,
      "Total Revenue": r.totalRevenue.toFixed(2),
      "County Tax (5%)": r.countyTax.toFixed(2),
      "State Tax (7%)": r.stateTax.toFixed(2),
      "Total Tax": r.totalTax.toFixed(2),
    }));

    const csv = Papa.unparse(csvRows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Brevard_Tourism_Tax_${selectedYear}-${String(selectedMonth).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const months = Array.from({ length: 12 }, (_, i) => ({
    value: (i + 1).toString(),
    label: format(new Date(2000, i, 1), "MMMM"),
  }));

  const years = Array.from({ length: 5 }, (_, i) => (now.getFullYear() - 2 + i).toString());

  return (
    <div className="space-y-4">
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
        <Button onClick={downloadCSV} disabled={reportRows.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Download CSV
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : reportRows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No reservation data found for the selected period.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Permit #</TableHead>
                <TableHead>Property Address</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Total Revenue</TableHead>
                <TableHead className="text-right">County Tax (5%)</TableHead>
                <TableHead className="text-right">State Tax (7%)</TableHead>
                <TableHead className="text-right">Total Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportRows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">{row.permitNumber}</TableCell>
                  <TableCell className="text-sm">{row.propertyAddress}</TableCell>
                  <TableCell className="text-sm font-medium">{row.listingNickname}</TableCell>
                  <TableCell className="text-sm">{row.category}</TableCell>
                  <TableCell className="text-right text-sm">{fmt(row.totalRevenue)}</TableCell>
                  <TableCell className="text-right text-sm">{fmt(row.countyTax)}</TableCell>
                  <TableCell className="text-right text-sm">{fmt(row.stateTax)}</TableCell>
                  <TableCell className="text-right text-sm">{fmt(row.totalTax)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold bg-muted/50">
                <TableCell colSpan={4}>Totals</TableCell>
                <TableCell className="text-right">{fmt(totals.totalRevenue)}</TableCell>
                <TableCell className="text-right">{fmt(totals.countyTax)}</TableCell>
                <TableCell className="text-right">{fmt(totals.stateTax)}</TableCell>
                <TableCell className="text-right">{fmt(totals.totalTax)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

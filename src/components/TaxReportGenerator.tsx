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
  period: string;
  permitNumber: string;
  propertyAddress: string;
  provider: string;
  totalRevenue: number | null; // null = no reservations
  allowableDeductions: string;
}

interface TaxReportGeneratorProps {
  taxType: "county" | "state";
}

export function TaxReportGenerator({ taxType }: TaxReportGeneratorProps) {
  const { organizationId } = useUserRole();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear().toString());
  const [month, setMonth] = useState((now.getMonth()).toString()); // previous month default

  const selectedYear = parseInt(year);
  const selectedMonth = parseInt(month);
  const multiplier = taxType === "county" ? 5 / 12 : 7 / 12;

  const periodLabel = format(new Date(selectedYear, selectedMonth - 1, 1), "MMMM yyyy");
  const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
  const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split("T")[0];

  const { data: taxSettings } = useQuery({
    queryKey: ["listing-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_tax_settings").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Fetch org-level behalf platforms
  const { data: orgTaxSettings } = useQuery({
    queryKey: ["organization-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_tax_settings")
        .select("*")
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: reservations, isLoading } = useQuery({
    queryKey: ["tax-reservations", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, listing_id, source, tax_amount, status, check_out")
        .gte("check_out", startDate)
        .lte("check_out", endDate + "T23:59:59")
        .in("status", ["confirmed", "checked_in", "checked_out"]);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const generateReport = (): ReportRow[] => {
    if (!taxSettings) return [];

    const rows: ReportRow[] = [];

    // Group reservations by listing
    const resByListing = new Map<string, typeof reservations>();
    if (reservations) {
      for (const res of reservations) {
        if (!resByListing.has(res.listing_id)) resByListing.set(res.listing_id, []);
        resByListing.get(res.listing_id)!.push(res);
      }
    }

    // Sort settings by permit number
    const sortedSettings = [...taxSettings].sort((a, b) =>
      (a.permit_number || "").localeCompare(b.permit_number || "")
    );

    const globalBehalfPlatforms = orgTaxSettings?.behalf_platforms || [];

    for (const settings of sortedSettings) {
      const listingId = settings.listing_id;
      const behalfPlatforms = globalBehalfPlatforms;
      const permitNumber = settings.permit_number || "";
      const propertyAddress = settings.property_address || "";
      const listingReservations = resByListing.get(listingId) || [];

      const behalf = listingReservations.filter((r) => behalfPlatforms.includes(r.source || ""));
      const other = listingReservations.filter((r) => !behalfPlatforms.includes(r.source || ""));

      const sumTax = (group: typeof listingReservations) => {
        let total = 0;
        for (const r of group) total += r.tax_amount || 0;
        return total;
      };

      const behalfTax = behalf.length > 0 ? sumTax(behalf) * multiplier : null;
      const otherTax = other.length > 0 ? sumTax(other) * multiplier : null;

      rows.push({
        period: periodLabel,
        permitNumber,
        propertyAddress,
        provider: "behalfPlatforms",
        totalRevenue: behalfTax,
        allowableDeductions: "",
      });

      rows.push({
        period: periodLabel,
        permitNumber,
        propertyAddress,
        provider: "other",
        totalRevenue: otherTax,
        allowableDeductions: "",
      });
    }

    return rows;
  };

  const reportRows = generateReport();

  const totals = reportRows.reduce(
    (acc, r) => acc + (r.totalRevenue || 0),
    0
  );

  const downloadCSV = () => {
    const csvRows = reportRows.map((r) => ({
      "Period": r.period,
      "Permit Number": r.permitNumber,
      "Property Address": r.propertyAddress,
      "Provider": r.provider,
      "Total Revenue": r.totalRevenue !== null ? r.totalRevenue.toFixed(2) : "",
      "Allowable Deductions": r.allowableDeductions,
    }));

    const csv = Papa.unparse(csvRows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const typeLabel = taxType === "county" ? "County" : "State";
    a.download = `Brevard_${typeLabel}_Tax_${selectedYear}-${String(selectedMonth).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmt = (n: number | null) =>
    n !== null ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";

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
          No properties with tax settings found. Configure tax settings first.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Permit #</TableHead>
                <TableHead>Property Address</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Total Revenue</TableHead>
                <TableHead className="text-right">Allowable Deductions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportRows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">{row.period}</TableCell>
                  <TableCell className="text-sm">{row.permitNumber}</TableCell>
                  <TableCell className="text-sm">{row.propertyAddress}</TableCell>
                  <TableCell className="text-sm">{row.provider}</TableCell>
                  <TableCell className="text-right text-sm">{fmt(row.totalRevenue)}</TableCell>
                  <TableCell className="text-right text-sm">{row.allowableDeductions}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold bg-muted/50">
                <TableCell colSpan={4}>Totals</TableCell>
                <TableCell className="text-right">{fmt(totals)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

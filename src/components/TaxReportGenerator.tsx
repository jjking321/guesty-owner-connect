import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import Papa from "papaparse";

interface ReportRow {
  period: string;
  nickname: string;
  permitNumber: string;
  propertyAddress: string;
  provider: string;
  totalPayout: number | null;
  taxAmount: number | null;
  taxAmountCalc: number | null;
  allowableDeductions: number | null;
  groupedUnits?: string[];
}

interface TaxReportGeneratorProps {
  taxType: "county" | "state";
}

export function TaxReportGenerator({ taxType }: TaxReportGeneratorProps) {
  const { organizationId } = useUserRole();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear().toString());
  const [month, setMonth] = useState((now.getMonth()).toString());

  const selectedYear = parseInt(year);
  const selectedMonth = parseInt(month);
  const multiplier = taxType === "county" ? 5 / 12 : 7 / 12;
  const flatRate = taxType === "county" ? 0.05 : 0.07;
  const taxCollectedLabel = taxType === "county" ? "County Tax (Collected)" : "State Tax (Collected)";
  const taxCalcLabel = taxType === "county" ? "County Tax (Calculated)" : "State Tax (Calculated)";

  const periodLabel = format(new Date(selectedYear, selectedMonth - 1, 1), "MMMM yyyy");
  const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
  const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split("T")[0];

  const { data: listings } = useQuery({
    queryKey: ["tax-report-listings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, address, active")
        .eq("archived", false)
        .eq("active", true)
        .order("nickname");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: taxSettings } = useQuery({
    queryKey: ["listing-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_tax_settings").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: taxGroups } = useQuery({
    queryKey: ["tax-groups", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_groups")
        .select("*")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

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
        .select("id, listing_id, source, tax_amount, sub_total, status, check_out")
        .gte("check_out", startDate)
        .lte("check_out", endDate + "T23:59:59")
        .in("status", ["confirmed", "checked_in", "checked_out"]);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: exemptReservations } = useQuery({
    queryKey: ["tax-exempt-for-report", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, listing_id, fare_accommodation_adjusted")
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

  const exemptByListing = new Map<string, number>();
  if (exemptReservations) {
    for (const r of exemptReservations) {
      const prev = exemptByListing.get(r.listing_id) || 0;
      exemptByListing.set(r.listing_id, prev + (r.fare_accommodation_adjusted || 0));
    }
  }

  const getDefaultAddress = (listing: any): string => {
    if (!listing.address) return "";
    const addr = listing.address as any;
    return [addr.street, addr.city, addr.state, addr.zipcode].filter(Boolean).join(", ");
  };

  const generateReport = (): ReportRow[] => {
    if (!listings) return [];

    const settingsMap = new Map(taxSettings?.map((s) => [s.listing_id, s]) || []);
    const groupsMap = new Map(taxGroups?.map((g) => [g.id, g]) || []);

    // Filter out excluded listings
    const includedListings = listings.filter((l) => {
      const s = settingsMap.get(l.id);
      return !s?.excluded_from_tax;
    });

    const resByListing = new Map<string, typeof reservations>();
    if (reservations) {
      for (const res of reservations) {
        if (!resByListing.has(res.listing_id)) resByListing.set(res.listing_id, []);
        resByListing.get(res.listing_id)!.push(res);
      }
    }

    const globalBehalfPlatforms = orgTaxSettings?.behalf_platforms || [];

    // Helper to compute per-listing data
    const computeListingData = (listing: typeof includedListings[0]) => {
      const listingReservations = resByListing.get(listing.id) || [];
      const behalf = listingReservations.filter((r) => globalBehalfPlatforms.includes(r.source || ""));
      const other = listingReservations.filter((r) => !globalBehalfPlatforms.includes(r.source || ""));

      const sumField = (group: typeof listingReservations, field: "sub_total" | "tax_amount") => {
        let total = 0;
        for (const r of group) total += (r[field] as number) || 0;
        return total;
      };

      const sumCalcTax = (group: typeof listingReservations) => {
        let total = 0;
        for (const r of group) total += ((r.sub_total as number) || 0) * flatRate;
        return total;
      };

      return {
        behalfPayout: behalf.length > 0 ? sumField(behalf, "sub_total") : 0,
        behalfTax: behalf.length > 0 ? sumField(behalf, "tax_amount") * multiplier : 0,
        behalfTaxCalc: behalf.length > 0 ? sumCalcTax(behalf) : 0,
        otherPayout: other.length > 0 ? sumField(other, "sub_total") : 0,
        otherTax: other.length > 0 ? sumField(other, "tax_amount") * multiplier : 0,
        otherTaxCalc: other.length > 0 ? sumCalcTax(other) : 0,
        exemptTotal: exemptByListing.get(listing.id) || 0,
        hasBehalf: behalf.length > 0,
        hasOther: other.length > 0,
      };
    };

    // Separate grouped vs ungrouped listings
    const groupedByGroupId = new Map<string, typeof includedListings>();
    const ungrouped: typeof includedListings = [];

    for (const listing of includedListings) {
      const s = settingsMap.get(listing.id);
      const groupId = s?.tax_group_id;
      if (groupId && groupsMap.has(groupId)) {
        if (!groupedByGroupId.has(groupId)) groupedByGroupId.set(groupId, []);
        groupedByGroupId.get(groupId)!.push(listing);
      } else {
        ungrouped.push(listing);
      }
    }

    const rows: ReportRow[] = [];

    // Process grouped listings
    for (const [groupId, groupListings] of groupedByGroupId) {
      const group = groupsMap.get(groupId)!;
      let totalBehalfPayout = 0, totalBehalfTax = 0, totalBehalfTaxCalc = 0;
      let totalOtherPayout = 0, totalOtherTax = 0, totalOtherTaxCalc = 0, totalExempt = 0;
      let anyBehalf = false, anyOther = false;

      for (const listing of groupListings) {
        const data = computeListingData(listing);
        totalBehalfPayout += data.behalfPayout;
        totalBehalfTax += data.behalfTax;
        totalBehalfTaxCalc += data.behalfTaxCalc;
        totalOtherPayout += data.otherPayout;
        totalOtherTax += data.otherTax;
        totalOtherTaxCalc += data.otherTaxCalc;
        totalExempt += data.exemptTotal;
        if (data.hasBehalf) anyBehalf = true;
        if (data.hasOther) anyOther = true;
      }

      const unitNames = groupListings.map((l) => l.nickname || l.id);

      rows.push({
        period: periodLabel,
        nickname: group.name,
        permitNumber: group.permit_number || "",
        propertyAddress: group.property_address || "",
        provider: "behalfPlatforms",
        totalPayout: anyBehalf ? totalBehalfPayout : null,
        taxAmount: anyBehalf ? totalBehalfTax : null,
        taxAmountCalc: null,
        allowableDeductions: null,
        groupedUnits: unitNames,
      });

      rows.push({
        period: periodLabel,
        nickname: group.name,
        permitNumber: group.permit_number || "",
        propertyAddress: group.property_address || "",
        provider: "other",
        totalPayout: anyOther ? totalOtherPayout : null,
        taxAmount: anyOther ? totalOtherTax : null,
        taxAmountCalc: (anyOther && !totalExempt) ? totalOtherTaxCalc : null,
        allowableDeductions: totalExempt || null,
        groupedUnits: unitNames,
      });
    }

    // Process ungrouped listings
    const sortedUngrouped = [...ungrouped].sort((a, b) => {
      const permitA = settingsMap.get(a.id)?.permit_number || "";
      const permitB = settingsMap.get(b.id)?.permit_number || "";
      if (permitA !== permitB) return permitA.localeCompare(permitB);
      return (a.nickname || "").localeCompare(b.nickname || "");
    });

    for (const listing of sortedUngrouped) {
      const settings = settingsMap.get(listing.id);
      const permitNumber = settings?.permit_number || "";
      const propertyAddress = settings?.property_address || getDefaultAddress(listing);
      const data = computeListingData(listing);

      rows.push({
        period: periodLabel,
        nickname: listing.nickname || "",
        permitNumber,
        propertyAddress,
        provider: "behalfPlatforms",
        totalPayout: data.hasBehalf ? data.behalfPayout : null,
        taxAmount: data.hasBehalf ? data.behalfTax : null,
        taxAmountCalc: null,
        allowableDeductions: null,
      });

      rows.push({
        period: periodLabel,
        nickname: listing.nickname || "",
        permitNumber,
        propertyAddress,
        provider: "other",
        totalPayout: data.hasOther ? data.otherPayout : null,
        taxAmount: data.hasOther ? data.otherTax : null,
        taxAmountCalc: (data.hasOther && !data.exemptTotal) ? data.otherTaxCalc : null,
        allowableDeductions: data.exemptTotal || null,
      });
    }

    return rows;
  };

  const reportRows = generateReport();

  const payoutTotal = reportRows.reduce((acc, r) => acc + (r.totalPayout || 0), 0);
  const taxTotal = reportRows.reduce((acc, r) => acc + (r.taxAmount || 0), 0);
  const taxCalcTotal = reportRows.reduce((acc, r) => acc + (r.taxAmountCalc || 0), 0);
  const deductionsTotal = reportRows.reduce((acc, r) => acc + (r.allowableDeductions || 0), 0);
  const otherSubtotal = reportRows.filter((r) => r.provider === "other").reduce((acc, r) => acc + (r.totalPayout || 0), 0);

  const downloadCSV = () => {
    const csvRows = reportRows.map((r) => ({
      "Period": r.period,
      "Nickname": r.nickname,
      "Permit Number": r.permitNumber,
      "Property Address": r.propertyAddress,
      "Provider": r.provider,
      "Subtotal": r.totalPayout !== null ? r.totalPayout.toFixed(2) : "",
      [taxCollectedLabel]: r.taxAmount !== null ? r.taxAmount.toFixed(2) : "",
      [taxCalcLabel]: r.taxAmountCalc !== null ? r.taxAmountCalc.toFixed(2) : "",
      "Allowable Deductions": r.allowableDeductions !== null ? r.allowableDeductions.toFixed(2) : "",
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

  const fmtNum = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const months = Array.from({ length: 12 }, (_, i) => ({
    value: (i + 1).toString(),
    label: format(new Date(2000, i, 1), "MMMM"),
  }));

  const years = Array.from({ length: 5 }, (_, i) => (now.getFullYear() - 2 + i).toString());

  return (
    <div className="space-y-4">
      {reportRows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Subtotal</p>
            <p className="text-2xl font-bold">{fmtNum(payoutTotal)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{taxCollectedLabel}</p>
            <p className="text-2xl font-bold">{fmtNum(taxTotal)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{taxCalcLabel}</p>
            <p className="text-2xl font-bold">{fmtNum(taxCalcTotal)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Other Subtotal</p>
            <p className="text-2xl font-bold">{fmtNum(otherSubtotal)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Allowable Deductions</p>
            <p className="text-2xl font-bold">{fmtNum(deductionsTotal)}</p>
          </div>
        </div>
      )}
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
          No listings found for the selected period.
        </p>
      ) : (
        <TooltipProvider>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Nickname</TableHead>
                  <TableHead>Permit #</TableHead>
                  <TableHead>Property Address</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">{taxCollectedLabel}</TableHead>
                  <TableHead className="text-right">{taxCalcLabel}</TableHead>
                  <TableHead className="text-right">Allowable Deductions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{row.period}</TableCell>
                    <TableCell className="text-sm">
                      {row.groupedUnits && row.groupedUnits.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger className="underline decoration-dotted cursor-help">
                            {row.nickname}
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Units: {row.groupedUnits.join(", ")}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        row.nickname
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{row.permitNumber}</TableCell>
                    <TableCell className="text-sm">{row.propertyAddress}</TableCell>
                    <TableCell className="text-sm">{row.provider}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(row.totalPayout)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(row.taxAmount)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(row.taxAmountCalc)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(row.allowableDeductions)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/50">
                  <TableCell colSpan={5}>Totals</TableCell>
                  <TableCell className="text-right">{fmt(payoutTotal)}</TableCell>
                  <TableCell className="text-right">{fmt(taxTotal)}</TableCell>
                  <TableCell className="text-right">{fmt(taxCalcTotal)}</TableCell>
                  <TableCell className="text-right">{fmt(deductionsTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

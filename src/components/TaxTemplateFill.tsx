import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

interface TemplateRow {
  period: string;
  permitNumber: string;
  propertyAddress: string;
  provider: string;
  totalRevenue: number | null;
  allowableDeductions: number | null;
  matched: boolean;
}

export function TaxTemplateFill() {
  const { organizationId } = useUserRole();
  const [templateRows, setTemplateRows] = useState<TemplateRow[] | null>(null);
  const [detectedPeriod, setDetectedPeriod] = useState<{ month: number; year: number } | null>(null);
  const [originalWorkbook, setOriginalWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState("");

  // Parse period text like "January 2026" -> { month: 1, year: 2026 }
  const parsePeriod = (text: string): { month: number; year: number } | null => {
    if (!text) return null;
    const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const monthIdx = months.indexOf(parts[0].toLowerCase());
    const year = parseInt(parts[1]);
    if (monthIdx === -1 || isNaN(year)) return null;
    return { month: monthIdx + 1, year };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      setOriginalWorkbook(wb);

      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });

      const rows: TemplateRow[] = json.map((row: any) => ({
        period: row["Period"] || "",
        permitNumber: row["Permit Number"] || "",
        propertyAddress: row["Property Address"] || "",
        provider: row["Provider"] || "",
        totalRevenue: null,
        allowableDeductions: null,
        matched: false,
      }));

      setTemplateRows(rows);

      // Detect period from first row
      if (rows.length > 0) {
        const period = parsePeriod(rows[0].period);
        setDetectedPeriod(period);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const startDate = detectedPeriod
    ? `${detectedPeriod.year}-${String(detectedPeriod.month).padStart(2, "0")}-01`
    : null;
  const endDate = detectedPeriod
    ? new Date(detectedPeriod.year, detectedPeriod.month, 0).toISOString().split("T")[0]
    : null;

  const { data: taxSettings } = useQuery({
    queryKey: ["template-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_tax_settings").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!detectedPeriod,
  });

  const { data: taxGroups } = useQuery({
    queryKey: ["template-tax-groups", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_groups")
        .select("*")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!detectedPeriod,
  });

  const { data: orgTaxSettings } = useQuery({
    queryKey: ["template-org-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_tax_settings")
        .select("*")
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!detectedPeriod,
  });

  const { data: reservations, isLoading: resLoading } = useQuery({
    queryKey: ["template-reservations", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("id, listing_id, source, tax_amount, host_payout, status, check_out, fare_accommodation_adjusted")
        .gte("check_out", startDate!)
        .lte("check_out", endDate + "T23:59:59")
        .in("status", ["confirmed", "checked_in", "checked_out"]);
      if (error) throw error;
      return data;
    },
    enabled: !!startDate && !!endDate && !!organizationId,
  });

  // Build permit -> revenue lookup
  const filledRows = useMemo(() => {
    if (!templateRows || !taxSettings || !reservations || !orgTaxSettings) return templateRows;

    const globalBehalfPlatforms = orgTaxSettings?.behalf_platforms || [];

    // Build listing -> reservations map
    const resByListing = new Map<string, typeof reservations>();
    for (const r of reservations) {
      if (!resByListing.has(r.listing_id)) resByListing.set(r.listing_id, []);
      resByListing.get(r.listing_id)!.push(r);
    }

    // Build permit -> listing_ids map (considering tax groups)
    const permitToListingIds = new Map<string, string[]>();

    // From tax groups
    if (taxGroups) {
      for (const group of taxGroups) {
        if (group.permit_number) {
          const groupListingIds = taxSettings
            .filter((s) => s.tax_group_id === group.id && !s.excluded_from_tax)
            .map((s) => s.listing_id);
          permitToListingIds.set(group.permit_number, groupListingIds);
        }
      }
    }

    // From individual listings (not in a group)
    for (const s of taxSettings) {
      if (s.permit_number && !s.tax_group_id && !s.excluded_from_tax) {
        const existing = permitToListingIds.get(s.permit_number) || [];
        existing.push(s.listing_id);
        permitToListingIds.set(s.permit_number, existing);
      }
    }

    // Build permit -> { behalfPayout, otherPayout, exemptTotal }
    const permitData = new Map<string, { behalfPayout: number; otherPayout: number; exemptTotal: number }>();

    for (const [permit, listingIds] of permitToListingIds) {
      let behalfPayout = 0;
      let otherPayout = 0;
      let exemptTotal = 0;

      for (const lid of listingIds) {
        const listingRes = resByListing.get(lid) || [];
        for (const r of listingRes) {
          const isBehalf = globalBehalfPlatforms.includes(r.source || "");
          if (isBehalf) {
            behalfPayout += (r.host_payout as number) || 0;
          } else {
            otherPayout += (r.host_payout as number) || 0;
            // Tax exempt: manual source, no tax, has accommodation fare
            if (
              r.source === "manual" &&
              (!r.tax_amount || r.tax_amount === 0) &&
              r.fare_accommodation_adjusted &&
              (r.fare_accommodation_adjusted as number) > 0
            ) {
              exemptTotal += (r.fare_accommodation_adjusted as number) || 0;
            }
          }
        }
      }

      permitData.set(permit, { behalfPayout, otherPayout, exemptTotal });
    }

    // Fill template rows
    return templateRows.map((row) => {
      const data = permitData.get(row.permitNumber);
      if (!data) return { ...row, matched: false };

      const isBehalf = row.provider === "behalfPlatforms";
      return {
        ...row,
        totalRevenue: isBehalf ? data.behalfPayout : data.otherPayout,
        allowableDeductions: isBehalf ? null : (data.exemptTotal || null),
        matched: true,
      };
    });
  }, [templateRows, taxSettings, taxGroups, orgTaxSettings, reservations]);

  const matchedCount = filledRows?.filter((r) => r.matched).length || 0;
  const uniquePermits = new Set(filledRows?.map((r) => r.permitNumber) || []);
  const matchedPermits = new Set(filledRows?.filter((r) => r.matched).map((r) => r.permitNumber) || []);

  const downloadFilled = () => {
    if (!originalWorkbook || !filledRows) return;

    const wb = XLSX.utils.book_new();
    const wsData = filledRows.map((r) => ({
      "Period": r.period,
      "Permit Number": r.permitNumber,
      "Property Address": r.propertyAddress,
      "Provider": r.provider,
      "Total Revenue": r.totalRevenue !== null ? Math.round(r.totalRevenue * 100) / 100 : "",
      "Allowable Deductions": r.allowableDeductions !== null ? Math.round(r.allowableDeductions * 100) / 100 : "",
    }));
    const ws = XLSX.utils.json_to_sheet(wsData);

    // Set column widths
    ws["!cols"] = [
      { wch: 16 }, { wch: 16 }, { wch: 50 }, { wch: 18 }, { wch: 16 }, { wch: 22 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "TaxableReceipts");
    const outName = fileName.replace(/\.xlsx?$/i, "_filled.xlsx");
    XLSX.writeFile(wb, outName);
  };

  const fmt = (n: number | null) =>
    n !== null ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";

  const isReady = filledRows && !resLoading;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-lg font-semibold mb-2">Upload Tax Template</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Upload your blank Brevard Tourism Tax XLSX template. The system will match each permit number
          to your listings and fill in Total Revenue and Allowable Deductions.
        </p>
        <div className="flex items-center gap-4">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileUpload}
            />
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-md border bg-background hover:bg-accent text-sm font-medium transition-colors">
              <Upload className="h-4 w-4" />
              {fileName || "Choose File"}
            </div>
          </label>
          {detectedPeriod && (
            <Badge variant="secondary">
              Detected period: {new Date(detectedPeriod.year, detectedPeriod.month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </Badge>
          )}
        </div>
      </div>

      {resLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading reservation data…</span>
        </div>
      )}

      {isReady && filledRows && filledRows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant={matchedPermits.size === uniquePermits.size ? "default" : "destructive"}>
                {matchedPermits.size} of {uniquePermits.size} permits matched
              </Badge>
              {matchedPermits.size < uniquePermits.size && (
                <span className="text-sm text-muted-foreground">
                  Unmatched permits are highlighted below
                </span>
              )}
            </div>
            <Button onClick={downloadFilled}>
              <Download className="h-4 w-4 mr-2" />
              Download Filled Template
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Permit #</TableHead>
                  <TableHead>Property Address</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Allowable Deductions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filledRows.map((row, i) => (
                  <TableRow key={i} className={!row.matched ? "bg-yellow-50 dark:bg-yellow-950/20" : ""}>
                    <TableCell>
                      {row.matched ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{row.period}</TableCell>
                    <TableCell className="text-sm font-mono">{row.permitNumber}</TableCell>
                    <TableCell className="text-sm">{row.propertyAddress}</TableCell>
                    <TableCell className="text-sm">{row.provider}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(row.totalRevenue)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(row.allowableDeductions)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

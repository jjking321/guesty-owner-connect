import { useState } from "react";
import Papa from "papaparse";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

interface BulkGoalsUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ParsedGoal {
  unitAlias: string;
  monthlyProjections: Record<number, number>;
}

interface MatchedGoal {
  listingId: string;
  unitAlias: string;
  projections: Record<number, number>;
  totalProjection: number;
}

interface MatchResult {
  matched: MatchedGoal[];
  unmatched: Array<{ unitAlias: string }>;
}

export function BulkGoalsUpload({ open, onOpenChange, onSuccess }: BulkGoalsUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [detectedYear, setDetectedYear] = useState(2025);
  const { toast } = useToast();

  // Detect CSV format based on headers
  const detectCSVFormat = (headers: string[]): 'wide' | 'long' => {
    // Long format has columns: Name, Month, Listing, Guesty ID, Projected Revenue
    if (headers.some(h => h?.toLowerCase().includes('guesty id')) && 
        headers.some(h => h?.toLowerCase() === 'month')) {
      return 'long';
    }
    return 'wide';
  };

  // Parse long format: each row is one month for one property
  const parseLongFormat = (rows: string[][], headers: string[]): { goals: ParsedGoal[], guestyIds: Map<string, string>, detectedYear: number } => {
    const listingIdCol = headers.findIndex(h => h?.toLowerCase().includes('guesty id'));
    const listingNameCol = headers.findIndex(h => h?.toLowerCase() === 'listing');
    const monthCol = headers.findIndex(h => h?.toLowerCase() === 'month');
    const revenueCol = headers.findIndex(h => h?.toLowerCase().includes('projected revenue'));

    const listingMap = new Map<string, { unitAlias: string; guestyId: string; projections: Record<number, number> }>();
    let detectedYear = new Date().getFullYear();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const guestyId = row[listingIdCol]?.trim();
      const listingName = row[listingNameCol]?.trim();
      const monthStr = row[monthCol]?.trim();
      const revenueStr = row[revenueCol]?.trim();

      if (!guestyId || !monthStr) continue;

      // Parse month from date string like "1/1/2026"
      const monthDate = new Date(monthStr);
      if (isNaN(monthDate.getTime())) continue;
      
      const month = monthDate.getMonth() + 1; // 1-12
      detectedYear = monthDate.getFullYear();

      // Parse revenue
      const cleaned = revenueStr?.replace(/[$,]/g, '') || '';
      const revenue = parseFloat(cleaned);
      if (isNaN(revenue) || revenue <= 0) continue;

      // Group by guestyId
      if (!listingMap.has(guestyId)) {
        listingMap.set(guestyId, {
          unitAlias: listingName || guestyId,
          guestyId,
          projections: {}
        });
      }
      listingMap.get(guestyId)!.projections[month] = revenue;
    }

    const goals: ParsedGoal[] = [];
    const guestyIds = new Map<string, string>();

    listingMap.forEach((data, guestyId) => {
      if (Object.keys(data.projections).length > 0) {
        goals.push({
          unitAlias: data.unitAlias,
          monthlyProjections: data.projections
        });
        guestyIds.set(data.unitAlias, guestyId);
      }
    });

    return { goals, guestyIds, detectedYear };
  };

  // Parse wide format: each row is one property with 12 month columns
  const parseWideFormat = (rows: string[][]): { goals: ParsedGoal[], detectedYear: number } => {
    const results: ParsedGoal[] = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const unitAlias = row[0]?.trim();
      
      if (!unitAlias || unitAlias === 'Total Property Income' || unitAlias === '') continue;
      
      const monthlyProjections: Record<number, number> = {};
      
      for (let month = 1; month <= 12; month++) {
        const value = row[month + 1]?.trim();
        if (value && value !== '') {
          const cleaned = value.replace(/[$,]/g, '');
          const numValue = parseFloat(cleaned);
          if (!isNaN(numValue) && numValue > 0) {
            monthlyProjections[month] = numValue;
          }
        }
      }
      
      if (Object.keys(monthlyProjections).length > 0) {
        results.push({ unitAlias, monthlyProjections });
      }
    }
    
    return { goals: results, detectedYear: 2025 };
  };

  const parseCSV = (csvText: string): { goals: ParsedGoal[], guestyIds?: Map<string, string>, detectedYear: number } => {
    const parsed = Papa.parse(csvText, { skipEmptyLines: true });
    const rows = parsed.data as string[][];
    const headers = rows[0] || [];
    
    const format = detectCSVFormat(headers);
    
    if (format === 'long') {
      return parseLongFormat(rows, headers);
    }
    return parseWideFormat(rows);
  };

  const matchListingsToCSV = async (
    parsedData: ParsedGoal[], 
    guestyIds?: Map<string, string>
  ): Promise<MatchResult> => {
    const { data: listings, error } = await supabase
      .from('listings')
      .select('id, nickname');
    
    if (error) {
      throw new Error(`Failed to fetch listings: ${error.message}`);
    }
    
    const matched: MatchedGoal[] = [];
    const unmatched: Array<{ unitAlias: string }> = [];
    
    for (const csvRow of parsedData) {
      let listing = null;
      
      // If we have Guesty IDs, match by ID first
      if (guestyIds?.has(csvRow.unitAlias)) {
        const guestyId = guestyIds.get(csvRow.unitAlias)!;
        listing = listings?.find(l => l.id === guestyId);
      }
      
      // Fall back to nickname matching
      if (!listing) {
        listing = listings?.find(l => 
          l.nickname?.toLowerCase().trim() === csvRow.unitAlias.toLowerCase().trim()
        );
      }
      
      if (listing) {
        const totalProjection = Object.values(csvRow.monthlyProjections).reduce((sum, val) => sum + val, 0);
        matched.push({
          listingId: listing.id,
          unitAlias: csvRow.unitAlias,
          projections: csvRow.monthlyProjections,
          totalProjection
        });
      } else {
        unmatched.push({ unitAlias: csvRow.unitAlias });
      }
    }
    
    return { matched, unmatched };
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);
    setIsProcessing(true);

    try {
      const text = await selectedFile.text();
      const { goals, guestyIds, detectedYear: year } = parseCSV(text);
      setDetectedYear(year);
      const result = await matchListingsToCSV(goals, guestyIds);
      setMatchResult(result);
      
      toast({
        title: "CSV Parsed",
        description: `${result.matched.length} of ${goals.length} properties matched for ${year}`,
      });
    } catch (error) {
      toast({
        title: "Error parsing CSV",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
      setFile(null);
      setMatchResult(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpload = async () => {
    if (!matchResult || matchResult.matched.length === 0) {
      toast({
        title: "No data to upload",
        description: "Please select a valid CSV file first",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setUploadProgress(0);

    try {
      const { data, error } = await supabase.functions.invoke('bulk-upload-goals', {
        body: {
          year: detectedYear,
          updates: matchResult.matched.map(m => ({
            listingId: m.listingId,
            monthlyProjections: m.projections
          }))
        }
      });

      setUploadProgress(100);

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Goals Updated Successfully",
          description: `Updated ${data.stats.goalsUpdated} goals across ${data.stats.propertiesProcessed} properties${
            data.stats.goalsSkipped > 0 ? `. ${data.stats.goalsSkipped} goals skipped (already locked).` : '.'
          }`,
        });
        onOpenChange(false);
        onSuccess?.();
      } else {
        throw new Error(data?.error || "Upload failed");
      }
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setFile(null);
      setMatchResult(null);
      setUploadProgress(0);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload {detectedYear} Goals from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk update goal values for all properties.
            Supports both wide format (properties as rows) and long format (Guesty ID + monthly rows).
            All updated goals will be locked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!file && (
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <label htmlFor="csv-upload" className="cursor-pointer">
                <Button variant="outline" asChild>
                  <span>Select CSV File</span>
                </Button>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <p className="text-sm text-muted-foreground mt-2">
                Supports: Wide format (Unit Alias + 12 month columns) or Long format (Guesty ID, Month, Projected Revenue)
              </p>
            </div>
          )}

          {file && matchResult && (
            <>
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  <strong>{matchResult.matched.length}</strong> of{' '}
                  <strong>{matchResult.matched.length + matchResult.unmatched.length}</strong>{' '}
                  properties matched
                </AlertDescription>
              </Alert>

              {matchResult.unmatched.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{matchResult.unmatched.length} properties not matched:</strong>
                    <div className="mt-2 max-h-32 overflow-y-auto text-xs">
                      {matchResult.unmatched.map((u, i) => (
                        <div key={i}>{u.unitAlias}</div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs">Check that listing nicknames match CSV Unit Alias exactly.</p>
                  </AlertDescription>
                </Alert>
              )}

              {matchResult.matched.length > 0 && (
                <div className="border rounded-lg">
                  <div className="p-4 border-b bg-muted/50">
                    <h4 className="font-semibold">Matched Properties Preview</h4>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background border-b">
                        <tr>
                          <th className="text-left p-2">Property</th>
                          <th className="text-right p-2">Months</th>
                          <th className="text-right p-2">Total Goal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchResult.matched.slice(0, 50).map((m, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-2">{m.unitAlias}</td>
                            <td className="text-right p-2">{Object.keys(m.projections).length}</td>
                            <td className="text-right p-2">${m.totalProjection.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {matchResult.matched.length > 50 && (
                      <p className="text-xs text-muted-foreground p-2 text-center">
                        ...and {matchResult.matched.length - 50} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              {isProcessing && uploadProgress > 0 && (
                <div className="space-y-2">
                  <Progress value={uploadProgress} />
                  <p className="text-sm text-center text-muted-foreground">Uploading goals...</p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {file && (
            <Button 
              variant="outline" 
              onClick={() => {
                setFile(null);
                setMatchResult(null);
              }}
              disabled={isProcessing}
            >
              Clear
            </Button>
          )}
          <Button 
            onClick={handleUpload}
            disabled={!matchResult || matchResult.matched.length === 0 || isProcessing}
          >
            {isProcessing ? "Uploading..." : `Upload & Lock ${matchResult?.matched.length || 0} Properties`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

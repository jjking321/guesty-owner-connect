import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, RefreshCw, Trash2, Search, Database, TrendingUp, Calendar, Edit2, Check, X, Wand2, Settings2, Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Link } from "react-router-dom";
import { CompSelectionWizard } from "@/components/CompSelectionWizard";
interface ComparableWithListing {
  id: string;
  listing_id: string;
  airroi_listing_id: string;
  listing_name: string | null;
  host_name: string | null;
  is_selected: boolean | null;
  ttm_revenue: number | null;
  ttm_adr: number | null;
  ttm_occupancy: number | null;
  metrics_fetched_at: string | null;
  future_rates_fetched_at: string | null;
  fetched_at: string | null;
  selected_at: string | null;
  property_details: any;
  location_info: any;
}

// Helper to paginate through Supabase's 1000-row limit
async function fetchAllComparables(): Promise<ComparableWithListing[]> {
  const PAGE_SIZE = 1000;
  const allRows: ComparableWithListing[] = [];
  let page = 0;
  
  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    
    const { data, error } = await supabase
      .from('property_comparables')
      .select('id, listing_id, airroi_listing_id, listing_name, host_name, is_selected, ttm_revenue, ttm_adr, ttm_occupancy, metrics_fetched_at, future_rates_fetched_at, fetched_at, selected_at, property_details, location_info')
      .order('id', { ascending: true })
      .range(from, to);
    
    if (error) throw error;
    if (!data || data.length === 0) break;
    
    allRows.push(...(data as ComparableWithListing[]));
    console.log(`Comparables page ${page + 1}: fetched ${data.length} rows, total so far: ${allRows.length}`);
    
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  
  console.log(`COMPLETE: Fetched ${allRows.length} total comparables across ${page + 1} pages`);
  return allRows;
}

// Helper to paginate comp counts for Setup tab
async function fetchAllCompCounts(): Promise<{ listing_id: string; is_selected: boolean | null }[]> {
  const PAGE_SIZE = 1000;
  const allRows: { listing_id: string; is_selected: boolean | null }[] = [];
  let page = 0;
  
  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    
    const { data, error } = await supabase
      .from('property_comparables')
      .select('listing_id, is_selected')
      .order('listing_id', { ascending: true })
      .range(from, to);
    
    if (error) throw error;
    if (!data || data.length === 0) break;
    
    allRows.push(...data);
    
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  
  return allRows;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  airroi_listing_ids: string[];
  created_at: string;
  guesty_account_id: string;
}

type DateFilter = "all" | "never" | "7days" | "30days" | "90days";

const getFilteredByDate = (
  comparables: ComparableWithListing[], 
  filter: DateFilter, 
  dateField: 'metrics_fetched_at' | 'future_rates_fetched_at'
): ComparableWithListing[] => {
  const now = new Date();
  return comparables.filter(c => {
    if (!c.is_selected) return false;
    const fetchedAt = c[dateField];
    
    switch (filter) {
      case "never": return !fetchedAt;
      case "7days": return !fetchedAt || (new Date(fetchedAt) < subDays(now, 7));
      case "30days": return !fetchedAt || (new Date(fetchedAt) < subDays(now, 30));
      case "90days": return !fetchedAt || (new Date(fetchedAt) < subDays(now, 90));
      default: return true;
    }
  });
};

export default function Comparables() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [metricsFilter, setMetricsFilter] = useState<DateFilter>("all");
  const [futureRatesFilter, setFutureRatesFilter] = useState<DateFilter>("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [setupSearchTerm, setSetupSearchTerm] = useState("");
  const [setupBedroomFilter, setSetupBedroomFilter] = useState<string>("all");
  const [propertyFilters, setPropertyFilters] = useState({
    active: true,
    inactive: false,
    listed: true,
    unlisted: false,
    archived: false,
  });

  // Fetch all comparables with pagination to bypass 1000-row limit
  const { data: comparables = [], isLoading: loadingComparables, refetch: refetchComparables } = useQuery({
    queryKey: ['all-comparables'],
    queryFn: fetchAllComparables
  });

  // Fetch all listings with comp stats for Setup tab
  const { data: listingsForSetup = [], isLoading: loadingListings } = useQuery({
    queryKey: ['properties-for-comp-setup'],
    queryFn: async () => {
      const { data: listings, error: listingsError } = await supabase
        .from('listings')
        .select('id, nickname, bedrooms, address, active, is_listed, archived')
        .order('nickname');
      
      if (listingsError) throw listingsError;

      // Get comp counts per listing with pagination
      const compCounts = await fetchAllCompCounts();

      // Aggregate counts
      const countMap = new Map<string, { cached: number; selected: number }>();
      compCounts.forEach(c => {
        const existing = countMap.get(c.listing_id) || { cached: 0, selected: 0 };
        existing.cached++;
        if (c.is_selected) existing.selected++;
        countMap.set(c.listing_id, existing);
      });

      return listings?.map(l => ({
        id: l.id,
        nickname: l.nickname,
        bedrooms: l.bedrooms,
        city: (l.address as any)?.city || null,
        active: l.active,
        is_listed: l.is_listed,
        archived: l.archived,
        cachedCount: countMap.get(l.id)?.cached || 0,
        selectedCount: countMap.get(l.id)?.selected || 0,
      })) || [];
    }
  });

  // Fetch templates
  const { data: templates = [], isLoading: loadingTemplates, refetch: refetchTemplates } = useQuery({
    queryKey: ['compset-templates-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('compset_templates')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Template[];
    }
  });

  // Deduplicate comparables by airroi_listing_id for display
  const deduplicateByAirroiId = (comps: ComparableWithListing[]): ComparableWithListing[] => {
    const seen = new Map<string, ComparableWithListing>();
    for (const comp of comps) {
      // Skip if no valid airroi_listing_id
      if (!comp.airroi_listing_id) continue;
      if (!seen.has(comp.airroi_listing_id)) {
        seen.set(comp.airroi_listing_id, comp);
      }
    }
    return Array.from(seen.values());
  };

  const selectedComparables = comparables.filter(c => c.is_selected);
  const uniqueSelectedComparables = deduplicateByAirroiId(selectedComparables);
  
  // Debug logging
  console.log(`Comparables: ${comparables.length} total, ${selectedComparables.length} selected, ${uniqueSelectedComparables.length} unique selected`);

  // Count how many properties use each airroi_listing_id
  const usageCountByAirroiId = new Map<string, number>();
  selectedComparables.forEach(c => {
    usageCountByAirroiId.set(c.airroi_listing_id, (usageCountByAirroiId.get(c.airroi_listing_id) || 0) + 1);
  });

  // Fetch stats
  const stats = {
    totalCached: comparables.length,
    totalSelected: selectedComparables.length,
    uniqueSelected: uniqueSelectedComparables.length,
    withMetrics: uniqueSelectedComparables.filter(c => c.metrics_fetched_at).length,
    withFutureRates: uniqueSelectedComparables.filter(c => c.future_rates_fetched_at).length,
  };

  // Create lookup for listing nicknames (for "All Cached" tab)
  const listingNicknameById = new Map(listingsForSetup.map(l => [l.id, l.nickname]));

  // Filter comparables based on search
  const filteredComparables = comparables.filter(c => 
    c.listing_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    listingNicknameById.get(c.listing_id)?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.host_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredSelected = uniqueSelectedComparables.filter(c =>
    c.listing_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.host_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Get filtered comparables for bulk actions (use deduplicated list)
  const filteredMetricsComparables = getFilteredByDate(uniqueSelectedComparables, metricsFilter, 'metrics_fetched_at');
  const filteredFutureRatesComparables = getFilteredByDate(uniqueSelectedComparables, futureRatesFilter, 'future_rates_fetched_at');

  // Calculate filter counts for display (use deduplicated list)
  const getFilterCounts = (dateField: 'metrics_fetched_at' | 'future_rates_fetched_at') => {
    const now = new Date();
    return {
      all: uniqueSelectedComparables.length,
      never: uniqueSelectedComparables.filter(c => !c[dateField]).length,
      days7: uniqueSelectedComparables.filter(c => !c[dateField] || new Date(c[dateField]!) < subDays(now, 7)).length,
      days30: uniqueSelectedComparables.filter(c => !c[dateField] || new Date(c[dateField]!) < subDays(now, 30)).length,
      days90: uniqueSelectedComparables.filter(c => !c[dateField] || new Date(c[dateField]!) < subDays(now, 90)).length,
    };
  };

  const metricsCounts = getFilterCounts('metrics_fetched_at');
  const futureRatesCounts = getFilterCounts('future_rates_fetched_at');

  // Compute filtered listings for setup tab count
  const filteredListingsForSetup = listingsForSetup.filter(l => {
    const needsComps = l.selectedCount < 5;
    const hasActiveFilter = propertyFilters.active || propertyFilters.inactive;
    const activeMatch = !hasActiveFilter || 
      (propertyFilters.active && l.active) || 
      (propertyFilters.inactive && !l.active);
    const hasListedFilter = propertyFilters.listed || propertyFilters.unlisted;
    const listedMatch = !hasListedFilter || 
      (propertyFilters.listed && l.is_listed) || 
      (propertyFilters.unlisted && !l.is_listed);
    const archivedMatch = propertyFilters.archived ? true : !l.archived;
    return needsComps && activeMatch && listedMatch && archivedMatch;
  });

  // Bulk fetch historical metrics
  const fetchHistoricalsMutation = useMutation({
    mutationFn: async () => {
      const targetComparables = filteredMetricsComparables;
      const selectedIds = targetComparables.map(c => c.id);
      if (selectedIds.length === 0) throw new Error("No comparables match the filter");
      
      const { data, error } = await supabase.functions.invoke('fetch-comparable-metrics', {
        body: { comparable_ids: selectedIds }
      });
      
      if (error) throw error;
      return { ...data, targetCount: selectedIds.length };
    },
    onSuccess: (data) => {
      toast.success(`Fetched historical metrics for ${data.processed || data.targetCount} comparables`);
      refetchComparables();
    },
    onError: (error) => {
      toast.error(`Failed to fetch metrics: ${error.message}`);
    }
  });

  // Bulk fetch future rates
  const fetchFutureRatesMutation = useMutation({
    mutationFn: async () => {
      const targetComparables = filteredFutureRatesComparables;
      const selectedIds = targetComparables.map(c => c.id);
      if (selectedIds.length === 0) throw new Error("No comparables match the filter");
      
      const { data, error } = await supabase.functions.invoke('fetch-comparable-future-rates', {
        body: { comparable_ids: selectedIds }
      });
      
      if (error) throw error;
      return { ...data, targetCount: selectedIds.length };
    },
    onSuccess: (data) => {
      toast.success(`Fetched future rates for ${data.processed || data.targetCount} comparables`);
      refetchComparables();
    },
    onError: (error) => {
      toast.error(`Failed to fetch future rates: ${error.message}`);
    }
  });

  // Delete template
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from('compset_templates')
        .delete()
        .eq('id', templateId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template deleted");
      refetchTemplates();
      setDeleteTemplateId(null);
    },
    onError: (error) => {
      toast.error(`Failed to delete template: ${error.message}`);
    }
  });

  // Update template
  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, name, description }: { id: string; name: string; description: string }) => {
      const { error } = await supabase
        .from('compset_templates')
        .update({ name, description, updated_at: new Date().toISOString() })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template updated");
      refetchTemplates();
      setEditingTemplateId(null);
    },
    onError: (error) => {
      toast.error(`Failed to update template: ${error.message}`);
    }
  });

  const startEditing = (template: Template) => {
    setEditingTemplateId(template.id);
    setEditName(template.name);
    setEditDescription(template.description || "");
  };

  const cancelEditing = () => {
    setEditingTemplateId(null);
    setEditName("");
    setEditDescription("");
  };

  const saveEditing = () => {
    if (!editingTemplateId || !editName.trim()) return;
    updateTemplateMutation.mutate({
      id: editingTemplateId,
      name: editName.trim(),
      description: editDescription.trim()
    });
  };

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return "-";
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  };

  const formatPercent = (value: number | null) => {
    if (value === null || value === undefined) return "-";
    return `${(value * 100).toFixed(1)}%`;
  };

  const getBedrooms = (comparable: ComparableWithListing) => {
    if (comparable.property_details && typeof comparable.property_details === 'object') {
      return (comparable.property_details as any).bedrooms || "-";
    }
    return "-";
  };

  if (loadingComparables) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Comparables</h1>
          <p className="text-muted-foreground">Manage all property comparables and templates</p>
        </div>

        <Tabs defaultValue="setup" className="space-y-4">
          <TabsList>
            <TabsTrigger value="setup">
              <Settings2 className="h-4 w-4 mr-1" />
              Setup ({filteredListingsForSetup.length})
            </TabsTrigger>
            <TabsTrigger value="selected">All Selected ({stats.uniqueSelected})</TabsTrigger>
            <TabsTrigger value="cached">All Cached ({stats.totalCached})</TabsTrigger>
            <TabsTrigger value="bulk">Bulk Actions</TabsTrigger>
            <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
          </TabsList>

          {/* Setup Tab - Properties needing comps */}
          <TabsContent value="setup" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search properties..."
                    value={setupSearchTerm}
                    onChange={(e) => setSetupSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={setupBedroomFilter} onValueChange={setSetupBedroomFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Bedrooms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Bedrooms</SelectItem>
                    {[...new Set(listingsForSetup.map(l => l.bedrooms).filter(b => b !== null))].sort().map(b => (
                      <SelectItem key={b} value={b?.toString() || "0"}>{b} BR</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="relative">
                      <Filter className="mr-2 h-4 w-4" />
                      Filters
                      {(propertyFilters.active !== true || propertyFilters.inactive !== false ||
                        propertyFilters.listed !== true || propertyFilters.unlisted !== false ||
                        propertyFilters.archived !== false) && (
                        <span className="absolute -top-1 -right-1 h-3 w-3 bg-primary rounded-full" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 z-50 bg-popover" align="end">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Status</p>
                        <div className="space-y-1">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={propertyFilters.active}
                              onCheckedChange={(checked) =>
                                setPropertyFilters((prev) => ({ ...prev, active: !!checked }))
                              }
                            />
                            Active
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={propertyFilters.inactive}
                              onCheckedChange={(checked) =>
                                setPropertyFilters((prev) => ({ ...prev, inactive: !!checked }))
                              }
                            />
                            Inactive
                          </label>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Listing</p>
                        <div className="space-y-1">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={propertyFilters.listed}
                              onCheckedChange={(checked) =>
                                setPropertyFilters((prev) => ({ ...prev, listed: !!checked }))
                              }
                            />
                            Listed
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={propertyFilters.unlisted}
                              onCheckedChange={(checked) =>
                                setPropertyFilters((prev) => ({ ...prev, unlisted: !!checked }))
                              }
                            />
                            Unlisted
                          </label>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Archive</p>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={propertyFilters.archived}
                            onCheckedChange={(checked) =>
                              setPropertyFilters((prev) => ({ ...prev, archived: !!checked }))
                            }
                          />
                          Show Archived
                        </label>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          setPropertyFilters({
                            active: true,
                            inactive: false,
                            listed: true,
                            unlisted: false,
                            archived: false,
                          })
                        }
                      >
                        Reset to Defaults
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <Button onClick={() => setWizardOpen(true)}>
                <Wand2 className="h-4 w-4 mr-2" />
                Quick Setup Wizard
              </Button>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Properties Needing Comparables</CardTitle>
                <CardDescription>
                  Properties with fewer than 5 selected comparables. Use the wizard for bulk selection.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingListings ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Property</TableHead>
                        <TableHead>Bedrooms</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>Cached</TableHead>
                        <TableHead>Selected</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listingsForSetup
                        .filter(l => {
                          const matchesSearch = l.nickname?.toLowerCase().includes(setupSearchTerm.toLowerCase()) ||
                                               l.city?.toLowerCase().includes(setupSearchTerm.toLowerCase());
                          const matchesBedroom = setupBedroomFilter === "all" || l.bedrooms?.toString() === setupBedroomFilter;
                          const needsComps = l.selectedCount < 5;
                          
                          // Property status filters
                          const hasActiveFilter = propertyFilters.active || propertyFilters.inactive;
                          const activeMatch = !hasActiveFilter || 
                            (propertyFilters.active && l.active) || 
                            (propertyFilters.inactive && !l.active);
                          
                          const hasListedFilter = propertyFilters.listed || propertyFilters.unlisted;
                          const listedMatch = !hasListedFilter || 
                            (propertyFilters.listed && l.is_listed) || 
                            (propertyFilters.unlisted && !l.is_listed);
                          
                          const archivedMatch = propertyFilters.archived ? true : !l.archived;
                          
                          return matchesSearch && matchesBedroom && needsComps && activeMatch && listedMatch && archivedMatch;
                        })
                        .map((listing) => (
                          <TableRow key={listing.id}>
                            <TableCell>
                              <Link 
                                to={`/listings/${listing.id}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {listing.nickname || listing.id}
                              </Link>
                            </TableCell>
                            <TableCell>{listing.bedrooms || "-"}</TableCell>
                            <TableCell>{listing.city || "-"}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{listing.cachedCount}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={listing.selectedCount >= 5 ? "default" : listing.selectedCount > 0 ? "outline" : "destructive"}>
                                {listing.selectedCount}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {listing.selectedCount >= 5 ? (
                                <span className="text-green-600 text-sm">✓ Complete</span>
                              ) : listing.cachedCount > 0 ? (
                                <span className="text-yellow-600 text-sm">Needs selection</span>
                              ) : (
                                <span className="text-red-600 text-sm">Needs fetch</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button 
                                variant="outline" 
                                size="sm"
                                asChild
                              >
                                <Link to={`/listings/${listing.id}`}>
                                  View
                                </Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      {listingsForSetup.filter(l => l.selectedCount < 5).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            All properties have 5+ comparables selected! 🎉
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* All Selected Tab */}
          <TabsContent value="selected" className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search comparables..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchComparables()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comparable</TableHead>
                    <TableHead>Used By</TableHead>
                    <TableHead>Bedrooms</TableHead>
                    <TableHead>TTM Revenue</TableHead>
                    <TableHead>TTM ADR</TableHead>
                    <TableHead>TTM Occ</TableHead>
                    <TableHead>Metrics</TableHead>
                    <TableHead>Future Rates</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSelected.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No selected comparables found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSelected.map((comp) => (
                      <TableRow key={comp.airroi_listing_id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{comp.listing_name || "Unknown"}</div>
                            <div className="text-sm text-muted-foreground">{comp.host_name}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {usageCountByAirroiId.get(comp.airroi_listing_id) || 1} {usageCountByAirroiId.get(comp.airroi_listing_id) === 1 ? 'property' : 'properties'}
                          </Badge>
                        </TableCell>
                        <TableCell>{getBedrooms(comp)}</TableCell>
                        <TableCell>{formatCurrency(comp.ttm_revenue)}</TableCell>
                        <TableCell>{formatCurrency(comp.ttm_adr)}</TableCell>
                        <TableCell>{formatPercent(comp.ttm_occupancy)}</TableCell>
                        <TableCell>
                          {comp.metrics_fetched_at ? (
                            <Badge variant="outline" className="text-xs">
                              {formatDistanceToNow(new Date(comp.metrics_fetched_at), { addSuffix: true })}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Not fetched</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {comp.future_rates_fetched_at ? (
                            <Badge variant="outline" className="text-xs">
                              {formatDistanceToNow(new Date(comp.future_rates_fetched_at), { addSuffix: true })}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Not fetched</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* All Cached Tab */}
          <TabsContent value="cached" className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search comparables..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comparable</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Bedrooms</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>TTM Revenue</TableHead>
                    <TableHead>Fetched</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredComparables.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No comparables found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredComparables.map((comp) => (
                      <TableRow key={comp.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{comp.listing_name || "Unknown"}</div>
                            <div className="text-sm text-muted-foreground">{comp.host_name}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Link 
                            to={`/listings/${comp.listing_id}`}
                            className="text-primary hover:underline"
                          >
                            {listingNicknameById.get(comp.listing_id) || comp.listing_id}
                          </Link>
                        </TableCell>
                        <TableCell>{getBedrooms(comp)}</TableCell>
                        <TableCell>
                          {comp.is_selected ? (
                            <Badge>Selected</Badge>
                          ) : (
                            <Badge variant="secondary">Cached</Badge>
                          )}
                        </TableCell>
                        <TableCell>{formatCurrency(comp.ttm_revenue)}</TableCell>
                        <TableCell>
                          {comp.fetched_at ? (
                            <span className="text-sm text-muted-foreground">
                              {formatDistanceToNow(new Date(comp.fetched_at), { addSuffix: true })}
                            </span>
                          ) : "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Bulk Actions Tab */}
          <TabsContent value="bulk" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Unique Selected</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.uniqueSelected}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.totalSelected} total across properties
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">With Historicals</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.withMetrics}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.uniqueSelected - stats.withMetrics} need fetch
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">With Future Rates</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.withFutureRates}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.uniqueSelected - stats.withFutureRates} need fetch
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Cached</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.totalCached}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Historical Metrics
                  </CardTitle>
                  <CardDescription>
                    Fetch TTM revenue, ADR, occupancy, and RevPAR for selected comparables
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Filter by last updated</label>
                    <Select value={metricsFilter} onValueChange={(v) => setMetricsFilter(v as DateFilter)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Selected ({metricsCounts.all})</SelectItem>
                        <SelectItem value="never">Never Fetched ({metricsCounts.never})</SelectItem>
                        <SelectItem value="7days">Older than 7 days ({metricsCounts.days7})</SelectItem>
                        <SelectItem value="30days">Older than 30 days ({metricsCounts.days30})</SelectItem>
                        <SelectItem value="90days">Older than 90 days ({metricsCounts.days90})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button 
                    onClick={() => fetchHistoricalsMutation.mutate()}
                    disabled={fetchHistoricalsMutation.isPending || filteredMetricsComparables.length === 0}
                    className="w-full"
                  >
                    {fetchHistoricalsMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <Database className="h-4 w-4 mr-2" />
                        Fetch Historicals for {filteredMetricsComparables.length} Comparables
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Future Rates
                  </CardTitle>
                  <CardDescription>
                    Fetch forward-looking daily rates for selected comparables
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Filter by last updated</label>
                    <Select value={futureRatesFilter} onValueChange={(v) => setFutureRatesFilter(v as DateFilter)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Selected ({futureRatesCounts.all})</SelectItem>
                        <SelectItem value="never">Never Fetched ({futureRatesCounts.never})</SelectItem>
                        <SelectItem value="7days">Older than 7 days ({futureRatesCounts.days7})</SelectItem>
                        <SelectItem value="30days">Older than 30 days ({futureRatesCounts.days30})</SelectItem>
                        <SelectItem value="90days">Older than 90 days ({futureRatesCounts.days90})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button 
                    onClick={() => fetchFutureRatesMutation.mutate()}
                    disabled={fetchFutureRatesMutation.isPending || filteredFutureRatesComparables.length === 0}
                    className="w-full"
                  >
                    {fetchFutureRatesMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <Calendar className="h-4 w-4 mr-2" />
                        Fetch Future Rates for {filteredFutureRatesComparables.length} Comparables
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Templates Tab */}
          <TabsContent value="templates" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Saved Templates</CardTitle>
                <CardDescription>
                  Manage your compset templates that can be applied to multiple properties
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingTemplates ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : templates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No templates saved yet. Save a compset from a property's Comparables tab.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Comparables</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.map((template) => (
                        <TableRow key={template.id}>
                          <TableCell>
                            {editingTemplateId === template.id ? (
                              <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="h-8"
                              />
                            ) : (
                              <span className="font-medium">{template.name}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {editingTemplateId === template.id ? (
                              <Input
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                placeholder="Optional description"
                                className="h-8"
                              />
                            ) : (
                              <span className="text-muted-foreground">{template.description || "-"}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {template.airroi_listing_ids?.length || 0} properties
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {format(new Date(template.created_at), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="text-right">
                            {editingTemplateId === template.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={saveEditing}
                                  disabled={updateTemplateMutation.isPending}
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={cancelEditing}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => startEditing(template)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeleteTemplateId(template.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Template Confirmation */}
      <AlertDialog open={!!deleteTemplateId} onOpenChange={() => setDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this template? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTemplateId && deleteTemplateMutation.mutate(deleteTemplateId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Comp Selection Wizard */}
      <CompSelectionWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        properties={listingsForSetup.filter(l => l.selectedCount < 5)}
        templates={templates}
        propertiesWithComps={listingsForSetup.filter(l => l.selectedCount > 0)}
      />
    </DashboardLayout>
  );
}

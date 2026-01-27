import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PropertiesTable, type ColumnKey } from "@/components/PropertiesTable";
import { PropertyMetricsSummary } from "@/components/PropertyMetricsSummary";
import { BulkGoalsUpload } from "@/components/BulkGoalsUpload";
import { SyncProgressCard } from "@/components/SyncProgressCard";
import { PacingReport } from "@/components/PacingReport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Download, Search, Sparkles, Filter, ArrowUpDown, ArrowUp, ArrowDown, Upload, ChevronDown, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { type NavigationReferrer } from "@/hooks/useSmartNavigation";

const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ['property', 'actual', 'onTheBooks', 'occupancy', 'adr', 'revpar', 'goal', 'forecast', 'goalProgress', 'status'];
const DEFAULT_COLUMN_ORDER: ColumnKey[] = ['property', 'actual', 'onTheBooks', 'occupancy', 'adr', 'revpar', 'goal', 'forecast', 'goalProgress', 'status'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 
                     'July', 'August', 'September', 'October', 'November', 'December'];

interface PropertyMetrics {
  id: string;
  nickname: string;
  thumbnail: string | null;
  address: any;
  propertyType: string | null;
  actualRevenue: number;
  onTheBooksRevenue: number;
  projectionTotal: number;
  forecastedRevenue: number;
  forecastUpdatedAt: string | null;
  projectionAchievement: number;
  forecastProjectionAchievement: number;
  status: "on-track" | "at-risk" | "behind";
  hasGoals: boolean;
  hasLockedGoals: boolean;
  goalsLockedCount: number;
  archived: boolean;
  occupancy?: number;
  adr?: number;
  revpar?: number;
}

export default function PropertiesBulkEdit() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null); // null = Full Year, 1-12 = specific month
  const [searchQuery, setSearchQuery] = useState("");
  const [propertyFilters, setPropertyFilters] = useState({
    active: true,
    inactive: false,
    listed: true,
    unlisted: false,
    archived: false,
  });
  const [statusFilters, setStatusFilters] = useState({
    onTrack: true,
    atRisk: true,
    behind: true,
  });
  const [goalsFilters, setGoalsFilters] = useState({
    hasGoals: true,
    noGoals: true,
    locked: true,
    unlocked: true,
  });
  const [isGeneratingBulk, setIsGeneratingBulk] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "actual" | "onTheBooks" | "occupancy" | "adr" | "revpar" | "goal" | "forecast" | "goalProgress" | "status">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);

  // Column configuration state with localStorage persistence
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem('portfolio-columns-visible');
    if (saved) {
      const parsed = JSON.parse(saved) as ColumnKey[];
      // Ensure onTheBooks is always included (added in recent update)
      if (!parsed.includes('onTheBooks')) {
        parsed.splice(parsed.indexOf('actual') + 1 || 1, 0, 'onTheBooks');
      }
      return parsed;
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => {
    const saved = localStorage.getItem('portfolio-columns-order');
    if (saved) {
      const parsed = JSON.parse(saved) as ColumnKey[];
      // Ensure onTheBooks is in the order (added in recent update)
      if (!parsed.includes('onTheBooks')) {
        const actualIndex = parsed.indexOf('actual');
        parsed.splice(actualIndex + 1, 0, 'onTheBooks');
      }
      return parsed;
    }
    return DEFAULT_COLUMN_ORDER;
  });

  const handleColumnConfigChange = (visible: ColumnKey[], order: ColumnKey[]) => {
    setVisibleColumns(visible);
    setColumnOrder(order);
    localStorage.setItem('portfolio-columns-visible', JSON.stringify(visible));
    localStorage.setItem('portfolio-columns-order', JSON.stringify(order));
  };

  // Fetch current guesty account ID for progress tracking
  useEffect(() => {
    const fetchAccountId = async () => {
      const { data: userOrgs } = await supabase
        .from('organization_members')
        .select('organization_id')
        .limit(1);
      
      if (userOrgs && userOrgs.length > 0) {
        const { data: accounts } = await supabase
          .from('guesty_accounts')
          .select('id')
          .eq('organization_id', userOrgs[0].organization_id)
          .limit(1);
        
        if (accounts && accounts.length > 0) {
          setCurrentAccountId(accounts[0].id);
        }
      }
    };
    fetchAccountId();
  }, []);

  // Fetch all data in parallel
  const { data: listings = [], isLoading: listingsLoading, refetch: refetchListings } = useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("*");
      if (error) throw error;
      return data;
    },
  });

  // Derived: listing IDs for scoping goals query and avoiding pagination truncation
  const listingIds: string[] = useMemo(() => listings.map((l: any) => String(l.id)), [listings]);

  // Removed: ytdRevenueData RPC query - now using reservation_nights for accurate per-night revenue

  const { data: goals = [], isLoading: goalsLoading, refetch: refetchGoals } = useQuery({
    queryKey: ["property_goals", selectedYear, listingIds],
    enabled: listingIds.length > 0,
    queryFn: async () => {
      // Fetch in batches to avoid the 1000 row cap per request
      const BATCH_SIZE = 60; // 60 listings * 12 months = 720 rows < 1000
      const chunks: string[][] = [];
      for (let i = 0; i < listingIds.length; i += BATCH_SIZE) {
        chunks.push(listingIds.slice(i, i + BATCH_SIZE));
      }

      const promises = chunks.map((batchIds) =>
        supabase
          .from("property_goals")
          .select("*")
          .eq("year", selectedYear)
          .in("listing_id", batchIds)
          .order("listing_id", { ascending: true })
          .order("month", { ascending: true })
      );

      const results = await Promise.all(promises);
      const all: any[] = [];
      for (const res of results) {
        if (res.error) throw res.error;
        if (res.data) all.push(...res.data);
      }

      console.log("Goals batched fetch", {
        batches: chunks.length,
        listingCount: listingIds.length,
        goalsCount: all.length,
        expectedMax: listingIds.length * 12,
      });

      return all;
    },
  });

  // Fast lookup: goals grouped by listing_id
  const goalsByListing = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const g of goals) {
      const key = String((g as any).listing_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return map;
  }, [goals]);

  const { data: forecasts = [], isLoading: forecastsLoading } = useQuery({
    queryKey: ["revenue_forecasts", selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("revenue_forecasts")
        .select("*")
        .eq("year", selectedYear);
      if (error) throw error;
      return data;
    },
  });

  // Fetch aggregated reservation metrics using RPC to avoid 1000 row limit
  const { data: portfolioMetrics = [] } = useQuery({
    queryKey: ["portfolio-night-metrics", selectedYear, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_portfolio_night_metrics', {
        p_year: selectedYear,
        p_month: selectedMonth // null for full year, 1-12 for specific month
      });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch all reservations for PacingReport (paginated to avoid 1000 row limit)
  const { data: allReservations = [] } = useQuery({
    queryKey: ["portfolio-reservations"],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const results: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("reservations")
          .select("*")
          .in("status", ["confirmed", "checked_in", "checked_out"])
          .neq("source", "owner")
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return results;
    },
  });

  // Create lookup map for fast access to pre-aggregated metrics
  const metricsMap = useMemo(() => {
    const map = new Map<string, {
      actual_revenue: number;
      otb_revenue: number;
      past_nights: number;
      future_nights: number;
    }>();
    for (const m of portfolioMetrics) {
      map.set(m.listing_id, {
        actual_revenue: Number(m.actual_revenue) || 0,
        otb_revenue: Number(m.otb_revenue) || 0,
        past_nights: Number(m.past_nights) || 0,
        future_nights: Number(m.future_nights) || 0,
      });
    }
    return map;
  }, [portfolioMetrics]);

  // Calculate period info based on selected month
  const periodInfo = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    
    if (selectedMonth === null) {
      // Full Year mode
      return {
        start: `${selectedYear}-01-01`,
        end: `${selectedYear}-12-31`,
        actualCutoff: todayStr,
        isPastPeriod: selectedYear < currentYear,
        isFuturePeriod: selectedYear > currentYear,
        isCurrentPeriod: selectedYear === currentYear,
        label: `${selectedYear}`,
        periodLabel: selectedYear === currentYear ? 'YTD' : `${selectedYear}`,
      };
    } else {
      // Specific month mode
      const monthStr = String(selectedMonth).padStart(2, '0');
      const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
      const periodStart = `${selectedYear}-${monthStr}-01`;
      const periodEnd = `${selectedYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
      
      const isPast = selectedYear < currentYear || 
                     (selectedYear === currentYear && selectedMonth < currentMonth);
      const isFuture = selectedYear > currentYear || 
                       (selectedYear === currentYear && selectedMonth > currentMonth);
      const isCurrent = selectedYear === currentYear && selectedMonth === currentMonth;
      
      return {
        start: periodStart,
        end: periodEnd,
        actualCutoff: todayStr,
        isPastPeriod: isPast,
        isFuturePeriod: isFuture,
        isCurrentPeriod: isCurrent,
        label: `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`,
        periodLabel: MONTH_NAMES[selectedMonth - 1],
      };
    }
  }, [selectedYear, selectedMonth]);

  // Calculate days in range for occupancy calculations (only past days)
  const daysInRange = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const periodStart = new Date(periodInfo.start);
    const periodEnd = new Date(periodInfo.end);
    
    // For "actual" calculations, only count days up to today (if period extends beyond)
    const actualEnd = periodEnd < today ? periodEnd : today;
    
    // If period hasn't started yet, return 0
    if (actualEnd < periodStart) return 0;
    
    return Math.floor((actualEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }, [periodInfo]);

  // Realtime: refetch goals when new rows for the selected year are inserted/updated
  useEffect(() => {
    const channel = supabase
      .channel('property_goals_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'property_goals' },
        (payload) => {
          const yr = (payload.new as any)?.year ?? (payload.old as any)?.year;
          if (yr === selectedYear) {
            refetchGoals();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedYear, refetchGoals]);
  // Calculate metrics for each property
  const propertyMetrics = useMemo(() => {
    if (!listings.length) return [];

    return listings.map((listing): PropertyMetrics => {
      // Get pre-aggregated metrics from RPC (avoids 1000 row limit)
      const metrics = metricsMap.get(listing.id) || {
        actual_revenue: 0,
        otb_revenue: 0,
        past_nights: 0,
        future_nights: 0,
      };
      
      const actualRevenue = metrics.actual_revenue;
      const onTheBooksRevenue = metrics.otb_revenue;
      const pastNightsCount = metrics.past_nights;

      // Calculate goals using precomputed map, filtered to selected period
      const listingGoals = goalsByListing.get(String(listing.id)) || [];
      const periodGoals = selectedMonth === null 
        ? listingGoals 
        : listingGoals.filter((g: any) => g.month === selectedMonth);
      
      const projectionTotal = periodGoals.reduce(
        (sum, g) => sum + (Number(g.projection_revenue) || 0),
        0
      );

      // Get forecast, filtered to period
      const forecast = forecasts.find((f) => f.listing_id === listing.id);
      let forecastedRevenue = 0;
      
      if (selectedMonth === null) {
        // Full year forecast
        const totalForecast = forecast?.total_forecast as { p50?: number } | null;
        forecastedRevenue = totalForecast?.p50 || 0;
      } else {
        // Monthly forecast
        const monthlyForecasts = (forecast?.monthly_forecasts as any[]) || [];
        const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        const monthForecast = monthlyForecasts.find((mf: any) => mf.month === monthKey);
        forecastedRevenue = monthForecast?.total_forecast_p50 || 0;
      }
      
      const forecastUpdatedAt = forecast?.generated_at || null;

      // Calculate achievement percentages
      const projectionAchievement = projectionTotal > 0 ? (actualRevenue / projectionTotal) * 100 : 0;

      // Calculate forecast achievement percentage
      const forecastProjectionAchievement = projectionTotal > 0 ? (forecastedRevenue / projectionTotal) * 100 : 0;

      // Determine status based on forecast vs projection
      let status: "on-track" | "at-risk" | "behind" = "on-track";
      if (projectionTotal > 0) {
        if (forecastProjectionAchievement >= 95) status = "on-track";
        else if (forecastProjectionAchievement >= 80) status = "at-risk";
        else status = "behind";
      }

      // Calculate goal lock status
      const hasGoals = projectionTotal > 0;
      const hasLockedGoals = periodGoals.some((g: any) => g.locked);
      const goalsLockedCount = periodGoals.filter((g: any) => g.locked).length;

      // Calculate occupancy, ADR, RevPAR using past nights count from RPC
      const occupancy = daysInRange > 0 ? (pastNightsCount / daysInRange) * 100 : 0;
      const adr = pastNightsCount > 0 ? actualRevenue / pastNightsCount : 0;
      const revpar = daysInRange > 0 ? actualRevenue / daysInRange : 0;

      return {
        id: listing.id,
        nickname: listing.nickname || "Unnamed Property",
        thumbnail: listing.thumbnail,
        address: listing.address,
        propertyType: listing.property_type,
        actualRevenue,
        onTheBooksRevenue,
        projectionTotal,
        forecastedRevenue,
        forecastUpdatedAt,
        projectionAchievement,
        forecastProjectionAchievement,
        status,
        hasGoals,
        hasLockedGoals,
        goalsLockedCount,
        archived: listing.archived || false,
        occupancy,
        adr,
        revpar,
      };
    });
  }, [listings, forecasts, daysInRange, goalsByListing, metricsMap, selectedMonth, selectedYear]);

  // Filter and sort properties
  const filteredProperties = useMemo(() => {
    const filtered = propertyMetrics.filter((property) => {
      // Get the listing to check property filters
      const listing = listings.find(l => l.id === property.id);
      if (!listing) return false;

      // Property status filters
      const activeMatch = (propertyFilters.active && listing.active) || 
                         (propertyFilters.inactive && !listing.active);
      const listedMatch = (propertyFilters.listed && listing.is_listed) || 
                         (propertyFilters.unlisted && !listing.is_listed);
      const archivedMatch = (propertyFilters.archived && listing.archived) || 
                           (!propertyFilters.archived && !listing.archived);
      
      const hasPropertyFilter = propertyFilters.active || propertyFilters.inactive;
      const hasListedFilter = propertyFilters.listed || propertyFilters.unlisted;
      
      const propertyStatusMatch = 
        (!hasPropertyFilter || activeMatch) &&
        (!hasListedFilter || listedMatch) &&
        archivedMatch;

      // Performance status filters
      const hasStatusFilter = statusFilters.onTrack || statusFilters.atRisk || statusFilters.behind;
      const statusMatch = !hasStatusFilter || 
        (statusFilters.onTrack && property.status === "on-track") ||
        (statusFilters.atRisk && property.status === "at-risk") ||
        (statusFilters.behind && property.status === "behind");

      // Goals filters
      const hasGoalsFilter = goalsFilters.hasGoals || goalsFilters.noGoals || goalsFilters.locked || goalsFilters.unlocked;
      
      let goalsMatch = true;
      if (hasGoalsFilter) {
        goalsMatch = 
          (goalsFilters.noGoals && !property.hasGoals) ||
          (goalsFilters.hasGoals && property.hasGoals && !property.hasLockedGoals) ||
          (goalsFilters.locked && property.hasLockedGoals) ||
          (goalsFilters.unlocked && property.hasGoals && !property.hasLockedGoals);
      }

      // Search filter
      const matchesSearch = property.nickname
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      
      return propertyStatusMatch && statusMatch && goalsMatch && matchesSearch;
    });

    // Apply sorting
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case "name":
          comparison = a.nickname.localeCompare(b.nickname);
          break;
        case "actual":
          comparison = a.actualRevenue - b.actualRevenue;
          break;
        case "onTheBooks":
          comparison = a.onTheBooksRevenue - b.onTheBooksRevenue;
          break;
        case "occupancy":
          comparison = (a.occupancy ?? 0) - (b.occupancy ?? 0);
          break;
        case "adr":
          comparison = (a.adr ?? 0) - (b.adr ?? 0);
          break;
        case "revpar":
          comparison = (a.revpar ?? 0) - (b.revpar ?? 0);
          break;
        case "goal":
          comparison = a.projectionTotal - b.projectionTotal;
          break;
        case "forecast":
          comparison = a.forecastedRevenue - b.forecastedRevenue;
          break;
        case "goalProgress":
          comparison = a.forecastProjectionAchievement - b.forecastProjectionAchievement;
          break;
        case "status":
          const statusOrder = { "behind": 0, "at-risk": 1, "on-track": 2 };
          comparison = statusOrder[a.status] - statusOrder[b.status];
          break;
      }
      
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [propertyMetrics, listings, searchQuery, propertyFilters, statusFilters, goalsFilters, sortBy, sortDirection]);

  // Calculate portfolio totals based on filtered properties
  const portfolioTotals = useMemo(() => {
    return filteredProperties.reduce(
      (acc, property) => ({
        actualRevenue: acc.actualRevenue + property.actualRevenue,
        onTheBooksRevenue: acc.onTheBooksRevenue + property.onTheBooksRevenue,
        projectionTotal: acc.projectionTotal + property.projectionTotal,
        forecastedRevenue: acc.forecastedRevenue + property.forecastedRevenue,
      }),
      {
        actualRevenue: 0,
        onTheBooksRevenue: 0,
        projectionTotal: 0,
        forecastedRevenue: 0,
      }
    );
  }, [filteredProperties]);

  const handleRefreshForecasts = async () => {
    toast.info("Starting forecast generation for all properties...");
    try {
      const { data, error } = await supabase.functions.invoke("generate-all-forecasts");
      if (error) throw error;
      
      const estimatedMinutes = data?.estimated_duration_minutes || 20;
      toast.success(
        `Forecast generation started in background for ${data?.total_properties || 0} properties (${data?.total_forecasts || 0} forecasts). ` +
        `This may take ${estimatedMinutes}-${estimatedMinutes + 10} minutes. Please refresh the page after waiting.`
      );
    } catch (error) {
      console.error("Error generating forecasts:", error);
      toast.error("Failed to start forecast generation");
    }
  };

  const handleGenerateMissingForecasts = async () => {
    toast.info("Checking for properties missing forecasts...");
    try {
      const { data, error } = await supabase.functions.invoke('generate-missing-forecasts');
      
      if (error) throw error;
      
      const propertiesCount = data?.properties_processed || 0;
      const estimatedMinutes = data?.estimated_duration_minutes || 0;
      
      if (propertiesCount === 0) {
        toast.success("All properties already have forecasts for the current and next year.");
      } else {
        toast.success(
          `Forecast generation started for ${propertiesCount} properties missing forecasts. ` +
          `Estimated time: ~${estimatedMinutes} minutes. Please refresh after waiting.`
        );
      }
    } catch (error: any) {
      console.error('Error generating missing forecasts:', error);
      toast.error(error.message || "Failed to start forecast generation");
    }
  };

  const handleGenerateBulkGoals = async () => {
    setIsGeneratingBulk(true);
    toast.info("Starting goal generation for all properties... This will run in the background and may take several minutes.");
    try {
      const { data, error } = await supabase.functions.invoke('generate-bulk-goals', {
        body: { year: selectedYear, excludeLocked: true }
      });

      if (error) throw error;

      toast.success(`Goal generation started for ${data.totalProperties} properties. Please refresh in a few minutes to see results.`);
    } catch (error: any) {
      console.error("Error starting goal generation:", error);
      toast.error(error.message || "Failed to start goal generation");
    } finally {
      setIsGeneratingBulk(false);
    }
  };

  const handleGenerateMissingGoals = async () => {
    setIsGeneratingBulk(true);
    toast.info("Starting goal generation for properties without goals... This will run in the background.");
    try {
      const { data, error } = await supabase.functions.invoke('generate-bulk-goals', {
        body: { year: selectedYear, onlyMissingGoals: true }
      });

      if (error) throw error;

      toast.success(`Goal generation started for ${data.totalProperties} properties without goals. Please refresh in a few minutes to see results.`);
    } catch (error: any) {
      console.error("Error starting goal generation:", error);
      toast.error(error.message || "Failed to start goal generation");
    } finally {
      setIsGeneratingBulk(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredProperties.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProperties.map(p => p.id)));
    }
  };

  const handleSelectProperty = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkArchive = async (archive: boolean) => {
    const idsArray = Array.from(selectedIds);
    
    const { error } = await supabase
      .from("listings")
      .update({ archived: archive })
      .in("id", idsArray);

    if (error) {
      toast.error("Failed to update properties", {
        description: error.message,
      });
      return;
    }

    toast.success(
      archive ? "Properties archived" : "Properties restored",
      {
        description: `${idsArray.length} ${idsArray.length === 1 ? 'property' : 'properties'} ${archive ? 'archived' : 'restored'} successfully.`,
      }
    );

    setSelectedIds(new Set());
    refetchListings();
  };

  const handleExportCSV = () => {
    const headers = [
      "Property",
      "Type",
      "Location",
      "Actual Revenue",
      "Goal",
      "Forecast",
      "Goal Achievement %",
      "Status",
    ];
    
    const rows = filteredProperties.map((p) => [
      p.nickname,
      p.propertyType || "",
      p.address?.city || "",
      p.actualRevenue.toFixed(2),
      p.projectionTotal.toFixed(2),
      p.forecastedRevenue.toFixed(2),
      p.projectionAchievement.toFixed(1),
      p.status,
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `properties-bulk-${selectedYear}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const isLoading = listingsLoading || goalsLoading || forecastsLoading;

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDirection("asc");
    }
  };

  const SortButton = ({ field, label }: { field: typeof sortBy; label: string }) => {
    const isActive = sortBy === field;
    const Icon = isActive ? (sortDirection === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    
    return (
      <Button
        variant={isActive ? "default" : "outline"}
        size="sm"
        onClick={() => handleSort(field)}
      >
        {label}
        <Icon className="ml-2 h-4 w-4" />
      </Button>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-bold">Portfolio Overview</h1>
              <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(parseInt(value))}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={currentYear.toString()}>{currentYear}</SelectItem>
                  <SelectItem value={(currentYear + 1).toString()}>{currentYear + 1}</SelectItem>
                </SelectContent>
              </Select>
              <Select 
                value={selectedMonth === null ? "full-year" : selectedMonth.toString()} 
                onValueChange={(value) => setSelectedMonth(value === "full-year" ? null : parseInt(value))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full-year">Full Year</SelectItem>
                  {MONTH_NAMES.map((month, idx) => (
                    <SelectItem key={idx + 1} value={(idx + 1).toString()}>{month}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-muted-foreground">
              {periodInfo.periodLabel} - View and compare revenue metrics across all properties
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => setIsBulkUploadOpen(true)}
              variant="default"
              size="sm"
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Projections
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Goals
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover">
                <DropdownMenuItem 
                  onClick={handleGenerateMissingGoals}
                  disabled={isGeneratingBulk}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Missing Goals
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={handleGenerateBulkGoals}
                  disabled={isGeneratingBulk}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Regenerate All Goals
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="h-4 w-4 mr-2" />
                  More
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover">
                <DropdownMenuLabel>Forecasts</DropdownMenuLabel>
                <DropdownMenuItem onClick={handleGenerateMissingForecasts}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Missing Forecasts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRefreshForecasts}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh All Forecasts
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Export</DropdownMenuLabel>
                <DropdownMenuItem onClick={handleExportCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Tabs defaultValue="portfolio" className="space-y-6">
          <TabsList className="grid w-full max-w-[300px] grid-cols-2">
            <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
            <TabsTrigger value="pacing">Pacing</TabsTrigger>
          </TabsList>

          <TabsContent value="portfolio" className="space-y-6">
            <PropertyMetricsSummary
              totalActualRevenue={portfolioTotals.actualRevenue}
              totalOnTheBooks={portfolioTotals.onTheBooksRevenue}
              totalProjection={portfolioTotals.projectionTotal}
              totalForecast={portfolioTotals.forecastedRevenue}
              propertiesCount={filteredProperties.length}
              onTrackCount={filteredProperties.filter((p) => p.status === "on-track").length}
              atRiskCount={filteredProperties.filter((p) => p.status === "at-risk").length}
              behindCount={filteredProperties.filter((p) => p.status === "behind").length}
              periodLabel={periodInfo.periodLabel}
              isPastPeriod={periodInfo.isPastPeriod}
              isFuturePeriod={periodInfo.isFuturePeriod}
            />

            <div className="space-y-3">
              <div className="flex gap-3 items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search properties..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="relative">
                      <Filter className="mr-2 h-4 w-4" />
                      Property Filters
                      {(() => {
                        const count = Object.values(propertyFilters).filter(Boolean).length;
                        return count > 0 ? (
                          <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center" variant="secondary">
                            {count}
                          </Badge>
                        ) : null;
                      })()}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 z-50 bg-popover" align="end">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium mb-3">Status</h4>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="prop-active"
                              checked={propertyFilters.active}
                              onCheckedChange={(checked) =>
                                setPropertyFilters({ ...propertyFilters, active: checked as boolean })
                              }
                            />
                            <label htmlFor="prop-active" className="text-sm cursor-pointer">
                              Active
                            </label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="prop-inactive"
                              checked={propertyFilters.inactive}
                              onCheckedChange={(checked) =>
                                setPropertyFilters({ ...propertyFilters, inactive: checked as boolean })
                              }
                            />
                            <label htmlFor="prop-inactive" className="text-sm cursor-pointer">
                              Inactive
                            </label>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-medium mb-3">Listing</h4>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="prop-listed"
                              checked={propertyFilters.listed}
                              onCheckedChange={(checked) =>
                                setPropertyFilters({ ...propertyFilters, listed: checked as boolean })
                              }
                            />
                            <label htmlFor="prop-listed" className="text-sm cursor-pointer">
                              Listed
                            </label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="prop-unlisted"
                              checked={propertyFilters.unlisted}
                              onCheckedChange={(checked) =>
                                setPropertyFilters({ ...propertyFilters, unlisted: checked as boolean })
                              }
                            />
                            <label htmlFor="prop-unlisted" className="text-sm cursor-pointer">
                              Unlisted
                            </label>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-medium mb-3">Archive</h4>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="prop-archived"
                              checked={propertyFilters.archived}
                              onCheckedChange={(checked) =>
                                setPropertyFilters({ ...propertyFilters, archived: checked as boolean })
                              }
                            />
                            <label htmlFor="prop-archived" className="text-sm cursor-pointer">
                              Show Archived
                            </label>
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="outline"
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
                        Reset
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="relative">
                      <Filter className="mr-2 h-4 w-4" />
                      Performance
                      {(() => {
                        const count = Object.values(statusFilters).filter(Boolean).length;
                        return count > 0 && count < 3 ? (
                          <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center" variant="secondary">
                            {count}
                          </Badge>
                        ) : null;
                      })()}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 z-50 bg-popover" align="end">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium mb-3">Status</h4>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="status-ontrack"
                              checked={statusFilters.onTrack}
                              onCheckedChange={(checked) =>
                                setStatusFilters({ ...statusFilters, onTrack: checked as boolean })
                              }
                            />
                            <label htmlFor="status-ontrack" className="text-sm cursor-pointer">
                              On Track
                            </label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="status-atrisk"
                              checked={statusFilters.atRisk}
                              onCheckedChange={(checked) =>
                                setStatusFilters({ ...statusFilters, atRisk: checked as boolean })
                              }
                            />
                            <label htmlFor="status-atrisk" className="text-sm cursor-pointer">
                              At Risk
                            </label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="status-behind"
                              checked={statusFilters.behind}
                              onCheckedChange={(checked) =>
                                setStatusFilters({ ...statusFilters, behind: checked as boolean })
                              }
                            />
                            <label htmlFor="status-behind" className="text-sm cursor-pointer">
                              Behind
                            </label>
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          setStatusFilters({
                            onTrack: true,
                            atRisk: true,
                            behind: true,
                          })
                        }
                      >
                        Reset
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="relative">
                      <Filter className="mr-2 h-4 w-4" />
                      Goals
                      {(() => {
                        const count = Object.values(goalsFilters).filter(Boolean).length;
                        return count > 0 && count < 4 ? (
                          <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center" variant="secondary">
                            {count}
                          </Badge>
                        ) : null;
                      })()}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 z-50 bg-popover" align="end">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium mb-3">Goal Status</h4>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="goals-has"
                              checked={goalsFilters.hasGoals}
                              onCheckedChange={(checked) =>
                                setGoalsFilters({ ...goalsFilters, hasGoals: checked as boolean })
                              }
                            />
                            <label htmlFor="goals-has" className="text-sm cursor-pointer">
                              Has Goals
                            </label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="goals-none"
                              checked={goalsFilters.noGoals}
                              onCheckedChange={(checked) =>
                                setGoalsFilters({ ...goalsFilters, noGoals: checked as boolean })
                              }
                            />
                            <label htmlFor="goals-none" className="text-sm cursor-pointer">
                              No Goals
                            </label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="goals-locked"
                              checked={goalsFilters.locked}
                              onCheckedChange={(checked) =>
                                setGoalsFilters({ ...goalsFilters, locked: checked as boolean })
                              }
                            />
                            <label htmlFor="goals-locked" className="text-sm cursor-pointer">
                              Locked
                            </label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="goals-unlocked"
                              checked={goalsFilters.unlocked}
                              onCheckedChange={(checked) =>
                                setGoalsFilters({ ...goalsFilters, unlocked: checked as boolean })
                              }
                            />
                            <label htmlFor="goals-unlocked" className="text-sm cursor-pointer">
                              Unlocked
                            </label>
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          setGoalsFilters({
                            hasGoals: true,
                            noGoals: true,
                            locked: true,
                            unlocked: true,
                          })
                        }
                      >
                        Reset
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              
              <p className="text-sm text-muted-foreground">
                Showing {filteredProperties.length} of {propertyMetrics.length} {propertyMetrics.length === 1 ? 'property' : 'properties'}
              </p>
            </div>

            {/* Bulk Actions Toolbar */}
            {selectedIds.size > 0 && (
              <div className="sticky top-0 z-10 bg-card border rounded-lg p-4 shadow-md">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-base px-3 py-1">
                      {selectedIds.size} {selectedIds.size === 1 ? 'property' : 'properties'} selected
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear Selection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBulkArchive(false)}
                      disabled={Array.from(selectedIds).every(id => {
                        const prop = propertyMetrics.find(p => p.id === id);
                        return !prop?.archived;
                      })}
                    >
                      Restore Selected
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleBulkArchive(true)}
                      disabled={Array.from(selectedIds).every(id => {
                        const prop = propertyMetrics.find(p => p.id === id);
                        return prop?.archived;
                      })}
                    >
                      Archive Selected
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <PropertiesTable 
              properties={filteredProperties} 
              isLoading={isLoading}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSort={handleSort}
              selectable={true}
              selectedIds={selectedIds}
              onSelectProperty={handleSelectProperty}
              onSelectAll={handleSelectAll}
              visibleColumns={visibleColumns}
              columnOrder={columnOrder}
              onColumnConfigChange={handleColumnConfigChange}
              showColumnConfig={true}
              periodLabel={periodInfo.periodLabel}
              isPastPeriod={periodInfo.isPastPeriod}
              isFuturePeriod={periodInfo.isFuturePeriod}
              showActualColumn={!periodInfo.isFuturePeriod}
              showOnTheBooksColumn={true}
              referrer={{
                path: '/properties/bulk-edit',
                label: 'Portfolio View',
                state: {
                  searchQuery,
                  filters: { propertyFilters, statusFilters, goalsFilters },
                  sortBy,
                  sortDirection,
                  scrollPosition: window.scrollY
                }
              }}
            />
          </TabsContent>

          <TabsContent value="pacing">
            {allReservations.length > 0 ? (
              <PacingReport 
                reservations={allReservations} 
                listingIds={listingIds} 
              />
            ) : (
              <Card>
                <CardContent className="text-center py-12">
                  <p className="text-muted-foreground">
                    No reservation data available for pacing report
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <BulkGoalsUpload 
          open={isBulkUploadOpen} 
          onOpenChange={setIsBulkUploadOpen}
          onSuccess={() => {
            refetchGoals();
            refetchListings();
          }}
        />
      </div>
    </DashboardLayout>
  );
}

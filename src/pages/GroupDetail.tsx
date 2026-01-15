import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, DollarSign, Calendar, TrendingUp, Building2, Plus, FolderOpen, Search, X, UserPlus, Info as InfoIcon } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PacingReport } from "@/components/PacingReport";
import { GoalsComparison } from "@/components/GoalsComparison";
import { StripeDateRangePicker, type DateRange } from "@/components/StripeDateRangePicker";
import { PropertiesTable } from "@/components/PropertiesTable";
import { format, startOfYear, differenceInDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { type NavigationReferrer } from "@/hooks/useSmartNavigation";

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isCreateSubGroupOpen, setIsCreateSubGroupOpen] = useState(false);
  const [isEditingProperties, setIsEditingProperties] = useState(false);
  const [subGroupName, setSubGroupName] = useState("");
  const [subGroupDescription, setSubGroupDescription] = useState("");
  const [selectedListings, setSelectedListings] = useState<string[]>([]);
  const [selectedNewListings, setSelectedNewListings] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [addSearchQuery, setAddSearchQuery] = useState("");
  const [removeListingId, setRemoveListingId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfYear(new Date()),
    to: new Date(),
  });
  const [sortBy, setSortBy] = useState<"name" | "actual" | "forecast" | "goalProgress" | "status">("actual");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showDistributedRevenue, setShowDistributedRevenue] = useState(false);

  // Effective date range with fallbacks for "All time" (undefined dates)
  const effectiveDateRange = useMemo(() => ({
    from: dateRange.from || new Date(2020, 0, 1),
    to: dateRange.to || new Date(),
  }), [dateRange.from, dateRange.to]);

  const { data: group, isLoading: isGroupLoading, refetch: refetchGroup } = useQuery({
    queryKey: ["property-group", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_groups")
        .select(`
          *,
          property_group_members (
            listing_id,
            listings (
              id,
              nickname,
              thumbnail,
              address
            )
          )
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch sub-groups
  const { data: subGroups, refetch: refetchSubGroups } = useQuery({
    queryKey: ["sub-groups", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_groups")
        .select(`
          *,
          property_group_members (
            listing_id,
            listings (
              id,
              nickname,
              thumbnail
            )
          )
        `)
        .eq("parent_group_id", id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Get all listing IDs including from sub-groups
  const directListingIds = group?.property_group_members.map((m: any) => m.listing_id) || [];
  const subGroupListingIds = subGroups?.flatMap((sg: any) => 
    sg.property_group_members.map((m: any) => m.listing_id)
  ) || [];
  const listingIds = [...new Set([...directListingIds, ...subGroupListingIds])];

  // Fetch composite status for listings
  const { data: listingsWithComposite } = useQuery({
    queryKey: ["listings-composite-status", listingIds],
    queryFn: async () => {
      if (listingIds.length === 0) return [];
      const { data, error } = await supabase
        .from("listings")
        .select("id, is_composite")
        .in("id", listingIds);
      if (error) throw error;
      return data || [];
    },
    enabled: listingIds.length > 0,
  });

  // Separate composite and non-composite listings for occupancy calculation
  const compositeListingIds = listingsWithComposite?.filter(l => l.is_composite).map(l => l.id) || [];
  const nonCompositeListingIds = listingsWithComposite?.filter(l => !l.is_composite).map(l => l.id) || [];

  // Fetch composite children relationships
  const { data: compositeChildren } = useQuery({
    queryKey: ["composite-children", compositeListingIds],
    queryFn: async () => {
      if (compositeListingIds.length === 0) return [];
      const { data, error } = await supabase
        .from("composite_listing_children")
        .select("composite_listing_id, child_listing_id, revenue_share_weight")
        .in("composite_listing_id", compositeListingIds);
      if (error) throw error;
      return data || [];
    },
    enabled: compositeListingIds.length > 0,
  });

  // Get available listings for creating sub-groups (only direct members of this group)
  const { data: availableListings } = useQuery({
    queryKey: ["available-listings", directListingIds],
    queryFn: async () => {
      if (directListingIds.length === 0) return [];

      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .in("id", directListingIds)
        .eq("archived", false)
        .order("nickname");

      if (error) throw error;
      return data;
    },
    enabled: directListingIds.length > 0 && isCreateSubGroupOpen,
  });

  // Get all user's listings that are NOT in this group (for adding properties)
  const { data: session } = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
  });

  const { data: allUserListings } = useQuery({
    queryKey: ["all-user-listings"],
    queryFn: async () => {
      const { data: accounts, error: accountsError } = await supabase
        .from("guesty_accounts")
        .select("id")
        .eq("user_id", session?.user?.id);

      if (accountsError) throw accountsError;

      const accountIds = accounts.map((a) => a.id);

      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .in("guesty_account_id", accountIds)
        .eq("archived", false)
        .order("nickname");

      if (error) throw error;
      return data;
    },
    enabled: !!session && isEditingProperties,
  });

  // Filter out listings that are already in this group
  const unassignedListings = allUserListings?.filter(
    (listing) => !directListingIds.includes(listing.id)
  ) || [];

  const { data: reservations, isLoading: isReservationsLoading } = useQuery({
    queryKey: ["group-reservations", listingIds, effectiveDateRange.from.getFullYear()],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      // Fetch reservations for the full year to show "on the books" revenue
      // in Goals Comparison, including confirmed future bookings through December
      const startDate = new Date(effectiveDateRange.from);
      startDate.setFullYear(startDate.getFullYear() - 1);

      // Set end date to December 31st of the selected year to include future bookings
      const endOfYear = new Date(effectiveDateRange.from);
      endOfYear.setMonth(11, 31); // December 31

      // PostgREST caps responses at 1,000 rows per request. Paginate to fetch all rows.
      const pageSize = 1000;
      let from = 0;
      const results: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("reservations")
          .select("*")
          .in("listing_id", listingIds)
          .gte("check_out", format(startDate, "yyyy-MM-dd"))
          .lte("check_in", format(endOfYear, "yyyy-MM-dd"))
          .in("status", ["confirmed", "checked_in", "checked_out"]) 
          .order("check_in", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return results;
    },
    enabled: listingIds.length > 0,
  });

  // Fetch reservation nights for accurate revenue calculation by date
  const { data: reservationNights } = useQuery({
    queryKey: ["group-reservation-nights", listingIds, effectiveDateRange.from, effectiveDateRange.to],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      // PostgREST caps responses at 1,000 rows per request. Paginate to fetch all rows.
      const pageSize = 1000;
      let from = 0;
      const results: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("reservation_nights")
          .select("listing_id, night_date, revenue_allocation")
          .in("listing_id", listingIds)
          .gte("night_date", format(effectiveDateRange.from, "yyyy-MM-dd"))
          .lte("night_date", format(effectiveDateRange.to, "yyyy-MM-dd"))
          .order("night_date", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return results;
    },
    enabled: listingIds.length > 0,
  });

  // Fetch capacity calendar data for occupancy calculation
  const { data: capacityData } = useQuery({
    queryKey: ["group-capacity", listingIds, effectiveDateRange.from, effectiveDateRange.to],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const pageSize = 1000;
      let from = 0;
      const results: any[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("capacity_calendar")
          .select("listing_id, date, is_available")
          .in("listing_id", listingIds)
          .gte("date", format(effectiveDateRange.from, "yyyy-MM-dd"))
          .lte("date", format(effectiveDateRange.to, "yyyy-MM-dd"))
          .order("date", { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      return results;
    },
    enabled: listingIds.length > 0,
  });

  const { data: goals } = useQuery({
    queryKey: ["group-goals", listingIds, effectiveDateRange.from],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      // Always fetch all months for the selected year
      const year = effectiveDateRange.from.getFullYear();

      const { data, error } = await supabase
        .from("property_goals")
        .select("*")
        .in("listing_id", listingIds)
        .eq("year", year);

      if (error) throw error;
      return data;
    },
    enabled: listingIds.length > 0,
  });

  // Fetch all forecasts for properties in the group
  const { data: forecasts } = useQuery({
    queryKey: ["group-forecasts", listingIds, effectiveDateRange.from],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const year = effectiveDateRange.from.getFullYear();

      const { data, error } = await supabase
        .from("revenue_forecasts")
        .select("*")
        .in("listing_id", listingIds)
        .eq("year", year);

      if (error) throw error;
      return data;
    },
    enabled: listingIds.length > 0,
  });

  // Calculate aggregated metrics
  const totalRevenue = reservationNights?.reduce((sum, n) => sum + (Number(n.revenue_allocation) || 0), 0) || 0;

  // Filter reservations to only those overlapping with the selected date range
  const filteredReservations = reservations?.filter((r) => {
    if (!r.check_in || !r.check_out) return false;
    const checkIn = new Date(r.check_in);
    const checkOut = new Date(r.check_out);
    // Reservation overlaps if: check_in <= dateRange.to AND check_out >= dateRange.from
    return checkIn <= effectiveDateRange.to && checkOut >= effectiveDateRange.from;
  }) || [];

  const totalReservations = filteredReservations.length;
  const totalNights = reservationNights?.length || 0;

  // Calculate overall occupancy (excluding composite listings from denominator)
  const daysInRange = differenceInDays(effectiveDateRange.to, effectiveDateRange.from) + 1;
  
  // Count direct nights for non-composite listings
  const nonCompositeNights = reservationNights?.filter(
    n => nonCompositeListingIds.includes(n.listing_id)
  ).length || 0;
  
  // Count composite booking nights (each composite night = N unit-nights)
  const compositeNights = reservationNights?.filter(
    n => compositeListingIds.includes(n.listing_id)
  ).length || 0;
  const childUnitCount = nonCompositeListingIds.length;
  const attributedNights = compositeNights * childUnitCount;
  
  // Total occupied = direct non-composite + attributed from composites
  const totalOccupiedNights = nonCompositeNights + attributedNights;
  
  // Denominator uses only non-composite listings
  const totalPossibleNights = nonCompositeListingIds.length * daysInRange || listingIds.length * daysInRange;
  const overallOccupancy = totalPossibleNights > 0 
    ? (totalOccupiedNights / totalPossibleNights) * 100 
    : 0;

  // Check if data is incomplete (reservations exist but nights data is missing)
  const hasReservations = totalReservations > 0;
  const hasNights = totalNights > 0;
  const isDataIncomplete = hasReservations && !hasNights;

  const totalProjectionRevenue = goals?.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0) || 0;

  // Calculate aggregated forecast
  const aggregatedForecast = forecasts?.reduce((acc, f) => {
    const totalForecast = (f.total_forecast as any)?.p50 || 0;
    const revenueOnBooks = Number(f.revenue_on_books) || 0;
    return {
      totalProjected: acc.totalProjected + totalForecast,
      totalOnBooks: acc.totalOnBooks + revenueOnBooks,
    };
  }, { totalProjected: 0, totalOnBooks: 0 });

  // Calculate aggregated monthly forecast for TrendChart
  const aggregatedMonthlyForecast = useMemo(() => {
    if (!forecasts || forecasts.length === 0) return null;

    const monthlyData: { [key: string]: { p50: number, onBooks: number } } = {};

    // Initialize all 12 months
    for (let i = 1; i <= 12; i++) {
      const monthKey = `${effectiveDateRange.from.getFullYear()}-${String(i).padStart(2, '0')}`;
      monthlyData[monthKey] = { p50: 0, onBooks: 0 };
    }

    // Aggregate each property's monthly forecast
    forecasts.forEach(forecast => {
      const monthlyForecasts = (forecast.monthly_forecasts as any[]) || [];
      monthlyForecasts.forEach((mf: any) => {
        const month = mf.month;
        if (monthlyData[month]) {
          monthlyData[month].p50 += mf.total_forecast_p50 || 0;
          monthlyData[month].onBooks += mf.revenue_on_books || 0;
        }
      });
    });

    return {
      monthly_forecasts: Object.entries(monthlyData).map(([month, data]) => ({
        month,
        totalForecast: { p50: data.p50 },
        revenue_on_books: data.onBooks,
      })),
    };
  }, [forecasts, effectiveDateRange.from]);

  // Calculate goal probabilities (average across all properties)
  const avgGoalProbabilities = forecasts?.reduce((acc, f: any) => {
    const probs = f.goal_probabilities || { projection: 0 };
    return {
      projection: acc.projection + probs.projection,
      count: acc.count + 1,
    };
  }, { projection: 0, count: 0 });

  const goalProbabilities = avgGoalProbabilities?.count ? {
    projection: avgGoalProbabilities.projection / avgGoalProbabilities.count,
  } : null;

  // Calculate year-over-year revenue data
  const calculateYearOverYearRevenue = () => {
    const currentYear = effectiveDateRange.from.getFullYear();
    const monthlyRevenue: { [key: string]: { current: number; last: number } } = {};

    // Initialize all months
    for (let i = 0; i < 12; i++) {
      const monthKey = `${i}`;
      monthlyRevenue[monthKey] = { current: 0, last: 0 };
    }

    // Calculate revenue per night and allocate to correct month (excluding owner reservations)
    reservations?.filter(r => r.source !== 'owner').forEach((r) => {
      if (!r.check_in || !r.check_out || !r.nights_count || r.nights_count <= 0) return;

      const checkIn = new Date(r.check_in);
      const checkOut = new Date(r.check_out);
      const revenuePerNight = (Number(r.fare_accommodation_adjusted) || 0) / r.nights_count;

      let currentDate = new Date(checkIn);
      while (currentDate < checkOut) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        if (year === currentYear) {
          monthlyRevenue[month].current += revenuePerNight;
        } else if (year === currentYear - 1) {
          monthlyRevenue[month].last += revenuePerNight;
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return Array.from({ length: 12 }, (_, i) => ({
      month: format(new Date(2025, i), "MMM"),
      monthKey: `${currentYear}-${String(i + 1).padStart(2, '0')}`,
      currentYear: Math.round(monthlyRevenue[i].current),
      lastYear: Math.round(monthlyRevenue[i].last),
    }));
  };

  // Calculate year-over-year occupancy data
  const calculateYearOverYearOccupancy = () => {
    const currentYear = effectiveDateRange.from.getFullYear();
    const monthlyOccupancy: { [key: string]: { currentNights: number; lastNights: number; totalDays: number } } = {};

    // Initialize all months
    for (let i = 0; i < 12; i++) {
      const daysInMonth = new Date(currentYear, i + 1, 0).getDate();
      monthlyOccupancy[i] = { currentNights: 0, lastNights: 0, totalDays: daysInMonth };
    }

    // Count nights booked per month (excluding owner reservations)
    reservations?.filter(r => r.source !== 'owner').forEach((r) => {
      if (!r.check_in || !r.check_out) return;

      const checkIn = new Date(r.check_in);
      const checkOut = new Date(r.check_out);

      let currentDate = new Date(checkIn);
      while (currentDate < checkOut) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        if (year === currentYear) {
          monthlyOccupancy[month].currentNights++;
        } else if (year === currentYear - 1) {
          monthlyOccupancy[month].lastNights++;
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    // Calculate occupancy percentage: (nights booked / (days in month × number of properties)) × 100
    const propertyCount = listingIds.length || 1;

    return Array.from({ length: 12 }, (_, i) => {
      const data = monthlyOccupancy[i];
      const totalAvailableNights = data.totalDays * propertyCount;

      return {
        month: format(new Date(2025, i), "MMM"),
        monthKey: `${currentYear}-${String(i + 1).padStart(2, '0')}`,
        currentYear: totalAvailableNights > 0 ? (data.currentNights / totalAvailableNights) * 100 : 0,
        lastYear: totalAvailableNights > 0 ? (data.lastNights / totalAvailableNights) * 100 : 0,
      };
    });
  };

  // Calculate year-over-year RevPAR data
  const calculateYearOverYearRevPAR = () => {
    const currentYear = effectiveDateRange.from.getFullYear();
    const monthlyData: { [key: string]: { currentRevenue: number; lastRevenue: number; totalDays: number } } = {};

    // Initialize all months
    for (let i = 0; i < 12; i++) {
      const daysInMonth = new Date(currentYear, i + 1, 0).getDate();
      monthlyData[i] = { currentRevenue: 0, lastRevenue: 0, totalDays: daysInMonth };
    }

    // Calculate revenue per night and allocate to correct month
    reservations?.forEach((r) => {
      if (!r.check_in || !r.check_out || !r.nights_count || r.nights_count <= 0) return;

      const checkIn = new Date(r.check_in);
      const checkOut = new Date(r.check_out);
      const revenuePerNight = (Number(r.fare_accommodation_adjusted) || 0) / r.nights_count;

      let currentDate = new Date(checkIn);
      while (currentDate < checkOut) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        if (year === currentYear) {
          monthlyData[month].currentRevenue += revenuePerNight;
        } else if (year === currentYear - 1) {
          monthlyData[month].lastRevenue += revenuePerNight;
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    // Calculate RevPAR: Total Revenue / Total Available Nights
    const propertyCount = listingIds.length || 1;

    return Array.from({ length: 12 }, (_, i) => {
      const data = monthlyData[i];
      const totalAvailableNights = data.totalDays * propertyCount;

      return {
        month: format(new Date(2025, i), "MMM"),
        monthKey: `${currentYear}-${String(i + 1).padStart(2, '0')}`,
        currentYear: totalAvailableNights > 0 ? data.currentRevenue / totalAvailableNights : 0,
        lastYear: totalAvailableNights > 0 ? data.lastRevenue / totalAvailableNights : 0,
      };
    });
  };

  const occupancyData = calculateYearOverYearOccupancy();
  const revenueData = calculateYearOverYearRevenue();
  const revparData = calculateYearOverYearRevPAR();

  const handleAddProperties = async () => {
    if (selectedNewListings.length === 0) {
      toast({
        title: "Select properties",
        description: "Please select at least one property to add",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const members = selectedNewListings.map((listingId) => ({
        group_id: id,
        listing_id: listingId,
      }));

      const { error } = await supabase
        .from("property_group_members")
        .insert(members);

      if (error) throw error;

      toast({
        title: "Properties added",
        description: `${selectedNewListings.length} properties added to the group`,
      });

      setSelectedNewListings([]);
      setIsEditingProperties(false);
      refetchGroup();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveProperty = async (listingId: string) => {
    try {
      const { error } = await supabase
        .from("property_group_members")
        .delete()
        .eq("group_id", id)
        .eq("listing_id", listingId);

      if (error) throw error;

      toast({
        title: "Property removed",
        description: "Property has been removed from the group",
      });

      setRemoveListingId(null);
      refetchGroup();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCreateSubGroup = async () => {
    if (!subGroupName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a sub-group name",
        variant: "destructive",
      });
      return;
    }

    if (selectedListings.length === 0) {
      toast({
        title: "Select properties",
        description: "Please select at least one property",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Get user's organization
      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", session?.user?.id)
        .single();

      if (!membership) {
        throw new Error("No organization found");
      }
      
      // Create sub-group
      const { data: subGroup, error: subGroupError } = await supabase
        .from("property_groups")
        .insert({
          organization_id: membership.organization_id,
          name: subGroupName,
          description: subGroupDescription,
          parent_group_id: id,
        } as any)
        .select()
        .single();

      if (subGroupError) throw subGroupError;

      // Add members
      const members = selectedListings.map((listingId) => ({
        group_id: subGroup.id,
        listing_id: listingId,
      }));

      const { error: membersError } = await supabase
        .from("property_group_members")
        .insert(members);

      if (membersError) throw membersError;

      toast({
        title: "Sub-group created",
        description: `${subGroupName} has been created with ${selectedListings.length} properties`,
      });

      setIsCreateSubGroupOpen(false);
      setSubGroupName("");
      setSubGroupDescription("");
      setSelectedListings([]);
      refetchSubGroups();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSort = (field: "name" | "actual" | "forecast" | "goalProgress" | "status") => {
    if (sortBy === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDirection("desc");
    }
  };

  // Helper function to calculate distributed revenue for a listing
  const getDistributedRevenue = (listingId: string) => {
    // Direct revenue from this listing
    const directRevenue = reservationNights
      ?.filter(n => n.listing_id === listingId)
      .reduce((sum, n) => sum + (Number(n.revenue_allocation) || 0), 0) || 0;

    if (!showDistributedRevenue) {
      return { total: directRevenue, direct: directRevenue, attributed: 0 };
    }

    // Find which composites this listing is a child of
    const parentComposites = compositeChildren?.filter(
      cc => cc.child_listing_id === listingId
    ) || [];

    // Calculate share of each parent composite's revenue
    let attributedRevenue = 0;
    parentComposites.forEach(pc => {
      // Count total children for this composite
      const childCount = compositeChildren?.filter(
        cc => cc.composite_listing_id === pc.composite_listing_id
      ).length || 1;
      
      // Get composite's revenue
      const compositeRevenue = reservationNights
        ?.filter(n => n.listing_id === pc.composite_listing_id)
        .reduce((sum, n) => sum + (Number(n.revenue_allocation) || 0), 0) || 0;
      
      // Add proportional share
      attributedRevenue += compositeRevenue / childCount;
    });

    return { 
      total: directRevenue + attributedRevenue, 
      direct: directRevenue, 
      attributed: attributedRevenue 
    };
  };

  // Fetch all listings data for the properties table
  const { data: allListings } = useQuery({
    queryKey: ["group-all-listings", listingIds],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .in("id", listingIds);

      if (error) throw error;
      return data;
    },
    enabled: listingIds.length > 0,
  });

  const isLoading = isGroupLoading || isReservationsLoading;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!group) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold">Group not found</h2>
          <Button onClick={() => navigate("/groups")} className="mt-4">
            Back to Groups
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/groups")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Building2 className="h-8 w-8 text-primary" />
                {group.name}
              </h1>
              {group.description && (
                <p className="text-muted-foreground mt-1">{group.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {compositeListingIds.length > 0 && (
              <TooltipProvider>
                <div className="flex items-center gap-2">
                  <Switch 
                    id="distribute-revenue"
                    checked={showDistributedRevenue} 
                    onCheckedChange={setShowDistributedRevenue}
                  />
                  <Label htmlFor="distribute-revenue" className="text-sm cursor-pointer">
                    Distribute Full Revenue
                  </Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <InfoIcon className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>When enabled, Full property revenue is distributed equally to individual units for comparison purposes.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            )}
            <StripeDateRangePicker value={dateRange} onChange={setDateRange} />
            {directListingIds.length > 0 && (
              <Dialog open={isCreateSubGroupOpen} onOpenChange={setIsCreateSubGroupOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Sub-Group
                  </Button>
                </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Sub-Group</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 mt-4">
                  <div>
                    <Label htmlFor="sub-name">Sub-Group Name</Label>
                    <Input
                      id="sub-name"
                      placeholder="e.g., 3 Bedroom Units, 2 Bedroom Units"
                      value={subGroupName}
                      onChange={(e) => setSubGroupName(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="sub-description">Description (optional)</Label>
                    <Textarea
                      id="sub-description"
                      placeholder="Add notes about this sub-group"
                      value={subGroupDescription}
                      onChange={(e) => setSubGroupDescription(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div>
                    <Label>Select Properties</Label>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search properties..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <div className="border rounded-lg p-4 max-h-60 overflow-y-auto space-y-2">
                      {availableListings
                        ?.filter((listing) => {
                          const query = searchQuery.toLowerCase();
                          const nickname = (listing.nickname || "").toLowerCase();
                          return nickname.includes(query);
                        })
                        .map((listing) => (
                        <div key={listing.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`sub-${listing.id}`}
                            checked={selectedListings.includes(listing.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedListings([...selectedListings, listing.id]);
                              } else {
                                setSelectedListings(selectedListings.filter((id) => id !== listing.id));
                              }
                            }}
                          />
                          <label
                            htmlFor={`sub-${listing.id}`}
                            className="flex items-center gap-2 cursor-pointer flex-1"
                          >
                            {listing.thumbnail && (
                              <img
                                src={listing.thumbnail}
                                alt={listing.nickname || "Property"}
                                className="w-10 h-10 rounded object-cover"
                              />
                            )}
                            <span className="text-sm">{listing.nickname || "Unnamed Property"}</span>
                          </label>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      {selectedListings.length} properties selected
                    </p>
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => setIsCreateSubGroupOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateSubGroup} disabled={isSubmitting}>
                      {isSubmitting ? "Creating..." : "Create Sub-Group"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </div>

        {isDataIncomplete && (
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
            <InfoIcon className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-900 dark:text-amber-100">
              Nightly Revenue Data Being Prepared
            </AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              Reservations have been synced for this period, but detailed nightly allocations 
              are still being generated. Revenue and nights totals may be incomplete. 
              This typically completes within a few minutes after a sync.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-5">
          <MetricCard
            title="Total Revenue"
            value={`$${Math.round(totalRevenue).toLocaleString()}`}
            icon={DollarSign}
          />
          <MetricCard
            title="Reservations"
            value={totalReservations.toString()}
            icon={Calendar}
          />
          <MetricCard
            title="Total Nights"
            value={totalNights.toString()}
            icon={TrendingUp}
          />
          <MetricCard
            title="Overall Occupancy"
            value={`${overallOccupancy.toFixed(1)}%`}
            icon={TrendingUp}
            description={`${totalNights.toLocaleString()} / ${totalPossibleNights.toLocaleString()} nights`}
          />
          <MetricCard
            title="Properties"
            value={group.property_group_members.length.toString()}
            icon={Building2}
          />
        </div>


        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
            <TabsTrigger value="pacing">Pacing</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <GoalsComparison 
              listingId={null}
              reservations={reservations || []}
              goals={goals || []}
              forecasts={forecasts || []}
              propertyCount={listingIds.length}
            />
          </TabsContent>

          <TabsContent value="forecast" className="space-y-6">
            {aggregatedForecast && goalProbabilities ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Aggregated Revenue Forecast</CardTitle>
                    <CardDescription>
                      Combined forecast from all {listingIds.length} properties in this group
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-6 text-center">
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        Projected End-of-Year Revenue
                      </p>
                      <p className="text-4xl font-bold mb-2">
                        ${aggregatedForecast.totalProjected.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                      <div className="mt-4 pt-4 border-t">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="text-center">
                            <p className="text-muted-foreground">Revenue On Books</p>
                            <p className="font-semibold">
                              ${aggregatedForecast.totalOnBooks.toLocaleString()}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">Additional Forecasted</p>
                            <p className="font-semibold">
                              ${(aggregatedForecast.totalProjected - aggregatedForecast.totalOnBooks).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium mb-4">Probability of Hitting Goal</h4>
                      <div className="flex justify-center">
                        {(() => {
                          const probability = goalProbabilities.projection;
                          const target = totalProjectionRevenue;
                          const getColor = (prob: number) => {
                            if (prob >= 70) return "text-green-600";
                            if (prob >= 40) return "text-yellow-600";
                            return "text-red-600";
                          };

                          return (
                            <div className="flex flex-col items-center space-y-2">
                              <div className="relative w-24 h-24">
                                <svg className="transform -rotate-90 w-24 h-24">
                                  <circle
                                    cx="48"
                                    cy="48"
                                    r="40"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="transparent"
                                    className="text-muted"
                                  />
                                  <circle
                                    cx="48"
                                    cy="48"
                                    r="40"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="transparent"
                                    strokeDasharray={`${2 * Math.PI * 40}`}
                                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - probability / 100)}`}
                                    className={getColor(probability)}
                                    strokeLinecap="round"
                                  />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className={`text-2xl font-bold ${getColor(probability)}`}>
                                    {probability.toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                              <div className="text-center">
                                <p className="text-sm font-medium">Goal</p>
                                <p className="text-xs text-muted-foreground">
                                  ${target.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="text-center text-sm text-muted-foreground pt-4 border-t">
                      <p>Forecasts are aggregated from {forecasts?.length || 0} of {listingIds.length} properties</p>
                      <p className="mt-1">Individual property forecasts can be viewed on their detail pages</p>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="text-center py-12">
                  <p className="text-muted-foreground mb-4">
                    No forecasts available yet for properties in this group
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Visit individual property pages to generate forecasts
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="pacing">
            {reservations && reservations.length > 0 ? (
              <PacingReport reservations={reservations} listingIds={listingIds} />
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

        {subGroups && subGroups.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Sub-Groups</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {subGroups.map((subGroup: any) => (
                  <Card
                    key={subGroup.id}
                    className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => navigate(`/groups/${subGroup.id}`)}
                  >
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">{subGroup.name}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {subGroup.property_group_members.slice(0, 3).map((member: any) => (
                            <div
                              key={member.listing_id}
                              className="w-8 h-8 rounded-full border-2 border-background overflow-hidden bg-muted"
                            >
                              {member.listings?.thumbnail && (
                                <img
                                  src={member.listings.thumbnail}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {subGroup.property_group_members.length} properties
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Properties in Group ({group.property_group_members.length})</CardTitle>
            <Button
              variant={isEditingProperties ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setIsEditingProperties(!isEditingProperties);
                if (!isEditingProperties) {
                  setSelectedNewListings([]);
                }
              }}
            >
              {isEditingProperties ? "Done Editing" : "Edit"}
            </Button>
          </CardHeader>
          <CardContent>
            {isEditingProperties && (
              <div className="mb-6 p-4 border rounded-lg bg-muted/50">
                <Label className="text-sm font-medium mb-2 block">Add Properties to Group</Label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search properties..."
                    value={addSearchQuery}
                    onChange={(e) => setAddSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="border rounded-lg p-4 max-h-60 overflow-y-auto space-y-2 bg-background">
                  {unassignedListings.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      All your properties are already in this group
                    </p>
                  ) : (
                    unassignedListings
                      .filter((listing) => {
                        const query = addSearchQuery.toLowerCase();
                        const nickname = (listing.nickname || "").toLowerCase();
                        return nickname.includes(query);
                      })
                      .map((listing) => (
                        <div key={listing.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`add-${listing.id}`}
                            checked={selectedNewListings.includes(listing.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedNewListings([...selectedNewListings, listing.id]);
                              } else {
                                setSelectedNewListings(selectedNewListings.filter((id) => id !== listing.id));
                              }
                            }}
                          />
                          <label
                            htmlFor={`add-${listing.id}`}
                            className="flex items-center gap-2 cursor-pointer flex-1"
                          >
                            {listing.thumbnail && (
                              <img
                                src={listing.thumbnail}
                                alt={listing.nickname || "Property"}
                                className="w-10 h-10 rounded object-cover"
                              />
                            )}
                            <span className="text-sm">{listing.nickname || "Unnamed Property"}</span>
                          </label>
                        </div>
                      ))
                  )}
                </div>
                {selectedNewListings.length > 0 && (
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-sm text-muted-foreground">
                      {selectedNewListings.length} properties selected
                    </p>
                    <Button onClick={handleAddProperties} disabled={isSubmitting} size="sm">
                      {isSubmitting ? "Adding..." : "Add Selected"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {group.property_group_members.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No properties in this group yet</p>
              </div>
            ) : (
              <PropertiesTable
                properties={(allListings || [])
                  // When distributed view is on, hide composite listings
                  .filter(listing => !showDistributedRevenue || !listing.is_composite)
                  .map(listing => {
                  const currentYear = effectiveDateRange.from.getFullYear();
                  const currentDate = new Date();
                  
                  const listingGoals = goals?.filter(g => g.listing_id === listing.id && g.year === currentYear) || [];
                  const listingForecast = forecasts?.find(f => f.listing_id === listing.id && f.year === currentYear);
                  
                  // Use distributed revenue when toggle is on
                  const revenueData = getDistributedRevenue(listing.id);
                  const ytdRevenue = revenueData.total;

                  const budget = listingGoals.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0);
                  const projection = listingGoals.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0);
                  const goal = listingGoals.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0);
                  const forecast = listingForecast ? (Number((listingForecast.total_forecast as any)?.p50) || 0) : 0;
                  
                  let status: 'on-track' | 'at-risk' | 'behind' = 'behind';
                  if (projection > 0) {
                    const pacing = (forecast / projection) * 100;
                    if (pacing >= 95) status = 'on-track';
                    else if (pacing >= 85) status = 'at-risk';
                  }

                  const lockedGoals = listingGoals.filter(g => g.locked === true);
                  const budgetAchievement = budget > 0 ? (ytdRevenue / budget) * 100 : 0;
                  const projectionAchievement = projection > 0 ? (ytdRevenue / projection) * 100 : 0;
                  const goalAchievement = goal > 0 ? (ytdRevenue / goal) * 100 : 0;
                  const forecastBudgetAchievement = budget > 0 ? (forecast / budget) * 100 : 0;
                  const forecastProjectionAchievement = projection > 0 ? (forecast / projection) * 100 : 0;
                  const forecastGoalAchievement = goal > 0 ? (forecast / goal) * 100 : 0;

                  // Calculate occupancy, ADR, RevPAR using existing reservationNights data
                  const listingNightsCount = reservationNights?.filter(
                    n => n.listing_id === listing.id
                  ).length || 0;
                  const occupancy = daysInRange > 0 ? (listingNightsCount / daysInRange) * 100 : 0;
                  const adr = listingNightsCount > 0 ? ytdRevenue / listingNightsCount : 0;
                  const revpar = daysInRange > 0 ? ytdRevenue / daysInRange : 0;

                  return {
                    id: listing.id,
                    nickname: listing.nickname,
                    address: listing.address,
                    thumbnail: listing.thumbnail,
                    propertyType: listing.property_type,
                    actualRevenue: ytdRevenue,
                    directRevenue: revenueData.direct,
                    attributedRevenue: revenueData.attributed,
                    budgetTotal: budget,
                    projectionTotal: projection,
                    goalTotal: goal,
                    forecastedRevenue: forecast,
                    forecastUpdatedAt: listingForecast?.updated_at || null,
                    budgetAchievement,
                    projectionAchievement,
                    goalAchievement,
                    forecastBudgetAchievement,
                    forecastProjectionAchievement,
                    forecastGoalAchievement,
                    status,
                    hasGoals: listingGoals.length > 0,
                    hasLockedGoals: lockedGoals.length > 0,
                    goalsLockedCount: lockedGoals.length,
                    isComposite: listing.is_composite,
                    occupancy,
                    adr,
                    revpar,
                  };
                }).sort((a, b) => {
                  let comparison = 0;
                  
                  switch (sortBy) {
                    case "name":
                      comparison = a.nickname.localeCompare(b.nickname);
                      break;
                    case "actual":
                      comparison = a.actualRevenue - b.actualRevenue;
                      break;
                    case "forecast":
                      comparison = a.forecastedRevenue - b.forecastedRevenue;
                      break;
                    case "goalProgress":
                      comparison = a.forecastProjectionAchievement - b.forecastProjectionAchievement;
                      break;
                    case "status":
                      const statusOrder = { "on-track": 3, "at-risk": 2, "behind": 1 };
                      comparison = statusOrder[a.status] - statusOrder[b.status];
                      break;
                  }
                  
                  return sortDirection === "asc" ? comparison : -comparison;
                })}
                 isLoading={false}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={handleSort}
                referrer={{
                  path: `/groups/${id}`,
                  label: group?.name || 'Group',
                  state: { dateRange, searchQuery, sortBy, sortDirection, scrollPosition: window.scrollY }
                }}
              />
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!removeListingId} onOpenChange={() => setRemoveListingId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Property</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove this property from the group? This will not delete the property itself.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => removeListingId && handleRemoveProperty(removeListingId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}

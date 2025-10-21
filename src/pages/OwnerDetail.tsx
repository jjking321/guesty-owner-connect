import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PropertyMetricsSummary } from "@/components/PropertyMetricsSummary";
import { PropertiesTable } from "@/components/PropertiesTable";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Mail, Phone, Building2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface Owner {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  imported_at: string;
}

export default function OwnerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [forecasts, setForecasts] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"name" | "actual" | "forecast" | "goalProgress" | "status">("actual");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (id) {
      loadOwnerData();
    }
  }, [id]);

  const loadOwnerData = async () => {
    try {
      setLoading(true);

      // Load owner
      const { data: ownerData, error: ownerError } = await supabase
        .from('owners')
        .select('*')
        .eq('id', id)
        .single();

      if (ownerError) throw ownerError;
      setOwner(ownerData);

      // Load listings for this owner
      const { data: listingsData, error: listingsError } = await supabase
        .from('listings')
        .select('*')
        .eq('owner_id', id);

      if (listingsError) throw listingsError;
      setListings(listingsData || []);

      const listingIds = (listingsData || []).map(l => l.id);

      if (listingIds.length > 0) {
        // Load goals
        const { data: goalsData } = await supabase
          .from('property_goals')
          .select('*')
          .in('listing_id', listingIds);
        setGoals(goalsData || []);

        // Load forecasts
        const { data: forecastsData } = await supabase
          .from('revenue_forecasts')
          .select('*')
          .in('listing_id', listingIds);
        setForecasts(forecastsData || []);

        // Load reservations
        const { data: reservationsData } = await supabase
          .from('reservations')
          .select('*')
          .in('listing_id', listingIds);
        setReservations(reservationsData || []);
      }
    } catch (error: any) {
      toast({
        title: "Error loading owner data",
        description: error.message,
        variant: "destructive",
      });
      navigate('/owners');
    } finally {
      setLoading(false);
    }
  };

  const getOwnerName = (owner: Owner) => {
    if (owner.full_name) return owner.full_name;
    if (owner.first_name && owner.last_name) return `${owner.first_name} ${owner.last_name}`;
    if (owner.first_name) return owner.first_name;
    if (owner.last_name) return owner.last_name;
    return 'Unknown Owner';
  };

  // Calculate metrics for PropertyMetricsSummary
  const currentYear = new Date().getFullYear();
  const currentDate = new Date();

  const calculateMetrics = () => {
    let totalActualRevenue = 0;
    let totalBudget = 0;
    let totalProjection = 0;
    let totalGoal = 0;
    let totalForecast = 0;
    let onTrackCount = 0;
    let atRiskCount = 0;
    let behindCount = 0;

    listings.forEach(listing => {
      // Calculate YTD revenue (check_out <= today)
      const listingReservations = reservations.filter(
        r => r.listing_id === listing.id && 
        r.status === 'confirmed' &&
        new Date(r.check_out) <= currentDate &&
        new Date(r.check_out).getFullYear() === currentYear
      );
      const ytdRevenue = listingReservations.reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0);
      totalActualRevenue += ytdRevenue;

      // Get goals for this listing
      const listingGoals = goals.filter(g => g.listing_id === listing.id && g.year === currentYear);
      const budget = listingGoals.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0);
      const projection = listingGoals.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0);
      const goal = listingGoals.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0);
      
      totalBudget += budget;
      totalProjection += projection;
      totalGoal += goal;

      // Get forecast
      const listingForecast = forecasts.find(f => f.listing_id === listing.id && f.year === currentYear);
      const forecastAmount = listingForecast ? (Number(listingForecast.total_forecast?.p50) || 0) : 0;
      totalForecast += forecastAmount;

      // Determine status
      if (projection > 0) {
        const pacing = (forecastAmount / projection) * 100;
        if (pacing >= 95) onTrackCount++;
        else if (pacing >= 85) atRiskCount++;
        else behindCount++;
      }
    });

    return {
      totalActualRevenue,
      totalBudget,
      totalProjection,
      totalGoal,
      totalForecast,
      propertiesCount: listings.length,
      onTrackCount,
      atRiskCount,
      behindCount,
    };
  };

  const metrics = calculateMetrics();

  const handleSort = (field: "name" | "actual" | "forecast" | "goalProgress" | "status") => {
    if (sortBy === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDirection("desc");
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!owner) {
    return (
      <DashboardLayout>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Owner not found</p>
            <Button onClick={() => navigate('/owners')} className="mt-4">
              Back to Owners
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/owners">Owners</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{getOwnerName(owner)}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Back Button */}
        <Button variant="outline" onClick={() => navigate('/owners')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Owners
        </Button>

        {/* Owner Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{getOwnerName(owner)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {owner.email && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                    <Mail className="h-3 w-3" />
                    Email
                  </p>
                  <p className="font-medium">{owner.email}</p>
                </div>
              )}
              {owner.phone && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                    <Phone className="h-3 w-3" />
                    Phone
                  </p>
                  <p className="font-medium">{owner.phone}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                  <Building2 className="h-3 w-3" />
                  Properties
                </p>
                <p className="font-medium">{listings.length}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Last Synced</p>
                <p className="font-medium text-sm">
                  {new Date(owner.imported_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metrics Summary */}
        <PropertyMetricsSummary {...metrics} />

        {/* Properties Table */}
        <Card>
          <CardHeader>
            <CardTitle>Properties</CardTitle>
          </CardHeader>
          <CardContent>
            {listings.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No properties found for this owner
              </p>
            ) : (
              <PropertiesTable
                properties={listings.map(listing => {
                  const listingGoals = goals.filter(g => g.listing_id === listing.id && g.year === currentYear);
                  const listingForecast = forecasts.find(f => f.listing_id === listing.id && f.year === currentYear);
                  
                  const ytdRevenue = reservations
                    .filter(r => 
                      r.listing_id === listing.id && 
                      r.status === 'confirmed' &&
                      new Date(r.check_out) <= currentDate &&
                      new Date(r.check_out).getFullYear() === currentYear
                    )
                    .reduce((sum, r) => sum + (Number(r.fare_accommodation_adjusted) || 0), 0);

                  const budget = listingGoals.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0);
                  const projection = listingGoals.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0);
                  const goal = listingGoals.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0);
                  const forecast = listingForecast ? (Number(listingForecast.total_forecast?.p50) || 0) : 0;
                  
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

                  return {
                    id: listing.id,
                    nickname: listing.nickname,
                    address: listing.address,
                    thumbnail: listing.thumbnail,
                    propertyType: listing.property_type,
                    actualRevenue: ytdRevenue,
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
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
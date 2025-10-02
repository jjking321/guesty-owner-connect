import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, DollarSign, Calendar, TrendingUp, Building2 } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { TrendChart } from "@/components/TrendChart";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfYear, endOfYear } from "date-fns";

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: group, isLoading: isGroupLoading } = useQuery({
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

  const listingIds = group?.property_group_members.map((m: any) => m.listing_id) || [];

  const { data: reservations, isLoading: isReservationsLoading } = useQuery({
    queryKey: ["group-reservations", listingIds],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const currentYear = new Date().getFullYear();
      const yearStart = format(startOfYear(new Date(currentYear, 0)), "yyyy-MM-dd");
      const yearEnd = format(endOfYear(new Date(currentYear, 0)), "yyyy-MM-dd");

      const { data, error } = await supabase
        .from("reservations")
        .select("*")
        .in("listing_id", listingIds)
        .gte("check_in", yearStart)
        .lte("check_in", yearEnd)
        .in("status", ["confirmed", "checked_in", "checked_out"]);

      if (error) throw error;
      return data;
    },
    enabled: listingIds.length > 0,
  });

  const { data: goals } = useQuery({
    queryKey: ["group-goals", listingIds],
    queryFn: async () => {
      if (listingIds.length === 0) return [];

      const currentYear = new Date().getFullYear();

      const { data, error } = await supabase
        .from("property_goals")
        .select("*")
        .in("listing_id", listingIds)
        .eq("year", currentYear);

      if (error) throw error;
      return data;
    },
    enabled: listingIds.length > 0,
  });

  // Calculate aggregated metrics
  const totalRevenue = reservations?.reduce((sum, r) => sum + (Number(r.owner_revenue) || 0), 0) || 0;
  const totalReservations = reservations?.length || 0;
  const totalNights = reservations?.reduce((sum, r) => sum + (r.nights_count || 0), 0) || 0;

  const totalGoalRevenue = goals?.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0) || 0;
  const totalBudgetRevenue = goals?.reduce((sum, g) => sum + (Number(g.budget_revenue) || 0), 0) || 0;
  const totalProjectionRevenue = goals?.reduce((sum, g) => sum + (Number(g.projection_revenue) || 0), 0) || 0;

  // Prepare chart data
  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const monthReservations = reservations?.filter((r) => {
      const checkIn = new Date(r.check_in || "");
      return checkIn.getMonth() === i;
    }) || [];

    const revenue = monthReservations.reduce((sum, r) => sum + (Number(r.owner_revenue) || 0), 0);
    const monthGoals = goals?.filter((g) => g.month === i + 1) || [];
    const goal = monthGoals.reduce((sum, g) => sum + (Number(g.goal_revenue) || 0), 0);

    return {
      month: format(new Date(2025, i), "MMM"),
      revenue,
      goal,
    };
  });

  // Prepare chart data for TrendChart component
  const occupancyData = monthlyData.map((d) => ({
    month: d.month,
    monthKey: d.month,
    currentYear: 0, // Would need reservation data to calculate
    lastYear: 0,
  }));

  const revenueData = monthlyData.map((d) => ({
    month: d.month,
    monthKey: d.month,
    currentYear: d.revenue,
    lastYear: 0, // Would need last year data
  }));

  const revparData = monthlyData.map((d) => ({
    month: d.month,
    monthKey: d.month,
    currentYear: 0,
    lastYear: 0,
  }));

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

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard
            title="Total Revenue"
            value={`$${totalRevenue.toLocaleString()}`}
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
            title="Properties"
            value={group.property_group_members.length.toString()}
            icon={Building2}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Goal Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalGoalRevenue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {totalGoalRevenue > 0
                  ? `${((totalRevenue / totalGoalRevenue) * 100).toFixed(1)}% of goal`
                  : "No goal set"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Budget Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalBudgetRevenue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {totalBudgetRevenue > 0
                  ? `${((totalRevenue / totalBudgetRevenue) * 100).toFixed(1)}% of budget`
                  : "No budget set"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Projection Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalProjectionRevenue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Target projection</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Revenue vs Goals</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              occupancyData={occupancyData}
              revenueData={revenueData}
              revparData={revparData}
              goalsData={goals || []}
              reservations={reservations || []}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Properties in Group</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {group.property_group_members.map((member: any) => (
                <Card
                  key={member.listing_id}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => navigate(`/listings/${member.listing_id}`)}
                >
                  {member.listings?.thumbnail && (
                    <div className="aspect-video overflow-hidden rounded-t-lg">
                      <img
                        src={member.listings.thumbnail}
                        alt={member.listings.nickname || "Property"}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <CardContent className="pt-4">
                    <h3 className="font-semibold">
                      {member.listings?.nickname || "Unnamed Property"}
                    </h3>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

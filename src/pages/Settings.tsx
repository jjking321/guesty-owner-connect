import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Loader2, Home, Calendar, Users, Star, CalendarDays, Clock, Zap, AlertTriangle, TrendingUp, RefreshCw, BarChart3 } from "lucide-react";
import { AirbnbIcon } from "@/components/icons/AirbnbIcon";
import { GuestyIcon } from "@/components/icons/GuestyIcon";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { SyncProgressCard } from "@/components/SyncProgressCard";
import { TeamManagement } from "@/components/TeamManagement";
import { AIPromptsSettings } from "@/components/AIPromptsSettings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Settings() {
  const { toast } = useToast();
  const [guestyAccounts, setGuestyAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingListings, setSyncingListings] = useState<string | null>(null);
  const [syncingReservations, setSyncingReservations] = useState<string | null>(null);
  const [syncingOwners, setSyncingOwners] = useState<string | null>(null);
  const [syncingReviews, setSyncingReviews] = useState<string | null>(null);
  const [syncingCalendar, setSyncingCalendar] = useState<string | null>(null);
  const [scrapingAirbnbRatings, setScrapingAirbnbRatings] = useState(false);
  const [lastAirbnbScrape, setLastAirbnbScrape] = useState<{ date: string; count: number } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [incompleteSyncJobs, setIncompleteSyncJobs] = useState<Record<string, any>>({});
  const [autoSyncFailures, setAutoSyncFailures] = useState<Record<string, string[]>>({});
  const [lastSyncCounts, setLastSyncCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    loadAccounts();
    loadLastAirbnbScrape();
  }, []);

  const loadLastAirbnbScrape = async () => {
    try {
      // Get the most recent completed airbnb_ratings sync job
      const { data: job } = await supabase
        .from("sync_jobs")
        .select("completed_at, items_synced")
        .eq("sync_type", "airbnb_ratings")
        .in("status", ["completed", "completed_with_errors"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (job?.completed_at) {
        setLastAirbnbScrape({
          date: job.completed_at,
          count: job.items_synced || 0
        });
      } else {
        // Fallback to listing data if no sync job found
        const { data: listing, count } = await supabase
          .from("listings")
          .select("live_rating_scraped_at", { count: 'exact' })
          .not("live_rating_scraped_at", "is", null)
          .order("live_rating_scraped_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (listing?.live_rating_scraped_at) {
          setLastAirbnbScrape({
            date: listing.live_rating_scraped_at,
            count: count || 0
          });
        }
      }
    } catch (error) {
      console.error("Error loading last Airbnb scrape:", error);
    }
  };

  const loadAccounts = async () => {
    try {
      setLoading(true);
      // Only select safe fields - exclude client_id and client_secret for security
      const { data, error } = await supabase
        .from("guesty_accounts")
        .select("id, account_name, organization_id, created_at, updated_at, last_listings_sync, last_reservations_sync, last_owners_sync, last_reviews_sync, last_calendar_sync, last_automated_sync, automated_sync_enabled, airbnb_scrape_enabled, forecast_generation_enabled, probability_calculation_enabled")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGuestyAccounts(data || []);
      
      // Check for incomplete sync jobs and auto sync failures
      if (data && data.length > 0) {
        const accountIds = data.map(acc => acc.id);
        const { data: jobs } = await supabase
          .from('sync_jobs')
          .select('*')
          .in('guesty_account_id', accountIds)
          .eq('status', 'running')
          .order('started_at', { ascending: false });
        
        if (jobs) {
          const jobsMap: Record<string, any> = {};
          jobs.forEach(job => {
            const key = `${job.guesty_account_id}-${job.sync_type}`;
            if (!jobsMap[key]) {
              jobsMap[key] = job;
            }
          });
          setIncompleteSyncJobs(jobsMap);
        }

        // Check for failures in last automated sync for each account
        const failuresMap: Record<string, string[]> = {};
        for (const account of data) {
          if (account.last_automated_sync) {
            const syncTime = new Date(account.last_automated_sync);
            const windowStart = new Date(syncTime.getTime() - 60 * 60 * 1000); // 1 hour before
            const windowEnd = new Date(syncTime.getTime() + 60 * 1000); // 1 minute after
            
            const { data: failedJobs } = await supabase
              .from('sync_jobs')
              .select('sync_type')
              .eq('guesty_account_id', account.id)
              .eq('status', 'failed')
              .gte('started_at', windowStart.toISOString())
              .lte('started_at', windowEnd.toISOString());
            
            if (failedJobs && failedJobs.length > 0) {
              failuresMap[account.id] = failedJobs.map(j => j.sync_type);
            }
          }
        }
        setAutoSyncFailures(failuresMap);

        // Load last sync counts for each account and sync type
        const countsMap: Record<string, number> = {};
        for (const account of data) {
          const syncTypes = ['listings', 'reservations', 'reviews', 'capacity_calendar', 'new_reservations'];
          for (const syncType of syncTypes) {
            const { data: lastJob } = await supabase
              .from('sync_jobs')
              .select('items_synced')
              .eq('guesty_account_id', account.id)
              .eq('sync_type', syncType)
              .in('status', ['completed', 'completed_with_errors'])
              .order('completed_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (lastJob?.items_synced) {
              countsMap[`${account.id}-${syncType}`] = lastJob.items_synced;
            }
          }
        }
        setLastSyncCounts(countsMap);
      }
    } catch (error: any) {
      toast({
        title: "Error loading accounts",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const accountName = formData.get("account_name") as string;
    const clientId = formData.get("client_id") as string;
    const clientSecret = formData.get("client_secret") as string;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get user's organization
      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      if (!membership) {
        throw new Error("No organization found. Please contact support.");
      }

      const { error } = await supabase.from("guesty_accounts").insert({
        user_id: user.id,
        organization_id: membership.organization_id,
        account_name: accountName,
        client_id: clientId,
        client_secret: clientSecret,
      } as any);

      if (error) throw error;

      toast({
        title: "Account added",
        description: "Your Guesty account has been connected successfully.",
      });

      setShowAddForm(false);
      loadAccounts();
      (e.target as HTMLFormElement).reset();
    } catch (error: any) {
      toast({
        title: "Error adding account",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      const { error } = await supabase
        .from("guesty_accounts")
        .delete()
        .eq("id", accountId);

      if (error) throw error;

      toast({
        title: "Account deleted",
        description: "Guesty account and all associated data have been removed.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Error deleting account",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleSyncListings = async (accountId: string) => {
    setSyncingListings(accountId);
    try {
      const { data, error } = await supabase.functions.invoke("sync-guesty-data", {
        body: { accountId, syncType: 'listings' },
      });

      if (error) throw error;

      toast({
        title: "Listings sync started",
        description: "Watch the progress below in real-time.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingListings(null);
    }
  };

  const handleSyncReservations = async (accountId: string) => {
    setSyncingReservations(accountId);
    try {
      const incompleteKey = `${accountId}-reservations`;
      const incompleteJob = incompleteSyncJobs[incompleteKey];
      
      const { data, error } = await supabase.functions.invoke("sync-guesty-data", {
        body: { accountId, syncType: 'reservations' },
      });

      if (error) throw error;

      toast({
        title: incompleteJob ? "Resuming reservations sync" : "Reservations sync started",
        description: incompleteJob 
          ? `Continuing from ${incompleteJob.items_synced || 0} reservations. Watch progress below.`
          : "Watch the progress below in real-time.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingReservations(null);
    }
  };

  const handleSyncOwners = async (accountId: string) => {
    setSyncingOwners(accountId);
    try {
      const { data, error } = await supabase.functions.invoke("sync-owners", {
        body: { accountId },
      });

      if (error) throw error;

      toast({
        title: "Owners synced successfully",
        description: `${data.ownersCount} owners synced, ${data.listingsUpdated} listings updated`,
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Failed to sync owners",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingOwners(null);
    }
  };

  const handleSyncReviews = async (accountId: string) => {
    setSyncingReviews(accountId);
    try {
      const incompleteKey = `${accountId}-reviews`;
      const incompleteJob = incompleteSyncJobs[incompleteKey];
      
      const { data, error } = await supabase.functions.invoke("sync-reviews", {
        body: { guestyAccountId: accountId, daysSince: 730 },
      });

      if (error) throw error;

      toast({
        title: incompleteJob ? "Resuming reviews sync" : "Reviews sync started",
        description: incompleteJob 
          ? `Continuing from ${incompleteJob.items_synced || 0} reviews. Watch progress below.`
          : "Watch the progress below in real-time.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingReviews(null);
    }
  };

  const handleSyncCalendar = async (accountId: string) => {
    setSyncingCalendar(accountId);
    try {
      const incompleteKey = `${accountId}-capacity_calendar`;
      const incompleteJob = incompleteSyncJobs[incompleteKey];
      
      const { data, error } = await supabase.functions.invoke("sync-bulk-calendar", {
        body: { guestyAccountId: accountId },
      });

      if (error) throw error;

      toast({
        title: incompleteJob ? "Resuming calendar sync" : "Calendar sync started",
        description: incompleteJob 
          ? `Continuing from ${incompleteJob.items_synced || 0} listings. Watch progress below.`
          : "Syncing calendars for all listings. This may take a few minutes.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingCalendar(null);
    }
  };

  const handleToggleAutomation = async (accountId: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from("guesty_accounts")
        .update({ automated_sync_enabled: enabled })
        .eq("id", accountId);

      if (error) throw error;

      toast({
        title: enabled ? "Automation enabled" : "Automation disabled",
        description: enabled 
          ? "This account will be synced automatically every night at 3 AM UTC."
          : "Automated nightly syncing has been disabled for this account.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Failed to update automation setting",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleToggleAirbnbScrape = async (accountId: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from("guesty_accounts")
        .update({ airbnb_scrape_enabled: enabled })
        .eq("id", accountId);

      if (error) throw error;

      toast({
        title: enabled ? "Airbnb scraping enabled" : "Airbnb scraping disabled",
        description: enabled 
          ? "Airbnb ratings will be scraped during nightly sync."
          : "Airbnb ratings scraping will be skipped during nightly sync.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Failed to update setting",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleToggleForecastGeneration = async (accountId: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from("guesty_accounts")
        .update({ forecast_generation_enabled: enabled })
        .eq("id", accountId);

      if (error) throw error;

      toast({
        title: enabled ? "Forecast generation enabled" : "Forecast generation disabled",
        description: enabled 
          ? "Revenue forecasts will be regenerated during nightly sync."
          : "Forecast regeneration will be skipped during nightly sync.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Failed to update setting",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleToggleProbabilityCalculation = async (accountId: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from("guesty_accounts")
        .update({ probability_calculation_enabled: enabled })
        .eq("id", accountId);

      if (error) throw error;

      toast({
        title: enabled ? "Probability calculation enabled" : "Probability calculation disabled",
        description: enabled 
          ? "Booking probabilities will be calculated during nightly sync."
          : "Probability calculation will be skipped during nightly sync.",
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Failed to update setting",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleScrapeAirbnbRatings = async () => {
    setScrapingAirbnbRatings(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-scrape-airbnb-ratings", {});

      if (error) throw error;

      toast({
        title: "Airbnb ratings scrape started",
        description: "Watch the progress below. This will continue automatically.",
      });

      // Refresh last scrape time after a delay
      setTimeout(() => loadLastAirbnbScrape(), 5000);
    } catch (error: any) {
      toast({
        title: "Scrape failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setScrapingAirbnbRatings(false);
    }
  };

  // Get first account ID for Airbnb ratings sync job tracking
  const firstAccountId = guestyAccounts.length > 0 ? guestyAccounts[0].id : null;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">Manage your Guesty connections and sync data</p>
        </div>

        {/* Guesty Accounts */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GuestyIcon className="h-5 w-5" />
                  Guesty Accounts
                </CardTitle>
                <CardDescription>Connect and manage your Guesty API accounts</CardDescription>
              </div>
              <Button onClick={() => setShowAddForm(!showAddForm)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Account
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Account Form */}
            {showAddForm && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-4">
                <div>
                  <h4 className="font-medium">Add New Guesty Account</h4>
                  <p className="text-sm text-muted-foreground">
                    Enter your Guesty API credentials. You can find your API token in Guesty under Settings → API.
                  </p>
                </div>
                <form onSubmit={handleAddAccount} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="account_name">Account Name</Label>
                    <Input
                      id="account_name"
                      name="account_name"
                      placeholder="My Guesty Account"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client_id">Client ID</Label>
                    <Input
                      id="client_id"
                      name="client_id"
                      placeholder="Your Guesty Client ID"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client_secret">Client Secret</Label>
                    <Input
                      id="client_secret"
                      name="client_secret"
                      type="password"
                      placeholder="Your Guesty Client Secret"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit">Save Account</Button>
                    <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* Existing Accounts */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : guestyAccounts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <GuestyIcon className="mx-auto h-12 w-12 mb-4 opacity-50" />
                <p>No Guesty accounts connected yet.</p>
                <p className="text-sm">Add your first account to get started.</p>
              </div>
            ) : (
              <div className="divide-y">
                {guestyAccounts.map((account) => (
                  <div key={account.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                    {/* Account header row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{account.account_name}</p>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Account</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete this Guesty account connection and all associated
                                  listings and reservations. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteAccount(account.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                        {/* Compact sync info - horizontal layout */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {account.last_listings_sync && (
                            <span className="flex items-center gap-1">
                              <Home className="h-3 w-3" />
                              {new Date(account.last_listings_sync).toLocaleDateString()}
                              {lastSyncCounts[`${account.id}-listings`] && ` (${lastSyncCounts[`${account.id}-listings`]})`}
                            </span>
                          )}
                          {account.last_reservations_sync && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(account.last_reservations_sync).toLocaleDateString()}
                              {(lastSyncCounts[`${account.id}-reservations`] || lastSyncCounts[`${account.id}-new_reservations`]) && 
                                ` (${lastSyncCounts[`${account.id}-reservations`] || lastSyncCounts[`${account.id}-new_reservations`]})`}
                            </span>
                          )}
                          {account.last_owners_sync && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {new Date(account.last_owners_sync).toLocaleDateString()}
                            </span>
                          )}
                          {account.last_reviews_sync && (
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3" />
                              {new Date(account.last_reviews_sync).toLocaleDateString()}
                              {lastSyncCounts[`${account.id}-reviews`] && ` (${lastSyncCounts[`${account.id}-reviews`]})`}
                            </span>
                          )}
                          {account.last_calendar_sync && (
                            <span className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3" />
                              {new Date(account.last_calendar_sync).toLocaleDateString()}
                              {lastSyncCounts[`${account.id}-capacity_calendar`] && ` (${lastSyncCounts[`${account.id}-capacity_calendar`]})`}
                            </span>
                          )}
                          {account.last_automated_sync && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Auto: {new Date(account.last_automated_sync).toLocaleDateString()}
                              {autoSyncFailures[account.id]?.length > 0 && (
                                <Badge variant="destructive" className="ml-1 text-xs py-0 px-1.5 gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {autoSyncFailures[account.id].length} failed
                                </Badge>
                              )}
                            </span>
                          )}
                          {!account.last_listings_sync && !account.last_reservations_sync && !account.last_owners_sync && !account.last_reviews_sync && !account.last_calendar_sync && (
                            <span>Never synced</span>
                          )}
                        </div>
                      </div>
                      
                      {/* Actions: Auto sync toggle + delete */}
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`automation-${account.id}`}
                            checked={account.automated_sync_enabled !== false}
                            onCheckedChange={(checked) => handleToggleAutomation(account.id, checked)}
                          />
                          <Label htmlFor={`automation-${account.id}`} className="text-sm cursor-pointer whitespace-nowrap">
                            Auto Sync
                          </Label>
                          {account.automated_sync_enabled !== false && (
                            <Badge variant="secondary" className="text-xs">
                              3 AM UTC
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Sync buttons row */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => handleSyncListings(account.id)}
                        disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id || syncingCalendar === account.id}
                        variant="outline"
                        size="sm"
                      >
                        {syncingListings === account.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Syncing...
                          </>
                        ) : (
                          <>
                            <Home className="mr-2 h-4 w-4" />
                            Listings
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => handleSyncReservations(account.id)}
                        disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id || syncingCalendar === account.id}
                        variant="outline"
                        size="sm"
                      >
                        {syncingReservations === account.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Syncing...
                          </>
                        ) : (() => {
                          const incompleteKey = `${account.id}-reservations`;
                          const incompleteJob = incompleteSyncJobs[incompleteKey];
                          return incompleteJob ? (
                            <>
                              <Calendar className="mr-2 h-4 w-4" />
                              Resume ({incompleteJob.items_synced || 0})
                            </>
                          ) : (
                            <>
                              <Calendar className="mr-2 h-4 w-4" />
                              Reservations
                            </>
                          );
                        })()}
                      </Button>
                      <Button
                        onClick={() => handleSyncOwners(account.id)}
                        disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id || syncingCalendar === account.id}
                        variant="outline"
                        size="sm"
                      >
                        {syncingOwners === account.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Syncing...
                          </>
                        ) : (
                          <>
                            <Users className="mr-2 h-4 w-4" />
                            Owners
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => handleSyncReviews(account.id)}
                        disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id || syncingCalendar === account.id}
                        variant="outline"
                        size="sm"
                      >
                        {syncingReviews === account.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Syncing...
                          </>
                        ) : (() => {
                          const incompleteKey = `${account.id}-reviews`;
                          const incompleteJob = incompleteSyncJobs[incompleteKey];
                          return incompleteJob ? (
                            <>
                              <Star className="mr-2 h-4 w-4" />
                              Resume ({incompleteJob.items_synced || 0})
                            </>
                          ) : (
                            <>
                              <Star className="mr-2 h-4 w-4" />
                              Reviews
                            </>
                          );
                        })()}
                      </Button>
                      <Button
                        onClick={() => handleSyncCalendar(account.id)}
                        disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id || syncingCalendar === account.id}
                        variant="outline"
                        size="sm"
                      >
                        {syncingCalendar === account.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Syncing...
                          </>
                        ) : (() => {
                          const incompleteKey = `${account.id}-capacity_calendar`;
                          const incompleteJob = incompleteSyncJobs[incompleteKey];
                          return incompleteJob ? (
                            <>
                              <CalendarDays className="mr-2 h-4 w-4" />
                              Resume ({incompleteJob.items_synced || 0})
                            </>
                          ) : (
                            <>
                              <CalendarDays className="mr-2 h-4 w-4" />
                              Calendars
                            </>
                          );
                        })()}
                      </Button>
                    </div>
                    
                    {/* Real-time sync progress cards */}
                    <SyncProgressCard accountId={account.id} syncType="listings" />
                    <SyncProgressCard accountId={account.id} syncType="reservations" />
                    <SyncProgressCard accountId={account.id} syncType="reviews" />
                    <SyncProgressCard accountId={account.id} syncType="capacity_calendar" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Airbnb Ratings */}
        {firstAccountId && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <AirbnbIcon className="h-5 w-5 text-[#FF5A5F]" />
                    Airbnb Ratings
                  </CardTitle>
                  <CardDescription>
                    Scrape live ratings directly from Airbnb for all your listings
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="airbnb-auto-sync"
                    checked={guestyAccounts[0]?.airbnb_scrape_enabled !== false}
                    onCheckedChange={(checked) => handleToggleAirbnbScrape(guestyAccounts[0].id, checked)}
                  />
                  <Label htmlFor="airbnb-auto-sync" className="text-sm cursor-pointer">
                    Include in nightly sync
                  </Label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {lastAirbnbScrape ? (
                    <span>
                      Last scraped: {new Date(lastAirbnbScrape.date).toLocaleString()}
                      {lastAirbnbScrape.count > 0 ? ` (${lastAirbnbScrape.count} listings)` : ''}
                    </span>
                  ) : (
                    <span>Never scraped</span>
                  )}
                </div>
                <Button
                  onClick={handleScrapeAirbnbRatings}
                  disabled={scrapingAirbnbRatings}
                  variant="outline"
                >
                  {scrapingAirbnbRatings ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <AirbnbIcon className="mr-2 h-4 w-4" />
                      Scrape Airbnb Ratings
                    </>
                  )}
                </Button>
              </div>
              
              {/* Progress card */}
              <SyncProgressCard 
                accountId={firstAccountId} 
                syncType="airbnb_ratings"
                onComplete={() => loadLastAirbnbScrape()}
              />
              
              <p className="text-xs text-muted-foreground">
                This will scrape live Airbnb ratings for all listings with an Airbnb ID. 
                Listings scraped within the last 24 hours will be skipped. 
                The process runs automatically and may take several minutes for large portfolios.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Booking Probabilities */}
        {firstAccountId && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Booking Probabilities
                  </CardTitle>
                  <CardDescription>
                    AI-calculated likelihood of booking each available night
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="probability-auto-sync"
                    checked={guestyAccounts[0]?.probability_calculation_enabled !== false}
                    onCheckedChange={(checked) => handleToggleProbabilityCalculation(guestyAccounts[0].id, checked)}
                  />
                  <Label htmlFor="probability-auto-sync" className="text-sm cursor-pointer">
                    Include in nightly sync
                  </Label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Probabilities combine four signals to estimate booking likelihood for each open night:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Compset Demand:</strong> How many comparables are already booked</li>
                  <li><strong>Price Position:</strong> Your rate vs. available compset average</li>
                  <li><strong>Historical:</strong> Was this date booked last year?</li>
                  <li><strong>Booking Window:</strong> Days until arrival vs. typical lead time</li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                View probabilities on any property's calendar tab
              </p>
            </CardContent>
          </Card>
        )}

        {/* Revenue Forecasts */}
        {firstAccountId && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Revenue Forecasts
                  </CardTitle>
                  <CardDescription>
                    AI-powered year-end revenue projection with probability &amp; compset data
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="forecast-auto-sync"
                    checked={guestyAccounts[0]?.forecast_generation_enabled !== false}
                    onCheckedChange={(checked) => handleToggleForecastGeneration(guestyAccounts[0].id, checked)}
                  />
                  <Label htmlFor="forecast-auto-sync" className="text-sm cursor-pointer">
                    Include in nightly sync
                  </Label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Forecasts combine your booking pace, probability analysis, and compset market data 
                  to predict monthly revenue with P10-P50-P90 confidence ranges.
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Pace:</strong> Current bookings vs. same day last year</li>
                  <li><strong>Probability:</strong> Lead time decay &amp; gap quality for open nights</li>
                  <li><strong>Market Demand:</strong> Compset occupancy signals (High/Med/Low)</li>
                  <li><strong>Capacity Ceiling:</strong> On Books + Available × Asking Rate</li>
                </ul>
              </div>
              
              <div className="flex items-center gap-4">
                <Button variant="outline" asChild>
                  <Link to="/forecast-admin">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Forecast Admin
                  </Link>
                </Button>
                <p className="text-xs text-muted-foreground">
                  Run manual forecasts or first-time data preparation
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <TeamManagement />

        <AIPromptsSettings />
      </div>
    </DashboardLayout>
  );
}

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Loader2, Key, Home, Calendar, Users, Star } from "lucide-react";
import { SyncProgressCard } from "@/components/SyncProgressCard";
import { TeamManagement } from "@/components/TeamManagement";
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [incompleteSyncJobs, setIncompleteSyncJobs] = useState<Record<string, any>>({});

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("guesty_accounts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setGuestyAccounts(data || []);
      
      // Check for incomplete sync jobs
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
      const { data, error } = await supabase.functions.invoke("sync-reviews", {
        body: { guestyAccountId: accountId },
      });

      if (error) throw error;

      toast({
        title: "Reviews synced successfully",
        description: data.message || `Synced ${data.synced} reviews`,
      });

      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Failed to sync reviews",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncingReviews(null);
    }
  };

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
                <CardTitle>Guesty Accounts</CardTitle>
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
              <Card className="border-2 border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">Add New Guesty Account</CardTitle>
                  <CardDescription>
                    Enter your Guesty API credentials. You can find your API token in Guesty under Settings → API.
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            )}

            {/* Existing Accounts */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : guestyAccounts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Key className="mx-auto h-12 w-12 mb-4 opacity-50" />
                <p>No Guesty accounts connected yet.</p>
                <p className="text-sm">Add your first account to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {guestyAccounts.map((account) => (
                  <div key={account.id} className="space-y-3">
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="space-y-1">
                            <p className="font-medium">{account.account_name}</p>
                            <div className="text-xs text-muted-foreground space-y-0.5">
                              {account.last_listings_sync && (
                                <div className="flex items-center gap-1">
                                  <Home className="h-3 w-3" />
                                  <span>Listings: {new Date(account.last_listings_sync).toLocaleString()}</span>
                                </div>
                              )}
                              {account.last_reservations_sync && (
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  <span>Reservations: {new Date(account.last_reservations_sync).toLocaleString()}</span>
                                </div>
                              )}
                              {account.last_owners_sync && (
                                <div className="flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  <span>Owners: {new Date(account.last_owners_sync).toLocaleString()}</span>
                                </div>
                              )}
                              {account.last_reviews_sync && (
                                <div className="flex items-center gap-1">
                                  <Star className="h-3 w-3" />
                                  <span>Reviews: {new Date(account.last_reviews_sync).toLocaleString()}</span>
                                </div>
                              )}
                              {!account.last_listings_sync && !account.last_reservations_sync && !account.last_owners_sync && !account.last_reviews_sync && (
                                <span>Never synced</span>
                              )}
                            </div>
                          </div>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="icon">
                                <Trash2 className="h-4 w-4" />
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
                        
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleSyncListings(account.id)}
                            disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id}
                            variant="outline"
                            className="flex-1"
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
                                Sync Listings
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => handleSyncReservations(account.id)}
                            disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id}
                            variant="outline"
                            className="flex-1"
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
                                  Resume ({incompleteJob.items_synced || 0} synced)
                                </>
                              ) : (
                                <>
                                  <Calendar className="mr-2 h-4 w-4" />
                                  Sync Reservations
                                </>
                              );
                            })()}
                          </Button>
                          <Button
                            onClick={() => handleSyncOwners(account.id)}
                            disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id}
                            variant="outline"
                            className="flex-1"
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
                                Sync Owners
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={() => handleSyncReviews(account.id)}
                            disabled={syncingListings === account.id || syncingReservations === account.id || syncingOwners === account.id || syncingReviews === account.id}
                            variant="outline"
                            className="flex-1"
                            size="sm"
                          >
                            {syncingReviews === account.id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Syncing...
                              </>
                            ) : (
                              <>
                                <Star className="mr-2 h-4 w-4" />
                                Sync Reviews
                              </>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                    
                    {/* Real-time sync progress cards */}
                    <SyncProgressCard accountId={account.id} syncType="listings" />
                    <SyncProgressCard accountId={account.id} syncType="reservations" />
                    <SyncProgressCard accountId={account.id} syncType="reviews" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>How to Get Your Guesty API Token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. Log in to your Guesty account</p>
            <p>2. Navigate to Settings → Integration → Open API</p>
            <p>3. Click "Create Secret" to generate Client ID and Client Secret</p>
            <p>4. Copy both credentials and paste them above</p>
            <p className="text-xs pt-2">
              Note: The initial sync will import all reservations from the last 2 years by default.
            </p>
          </CardContent>
        </Card>

        <TeamManagement />
      </div>
    </DashboardLayout>
  );
}

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Loader2, Key, Download } from "lucide-react";
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
  const [syncing, setSyncing] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

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
    const apiToken = formData.get("api_token") as string;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("guesty_accounts").insert({
        user_id: user.id,
        account_name: accountName,
        api_token: apiToken,
      });

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

  const handleSync = async (accountId: string) => {
    setSyncing(accountId);
    try {
      // Call the sync edge function
      const { data, error } = await supabase.functions.invoke("sync-guesty-data", {
        body: { accountId },
      });

      if (error) throw error;

      toast({
        title: "Sync started",
        description: `Imported ${data.listingsCount} listings and ${data.reservationsCount} reservations.`,
      });

      // Reload accounts to update last_sync_at
      loadAccounts();
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSyncing(null);
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
                      <Label htmlFor="api_token">API Token</Label>
                      <Input
                        id="api_token"
                        name="api_token"
                        type="password"
                        placeholder="Your Guesty API token"
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
                  <Card key={account.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="font-medium">{account.account_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {account.last_sync_at
                              ? `Last synced: ${new Date(account.last_sync_at).toLocaleString()}`
                              : "Never synced"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleSync(account.id)}
                            disabled={syncing === account.id}
                            variant="outline"
                          >
                            {syncing === account.id ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Syncing...
                              </>
                            ) : (
                              <>
                                <Download className="mr-2 h-4 w-4" />
                                Sync Now
                              </>
                            )}
                          </Button>
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
                      </div>
                    </CardContent>
                  </Card>
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
            <p>3. Click "Create Secret" to generate a new API token</p>
            <p>4. Copy the token and paste it above</p>
            <p className="text-xs pt-2">
              Note: The initial sync will import all reservations. Make sure you have the appropriate permissions in Guesty.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

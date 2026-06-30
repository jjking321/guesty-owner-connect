import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Loader2, Plug, AlertCircle, Eye, EyeOff } from "lucide-react";
import { z } from "zod";
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

type TrackAccount = {
  id: string;
  account_name: string;
  api_base_url: string;
  is_active: boolean;
  last_listings_sync_at: string | null;
  last_reservations_sync_at: string | null;
};

export function TrackHsAccounts() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<TrackAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showUsername, setShowUsername] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("track_accounts")
      .select("id, account_name, api_base_url, is_active, last_listings_sync_at, last_reservations_sync_at")
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Failed to load TrackHS accounts", description: error.message, variant: "destructive" });
    } else {
      setAccounts((data ?? []) as TrackAccount[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const baseSchema = z.object({
    username: z
      .string()
      .trim()
      .min(1, { message: "API username is required" })
      .max(255, { message: "Username must be less than 255 characters" }),
    password: z
      .string()
      .min(1, { message: "API password is required" })
      .max(1024, { message: "Password must be less than 1024 characters" }),
  });
  const newAccountSchema = baseSchema.extend({
    account_name: z
      .string()
      .trim()
      .min(1, { message: "Account name is required" })
      .max(100, { message: "Account name must be less than 100 characters" }),
    api_base_url: z
      .string()
      .trim()
      .url({ message: "Enter a valid URL (e.g. https://yourtenant.trackhs.com/api)" })
      .max(500, { message: "URL must be less than 500 characters" })
      .refine((v) => /^https:\/\//i.test(v), { message: "URL must start with https://" }),
  });

  const friendlyError = (msg: string): string => {
    const m = msg.toLowerCase();
    if (m.includes("401") || m.includes("invalid token") || m.includes("not authenticated"))
      return "Your session expired. Please sign in again and retry.";
    if (m.includes("403") || m.includes("permission") || m.includes("admin"))
      return "You need admin permissions on this organization to manage TrackHS accounts.";
    if (m.includes("duplicate") || m.includes("unique"))
      return "An account with these details already exists.";
    if (m.includes("network") || m.includes("failed to fetch"))
      return "Network error — check your connection and try again.";
    return msg || "Something went wrong. Please try again.";
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const fd = new FormData(e.currentTarget);
    const raw = {
      account_name: String(fd.get("account_name") ?? "").trim(),
      api_base_url: String(fd.get("api_base_url") ?? "").trim(),
      username: String(fd.get("username") ?? "").trim(),
      password: String(fd.get("password") ?? ""),
    };

    const schema = editingId ? baseSchema : newAccountSchema;
    const result = schema.safeParse(raw);
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      setFormError("Please fix the highlighted fields and try again.");
      return;
    }

    const payload = { account_id: editingId, ...result.data } as Record<string, unknown>;
    setSaving(true);
    const { error } = await supabase.functions.invoke("save-track-credentials", { body: payload });
    setSaving(false);
    if (error) {
      const friendly = friendlyError(error.message ?? "");
      setFormError(friendly);
      toast({ title: "Save failed", description: friendly, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Credentials updated" : "TrackHS account connected" });
    setShowForm(false);
    setEditingId(null);
    setFieldErrors({});
    setFormError(null);
    load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("track_accounts").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Account removed" });
    load();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              TrackHS Accounts
            </CardTitle>
            <CardDescription>Connect and manage your TrackHS (TNS) API credentials</CardDescription>
          </div>
          {!showForm && (
            <Button
              size="sm"
              onClick={() => {
                setEditingId(null);
                setShowForm(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add account
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <form onSubmit={handleSubmit} noValidate className="space-y-3 rounded-lg border p-4">
            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            {!editingId && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="account_name">Account name</Label>
                  <Input
                    id="account_name"
                    name="account_name"
                    placeholder="e.g. Main TrackHS Tenant"
                    maxLength={100}
                    aria-invalid={!!fieldErrors.account_name}
                  />
                  {fieldErrors.account_name && (
                    <p className="text-xs text-destructive">{fieldErrors.account_name}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="api_base_url">API base URL</Label>
                  <Input
                    id="api_base_url"
                    name="api_base_url"
                    type="url"
                    inputMode="url"
                    placeholder="https://yourtenant.trackhs.com/api"
                    maxLength={500}
                    aria-invalid={!!fieldErrors.api_base_url}
                  />
                  {fieldErrors.api_base_url ? (
                    <p className="text-xs text-destructive">{fieldErrors.api_base_url}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Must start with https://</p>
                  )}
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">API username</Label>
              <div className="relative">
                <Input
                  id="username"
                  name="username"
                  type={showUsername ? "text" : "password"}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  maxLength={255}
                  className="pr-10"
                  aria-invalid={!!fieldErrors.username}
                />
                <button
                  type="button"
                  onClick={() => setShowUsername((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  aria-label={showUsername ? "Hide username" : "Show username"}
                  tabIndex={-1}
                >
                  {showUsername ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErrors.username && (
                <p className="text-xs text-destructive">{fieldErrors.username}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">API password / key</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  maxLength={1024}
                  className="pr-10"
                  aria-invalid={!!fieldErrors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="text-xs text-destructive">{fieldErrors.password}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Credentials are hidden by default and stored securely on the server. We never display saved values back to you — use “Update credentials” to rotate them.
            </p>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Update credentials" : "Save account"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setFieldErrors({});
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : accounts.length === 0 && !showForm ? (
          <div className="text-center py-8 text-muted-foreground">
            <Plug className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No TrackHS accounts connected yet.</p>
            <p className="text-sm">Add your tenant credentials to get started.</p>
          </div>
        ) : (
          <div className="divide-y">
            {accounts.map((account) => (
              <div key={account.id} className="py-4 first:pt-0 last:pb-0 flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{account.account_name}</p>
                    {account.is_active ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{account.api_base_url}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingId(account.id);
                      setShowForm(true);
                    }}
                  >
                    Update credentials
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete TrackHS account?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the connection and stored credentials. Synced data will be deleted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(account.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

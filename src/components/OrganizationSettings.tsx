import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function OrganizationSettings() {
  const { organizationId, role } = useUserRole();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();
      if (!error && data) {
        setName(data.name);
        setOriginal(data.name);
      }
      setLoading(false);
    })();
  }, [organizationId]);

  if (role !== "super_admin") return null;

  const handleSave = async () => {
    if (!organizationId || !name.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("organizations")
      .update({ name: name.trim() })
      .eq("id", organizationId);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setOriginal(name.trim());
    toast({ title: "Workspace updated", description: "Reloading to apply changes…" });
    setTimeout(() => window.location.reload(), 600);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>Set the name shown in the organization switcher.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex flex-col gap-3 max-w-md">
            <Label htmlFor="org-name">Workspace name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My organization"
            />
            <div>
              <Button
                onClick={handleSave}
                disabled={saving || !name.trim() || name.trim() === original}
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

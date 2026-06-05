import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X } from "lucide-react";

const MAX_LOGO_BYTES = 500_000; // 500 KB

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function OrganizationSettings() {
  const { organizationId, role } = useUserRole();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primary, setPrimary] = useState("#0f172a");
  const [secondary, setSecondary] = useState("#3b82f6");

  const [original, setOriginal] = useState({ name: "", logoUrl: null as string | null, primary: "#0f172a", secondary: "#3b82f6" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("organizations")
        .select("name, logo_url, brand_primary_color, brand_secondary_color")
        .eq("id", organizationId)
        .maybeSingle();
      if (!error && data) {
        const next = {
          name: data.name,
          logoUrl: (data as any).logo_url ?? null,
          primary: (data as any).brand_primary_color || "#0f172a",
          secondary: (data as any).brand_secondary_color || "#3b82f6",
        };
        setName(next.name);
        setLogoUrl(next.logoUrl);
        setPrimary(next.primary);
        setSecondary(next.secondary);
        setOriginal(next);
      }
      setLoading(false);
    })();
  }, [organizationId]);

  if (role !== "super_admin") return null;

  const handleLogoSelect = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) {
      toast({ title: "Unsupported file", description: "Use PNG, JPEG, WebP, or SVG.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({ title: "File too large", description: "Max 500 KB.", variant: "destructive" });
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setLogoUrl(dataUrl);
    } catch (e: any) {
      toast({ title: "Failed to read file", description: e.message, variant: "destructive" });
    }
  };

  const dirty =
    name.trim() !== original.name ||
    logoUrl !== original.logoUrl ||
    primary !== original.primary ||
    secondary !== original.secondary;

  const handleSave = async () => {
    if (!organizationId || !name.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("organizations")
      .update({
        name: name.trim(),
        logo_url: logoUrl,
        brand_primary_color: primary,
        brand_secondary_color: secondary,
      } as any)
      .eq("id", organizationId);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setOriginal({ name: name.trim(), logoUrl, primary, secondary });
    toast({ title: "Workspace updated" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace & Branding</CardTitle>
        <CardDescription>Workspace name, logo, and brand colors used in exports like the KPI PDF.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid gap-6 md:grid-cols-2 max-w-3xl">
            <div className="flex flex-col gap-3">
              <Label htmlFor="org-name">Workspace name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My organization"
              />

              <Label className="mt-2">Brand colors</Label>
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">Primary</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primary}
                      onChange={(e) => setPrimary(e.target.value)}
                      className="h-9 w-12 rounded border bg-background cursor-pointer"
                      aria-label="Primary brand color"
                    />
                    <Input value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-9" />
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">Accent</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={secondary}
                      onChange={(e) => setSecondary(e.target.value)}
                      className="h-9 w-12 rounded border bg-background cursor-pointer"
                      aria-label="Accent brand color"
                    />
                    <Input value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-9" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Label>Logo</Label>
              <div
                className="rounded-md border p-4 flex items-center justify-center min-h-[120px]"
                style={{ background: primary }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="Workspace logo" className="max-h-24 max-w-full object-contain" />
                ) : (
                  <span className="text-xs" style={{ color: "#fff", opacity: 0.7 }}>
                    No logo uploaded
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => handleLogoSelect(e.target.files?.[0])}
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />
                  {logoUrl ? "Replace" : "Upload"}
                </Button>
                {logoUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLogoUrl(null)}>
                    <X className="h-4 w-4 mr-1" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, or SVG. Max 500 KB.</p>
            </div>

            <div className="md:col-span-2">
              <Button onClick={handleSave} disabled={saving || !name.trim() || !dirty}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

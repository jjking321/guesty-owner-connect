import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";

export interface OrgBranding {
  name: string;
  logoUrl: string | null;
  primary: string;
  secondary: string;
}

const DEFAULTS: OrgBranding = {
  name: "RevMan",
  logoUrl: null,
  primary: "#0f172a",
  secondary: "#3b82f6",
};

export function useOrgBranding(): OrgBranding {
  const { organizationId } = useUserRole();
  const [branding, setBranding] = useState<OrgBranding>(DEFAULTS);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name, logo_url, brand_primary_color, brand_secondary_color")
        .eq("id", organizationId)
        .maybeSingle();
      if (cancelled || !data) return;
      setBranding({
        name: data.name || DEFAULTS.name,
        logoUrl: (data as any).logo_url ?? null,
        primary: (data as any).brand_primary_color || DEFAULTS.primary,
        secondary: (data as any).brand_secondary_color || DEFAULTS.secondary,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return branding;
}

// Parse a hex string like "#3b82f6" → [r, g, b]
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [15, 23, 42];
}

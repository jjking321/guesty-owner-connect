import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface TaxSetting {
  id?: string;
  listing_id: string;
  permit_number: string;
  property_address: string;
  behalf_platforms: string[];
  organization_id: string;
  nickname: string; // from listings join
}

export function TaxSettingsTable() {
  const { organizationId } = useUserRole();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Partial<TaxSetting>>>({});

  // Fetch listings with their tax settings
  const { data: listings, isLoading: listingsLoading } = useQuery({
    queryKey: ["tax-settings-listings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, address, guesty_account_id")
        .eq("archived", false)
        .order("nickname");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: taxSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ["listing-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listing_tax_settings")
        .select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Fetch distinct sources from reservations
  const { data: sources } = useQuery({
    queryKey: ["reservation-sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservations")
        .select("source")
        .not("source", "is", null)
        .limit(1000);
      if (error) throw error;
      const unique = [...new Set(data.map((r) => r.source).filter(Boolean))] as string[];
      return unique.sort();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (settings: { listing_id: string; permit_number: string; property_address: string; behalf_platforms: string[] }) => {
      const existing = taxSettings?.find((s) => s.listing_id === settings.listing_id);
      if (existing) {
        const { error } = await supabase
          .from("listing_tax_settings")
          .update({
            permit_number: settings.permit_number,
            property_address: settings.property_address,
            behalf_platforms: settings.behalf_platforms,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("listing_tax_settings")
          .insert({
            listing_id: settings.listing_id,
            permit_number: settings.permit_number,
            property_address: settings.property_address,
            behalf_platforms: settings.behalf_platforms,
            organization_id: organizationId!,
          });
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["listing-tax-settings"] });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[vars.listing_id];
        return next;
      });
      toast.success("Tax settings saved");
    },
    onError: (err: Error) => {
      toast.error("Failed to save: " + err.message);
    },
  });

  const getSettingForListing = (listingId: string) => {
    return taxSettings?.find((s) => s.listing_id === listingId);
  };

  const getEditValue = (listingId: string, field: keyof TaxSetting, fallback: string | string[]) => {
    const edit = edits[listingId];
    if (edit && field in edit) return edit[field];
    return fallback;
  };

  const updateEdit = (listingId: string, field: string, value: string | string[]) => {
    setEdits((prev) => ({
      ...prev,
      [listingId]: { ...prev[listingId], [field]: value },
    }));
  };

  const togglePlatform = (listingId: string, platform: string, currentPlatforms: string[]) => {
    const updated = currentPlatforms.includes(platform)
      ? currentPlatforms.filter((p) => p !== platform)
      : [...currentPlatforms, platform];
    updateEdit(listingId, "behalf_platforms", updated);
  };

  const handleSave = (listingId: string) => {
    const setting = getSettingForListing(listingId);
    const edit = edits[listingId] || {};
    saveMutation.mutate({
      listing_id: listingId,
      permit_number: (edit.permit_number ?? setting?.permit_number ?? "") as string,
      property_address: (edit.property_address ?? setting?.property_address ?? "") as string,
      behalf_platforms: (edit.behalf_platforms ?? setting?.behalf_platforms ?? []) as string[],
    });
  };

  const getDefaultAddress = (listing: any): string => {
    if (!listing.address) return "";
    const addr = listing.address as any;
    return [addr.street, addr.city, addr.state, addr.zipcode].filter(Boolean).join(", ");
  };

  if (listingsLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure tax permit numbers and select which platforms remit taxes on your behalf for each property.
      </p>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Property</TableHead>
              <TableHead className="w-[140px]">Permit Number</TableHead>
              <TableHead className="w-[250px]">Tax Address</TableHead>
              <TableHead>Platforms that remit taxes</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings?.map((listing) => {
              const setting = getSettingForListing(listing.id);
              const currentPermit = getEditValue(listing.id, "permit_number", setting?.permit_number ?? "") as string;
              const currentAddress = getEditValue(listing.id, "property_address", setting?.property_address ?? getDefaultAddress(listing)) as string;
              const currentPlatforms = getEditValue(listing.id, "behalf_platforms", setting?.behalf_platforms ?? []) as string[];
              const hasEdits = !!edits[listing.id];

              return (
                <TableRow key={listing.id}>
                  <TableCell className="font-medium text-sm">
                    {listing.nickname || listing.id}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={currentPermit}
                      onChange={(e) => updateEdit(listing.id, "permit_number", e.target.value)}
                      placeholder="e.g. 25-001764"
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={currentAddress}
                      onChange={(e) => updateEdit(listing.id, "property_address", e.target.value)}
                      placeholder="Property address"
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {sources?.map((source) => (
                        <label key={source} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <Checkbox
                            checked={currentPlatforms.includes(source)}
                            onCheckedChange={() => togglePlatform(listing.id, source, currentPlatforms)}
                          />
                          <span>{source}</span>
                        </label>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={hasEdits ? "default" : "ghost"}
                      onClick={() => handleSave(listing.id)}
                      disabled={saveMutation.isPending}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

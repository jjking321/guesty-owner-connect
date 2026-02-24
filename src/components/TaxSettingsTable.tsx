import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SyncProgressCard } from "@/components/SyncProgressCard";

interface TaxSetting {
  id?: string;
  listing_id: string;
  permit_number: string;
  property_address: string;
  organization_id: string;
  nickname: string;
}

export function TaxSettingsTable() {
  const { organizationId } = useUserRole();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Partial<TaxSetting>>>({});
  const [backfilling, setBackfilling] = useState(false);

  // Fetch guesty account for backfill
  const { data: guestyAccount } = useQuery({
    queryKey: ["guesty-account-for-tax", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guesty_accounts")
        .select("id")
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });
  // Fetch listings
  const { data: listings, isLoading: listingsLoading } = useQuery({
    queryKey: ["tax-settings-listings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, address, guesty_account_id, active")
        .eq("archived", false)
        .eq("active", true)
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

  // Fetch org-level tax settings
  const { data: orgTaxSettings } = useQuery({
    queryKey: ["organization-tax-settings", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_tax_settings")
        .select("*")
        .eq("organization_id", organizationId!)
        .maybeSingle();
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

  const [behalfPlatforms, setBehalfPlatforms] = useState<string[] | null>(null);

  const currentBehalfPlatforms = behalfPlatforms ?? orgTaxSettings?.behalf_platforms ?? [];

  const saveBehalfMutation = useMutation({
    mutationFn: async (platforms: string[]) => {
      if (orgTaxSettings) {
        const { error } = await supabase
          .from("organization_tax_settings")
          .update({ behalf_platforms: platforms })
          .eq("id", orgTaxSettings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("organization_tax_settings")
          .insert({
            organization_id: organizationId!,
            behalf_platforms: platforms,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-tax-settings"] });
      setBehalfPlatforms(null);
      toast.success("Platform settings saved");
    },
    onError: (err: Error) => {
      toast.error("Failed to save: " + err.message);
    },
  });

  const togglePlatform = (platform: string) => {
    const current = behalfPlatforms ?? orgTaxSettings?.behalf_platforms ?? [];
    const updated = current.includes(platform)
      ? current.filter((p) => p !== platform)
      : [...current, platform];
    setBehalfPlatforms(updated);
  };

  const saveMutation = useMutation({
    mutationFn: async (settings: { listing_id: string; permit_number: string; property_address: string }) => {
      const existing = taxSettings?.find((s) => s.listing_id === settings.listing_id);
      if (existing) {
        const { error } = await supabase
          .from("listing_tax_settings")
          .update({
            permit_number: settings.permit_number,
            property_address: settings.property_address,
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

  const getEditValue = (listingId: string, field: keyof TaxSetting, fallback: string) => {
    const edit = edits[listingId];
    if (edit && field in edit) return edit[field];
    return fallback;
  };

  const updateEdit = (listingId: string, field: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [listingId]: { ...prev[listingId], [field]: value },
    }));
  };

  const handleSave = (listingId: string) => {
    const setting = getSettingForListing(listingId);
    const edit = edits[listingId] || {};
    saveMutation.mutate({
      listing_id: listingId,
      permit_number: (edit.permit_number ?? setting?.permit_number ?? "") as string,
      property_address: (edit.property_address ?? setting?.property_address ?? "") as string,
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

  const hasBehalfEdits = behalfPlatforms !== null;

  return (
    <div className="space-y-6">
      {/* Global behalf platforms setting */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Platforms that remit taxes on your behalf</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-center">
            {sources?.map((source) => (
              <label key={source} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox
                  checked={currentBehalfPlatforms.includes(source)}
                  onCheckedChange={() => togglePlatform(source)}
                />
                <span>{source}</span>
              </label>
            ))}
            {hasBehalfEdits && (
              <Button
                size="sm"
                onClick={() => saveBehalfMutation.mutate(currentBehalfPlatforms)}
                disabled={saveBehalfMutation.isPending}
              >
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Backfill missing taxes */}
      {guestyAccount && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Backfill Missing Tax Data</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    setBackfilling(true);
                    const { error } = await supabase.functions.invoke('backfill-reservation-taxes', {
                      body: { guestyAccountId: guestyAccount.id },
                    });
                    if (error) throw error;
                    toast.success("Tax backfill started");
                  } catch (err: any) {
                    toast.error("Failed to start backfill: " + err.message);
                  } finally {
                    setBackfilling(false);
                  }
                }}
                disabled={backfilling}
              >
                {backfilling ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Backfill Missing Taxes
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Fetches tax amounts from Guesty for reservations that are missing tax data. This runs in the background.
            </p>
            <SyncProgressCard
              accountId={guestyAccount.id}
              syncType="backfill_taxes"
            />
          </CardContent>
        </Card>
      )}

      {/* Per-property settings */}
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure tax permit numbers and addresses for each property.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Include</TableHead>
                <TableHead className="w-[200px]">Property</TableHead>
                <TableHead className="w-[140px]">Permit Number</TableHead>
                <TableHead className="w-[300px]">Tax Address</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings?.map((listing) => {
                const setting = getSettingForListing(listing.id);
                const currentPermit = getEditValue(listing.id, "permit_number", setting?.permit_number ?? "") as string;
                const currentAddress = getEditValue(listing.id, "property_address", setting?.property_address ?? getDefaultAddress(listing)) as string;
                const hasEdits = !!edits[listing.id];

                const isIncluded = !setting?.excluded_from_tax;

                return (
                  <TableRow key={listing.id}>
                    <TableCell>
                      <Checkbox
                        checked={isIncluded}
                        onCheckedChange={async (checked) => {
                          const excluded = !checked;
                          if (setting) {
                            await supabase
                              .from("listing_tax_settings")
                              .update({ excluded_from_tax: excluded })
                              .eq("id", setting.id);
                          } else {
                            await supabase
                              .from("listing_tax_settings")
                              .insert({
                                listing_id: listing.id,
                                organization_id: organizationId!,
                                excluded_from_tax: excluded,
                              });
                          }
                          queryClient.invalidateQueries({ queryKey: ["listing-tax-settings"] });
                        }}
                      />
                    </TableCell>
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
    </div>
  );
}

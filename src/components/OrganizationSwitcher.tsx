import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Building2, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function OrganizationSwitcher() {
  const { memberships, organizationId, switchOrganization, role } = useUserRole();
  const [switching, setSwitching] = useState<string | null>(null);

  if (role === 'owner' || memberships.length <= 1) return null;

  const active = memberships.find(m => m.organizationId === organizationId);
  const switchingName = memberships.find(m => m.organizationId === switching)?.organizationName;

  const handleSwitch = async (orgId: string) => {
    if (orgId === organizationId) return;
    setSwitching(orgId);
    try {
      await switchOrganization(orgId);
      // Hard reload to ensure all queries and caches reset cleanly under the new org.
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch organization', e);
      setSwitching(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 max-w-[240px]" disabled={!!switching}>
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{active?.organizationName ?? 'Select organization'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 bg-popover">
          <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {memberships.map(m => (
            <DropdownMenuItem
              key={m.organizationId}
              onClick={() => handleSwitch(m.organizationId)}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex flex-col">
                <span className="truncate">{m.organizationName}</span>
                <span className="text-xs text-muted-foreground capitalize">{m.role.replace('_', ' ')}</span>
              </div>
              {m.organizationId === organizationId && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!switching}>
        <DialogContent
          className="sm:max-w-sm"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div>
              <p className="font-medium">Switching organization</p>
              <p className="text-sm text-muted-foreground mt-1">
                Loading {switchingName ?? 'organization'} data…
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

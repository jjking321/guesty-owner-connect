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
import { Check, ChevronsUpDown, Building2 } from "lucide-react";

export function OrganizationSwitcher() {
  const { memberships, organizationId, switchOrganization, role } = useUserRole();

  if (role === 'owner' || memberships.length <= 1) return null;

  const active = memberships.find(m => m.organizationId === organizationId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 max-w-[240px]">
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
            onClick={() => switchOrganization(m.organizationId)}
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
  );
}

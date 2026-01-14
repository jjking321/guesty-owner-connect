import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Building2, Users, FolderOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";

interface Listing {
  id: string;
  nickname: string | null;
  address: any;
  thumbnail: string | null;
}

interface PropertyGroup {
  id: string;
  name: string;
  description: string | null;
}

interface Owner {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { role, ownerId } = useUserRole();

  // Keyboard shortcut to open search
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Fetch listings
  const { data: listings = [] } = useQuery({
    queryKey: ["search-listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("id, nickname, address, thumbnail")
        .eq("archived", false)
        .limit(500);
      
      if (error) throw error;
      return data as Listing[];
    },
    enabled: open,
  });

  // Fetch groups
  const { data: groups = [] } = useQuery({
    queryKey: ["search-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_groups")
        .select("id, name, description")
        .is("parent_group_id", null)
        .limit(200);
      
      if (error) throw error;
      return data as PropertyGroup[];
    },
    enabled: open,
  });

  // Fetch owners
  const { data: owners = [] } = useQuery({
    queryKey: ["search-owners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("id, full_name, first_name, last_name, email")
        .limit(500);
      
      if (error) throw error;
      return data as Owner[];
    },
    enabled: open && role !== "owner",
  });

  // Filter listings based on search
  const filteredListings = listings.filter((listing) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    const nickname = listing.nickname?.toLowerCase() || "";
    const city = listing.address?.city?.toLowerCase() || "";
    return nickname.includes(searchLower) || city.includes(searchLower);
  });

  // Filter groups based on search
  const filteredGroups = groups.filter((group) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    const name = group.name?.toLowerCase() || "";
    const description = group.description?.toLowerCase() || "";
    return name.includes(searchLower) || description.includes(searchLower);
  });

  // Filter owners based on search
  const filteredOwners = owners.filter((owner) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    const fullName = owner.full_name?.toLowerCase() || "";
    const firstName = owner.first_name?.toLowerCase() || "";
    const lastName = owner.last_name?.toLowerCase() || "";
    const email = owner.email?.toLowerCase() || "";
    return (
      fullName.includes(searchLower) ||
      firstName.includes(searchLower) ||
      lastName.includes(searchLower) ||
      email.includes(searchLower)
    );
  });

  const handleSelect = (type: "property" | "group" | "owner", id: string) => {
    setOpen(false);
    setSearch("");
    switch (type) {
      case "property":
        navigate(`/property/${id}`);
        break;
      case "group":
        navigate(`/groups/${id}`);
        break;
      case "owner":
        navigate(`/owners/${id}`);
        break;
    }
  };

  const getOwnerDisplayName = (owner: Owner) => {
    if (owner.full_name) return owner.full_name;
    if (owner.first_name || owner.last_name) {
      return `${owner.first_name || ""} ${owner.last_name || ""}`.trim();
    }
    return owner.email || "Unknown";
  };

  const getPropertyCity = (listing: Listing) => {
    return listing.address?.city || "";
  };

  // Don't show certain sections based on role
  const showOwners = role !== "owner";
  const showProperties = role !== "owner" || !ownerId;

  return (
    <>
      <Button
        variant="outline"
        className="relative h-9 w-full justify-start rounded-md bg-muted/50 text-sm text-muted-foreground sm:w-64 md:w-80"
        onClick={() => setOpen(true)}
      >
        <Search className="mr-2 h-4 w-4" />
        <span className="hidden sm:inline-flex">Search...</span>
        <span className="inline-flex sm:hidden">Search</span>
        <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-6 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search properties, groups, owners..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {showProperties && filteredListings.length > 0 && (
            <CommandGroup heading="Properties">
              {filteredListings.slice(0, 8).map((listing) => (
                <CommandItem
                  key={listing.id}
                  value={`property-${listing.id}-${listing.nickname}`}
                  onSelect={() => handleSelect("property", listing.id)}
                  className="flex items-center gap-3"
                >
                  {listing.thumbnail ? (
                    <img
                      src={listing.thumbnail}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {listing.nickname || "Unnamed Property"}
                    </span>
                    {getPropertyCity(listing) && (
                      <span className="text-xs text-muted-foreground">
                        {getPropertyCity(listing)}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {filteredGroups.length > 0 && (
            <CommandGroup heading="Groups">
              {filteredGroups.slice(0, 6).map((group) => (
                <CommandItem
                  key={group.id}
                  value={`group-${group.id}-${group.name}`}
                  onSelect={() => handleSelect("group", group.id)}
                  className="flex items-center gap-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium">{group.name}</span>
                    {group.description && (
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {group.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showOwners && filteredOwners.length > 0 && (
            <CommandGroup heading="Owners">
              {filteredOwners.slice(0, 6).map((owner) => (
                <CommandItem
                  key={owner.id}
                  value={`owner-${owner.id}-${getOwnerDisplayName(owner)}`}
                  onSelect={() => handleSelect("owner", owner.id)}
                  className="flex items-center gap-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {getOwnerDisplayName(owner)}
                    </span>
                    {owner.email && (
                      <span className="text-xs text-muted-foreground">
                        {owner.email}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}

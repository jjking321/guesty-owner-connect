import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, FolderOpen, Building2, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

export default function Groups() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [selectedListings, setSelectedListings] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: session } = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
  });

  const { data: groups, refetch: refetchGroups } = useQuery({
    queryKey: ["property-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_groups")
        .select(`
          *,
          property_group_members (
            listing_id,
            listings (
              id,
              nickname,
              thumbnail
            )
          )
        `)
        .is("parent_group_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  const { data: listings } = useQuery({
    queryKey: ["listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .order("nickname");

      if (error) throw error;
      return data;
    },
    enabled: !!session && isCreateOpen,
  });

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a group name",
        variant: "destructive",
      });
      return;
    }

    if (selectedListings.length === 0) {
      toast({
        title: "Select properties",
        description: "Please select at least one property",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Create group
      const { data: group, error: groupError } = await supabase
        .from("property_groups")
        .insert({
          user_id: session?.user?.id,
          name: groupName,
          description: groupDescription,
        })
        .select()
        .single();

      if (groupError) throw groupError;

      // Add members
      const members = selectedListings.map((listingId) => ({
        group_id: group.id,
        listing_id: listingId,
      }));

      const { error: membersError } = await supabase
        .from("property_group_members")
        .insert(members);

      if (membersError) throw membersError;

      toast({
        title: "Group created",
        description: `${groupName} has been created with ${selectedListings.length} properties`,
      });

      setIsCreateOpen(false);
      setGroupName("");
      setGroupDescription("");
      setSelectedListings([]);
      refetchGroups();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Property Groups</h1>
            <p className="text-muted-foreground mt-1">
              Organize properties by owner, building, or any other criteria
            </p>
          </div>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Group
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Property Group</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="name">Group Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Downtown Properties, Smith Portfolio"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="Add notes about this group"
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    rows={3}
                  />
                </div>

                <div>
                  <Label>Select Properties</Label>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search properties..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="border rounded-lg p-4 max-h-60 overflow-y-auto space-y-2">
                    {listings
                      ?.filter((listing) => {
                        const query = searchQuery.toLowerCase();
                        const nickname = (listing.nickname || "").toLowerCase();
                        return nickname.includes(query);
                      })
                      .map((listing) => (
                      <div key={listing.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={listing.id}
                          checked={selectedListings.includes(listing.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedListings([...selectedListings, listing.id]);
                            } else {
                              setSelectedListings(selectedListings.filter((id) => id !== listing.id));
                            }
                          }}
                        />
                        <label
                          htmlFor={listing.id}
                          className="flex items-center gap-2 cursor-pointer flex-1"
                        >
                          {listing.thumbnail && (
                            <img
                              src={listing.thumbnail}
                              alt={listing.nickname || "Property"}
                              className="w-10 h-10 rounded object-cover"
                            />
                          )}
                          <span className="text-sm">{listing.nickname || "Unnamed Property"}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {selectedListings.length} properties selected
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateGroup} disabled={isSubmitting}>
                    {isSubmitting ? "Creating..." : "Create Group"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {groups && groups.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No groups yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Create your first property group to organize your portfolio
              </p>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Group
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groups?.map((group) => (
              <Card
                key={group.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/groups/${group.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg">{group.name}</CardTitle>
                    </div>
                  </div>
                  {group.description && (
                    <CardDescription className="mt-2">{group.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {group.property_group_members.slice(0, 3).map((member: any) => (
                        <div
                          key={member.listing_id}
                          className="w-8 h-8 rounded-full border-2 border-background overflow-hidden bg-muted"
                        >
                          {member.listings?.thumbnail && (
                            <img
                              src={member.listings.thumbnail}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {group.property_group_members.length} properties
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

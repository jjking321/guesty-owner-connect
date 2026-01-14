import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface PropertyGroup {
  id: string;
  name: string;
  description: string | null;
}

interface AssignGroupToOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  existingGroupIds: string[];
  onSuccess: () => void;
}

export function AssignGroupToOwnerDialog({
  open,
  onOpenChange,
  ownerId,
  existingGroupIds,
  onSuccess,
}: AssignGroupToOwnerDialogProps) {
  const [groups, setGroups] = useState<PropertyGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);

  useEffect(() => {
    if (open) {
      loadGroups();
    }
  }, [open, existingGroupIds]);

  const loadGroups = async () => {
    setLoadingGroups(true);
    try {
      const { data, error } = await supabase
        .from("property_groups")
        .select("id, name, description")
        .is("parent_group_id", null)
        .order("name");

      if (error) throw error;

      // Filter out already assigned groups
      const availableGroups = (data || []).filter(
        (g) => !existingGroupIds.includes(g.id)
      );
      setGroups(availableGroups);
    } catch (error) {
      console.error("Error loading groups:", error);
      toast.error("Failed to load groups");
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedGroupId) {
      toast.error("Please select a group");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("owner_groups").insert({
        owner_id: ownerId,
        group_id: selectedGroupId,
      });

      if (error) throw error;

      toast.success("Group assigned successfully");
      setSelectedGroupId("");
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error assigning group:", error);
      toast.error("Failed to assign group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Group to Owner</DialogTitle>
          <DialogDescription>
            Select a property group to assign to this owner. The group will
            appear on their detail page.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
            <SelectTrigger>
              <SelectValue
                placeholder={
                  loadingGroups ? "Loading groups..." : "Select a group"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {groups.length === 0 && !loadingGroups ? (
                <SelectItem value="none" disabled>
                  No groups available
                </SelectItem>
              ) : (
                groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                    {group.description && (
                      <span className="text-muted-foreground ml-2">
                        - {group.description}
                      </span>
                    )}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={loading || !selectedGroupId || loadingGroups}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assign Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

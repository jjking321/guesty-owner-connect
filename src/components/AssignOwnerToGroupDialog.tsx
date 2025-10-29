import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Owner {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface AssignOwnerToGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  onSuccess: () => void;
}

export function AssignOwnerToGroupDialog({
  open,
  onOpenChange,
  groupId,
  onSuccess,
}: AssignOwnerToGroupDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>("");
  const [loadingOwners, setLoadingOwners] = useState(true);

  useEffect(() => {
    if (open) {
      loadOwners();
    }
  }, [open]);

  const loadOwners = async () => {
    try {
      setLoadingOwners(true);
      const { data, error } = await supabase
        .from('owners')
        .select('id, full_name, first_name, last_name, email')
        .order('full_name', { ascending: true, nullsFirst: false });

      if (error) throw error;
      setOwners(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading owners",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingOwners(false);
    }
  };

  const getOwnerName = (owner: Owner) => {
    if (owner.full_name) return owner.full_name;
    if (owner.first_name && owner.last_name) return `${owner.first_name} ${owner.last_name}`;
    if (owner.first_name) return owner.first_name;
    if (owner.last_name) return owner.last_name;
    return 'Unknown Owner';
  };

  const handleAssign = async () => {
    if (!selectedOwnerId) {
      toast({
        title: "No owner selected",
        description: "Please select an owner to assign",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // Check if already assigned
      const { data: existing } = await supabase
        .from('owner_groups')
        .select('id')
        .eq('owner_id', selectedOwnerId)
        .eq('group_id', groupId)
        .single();

      if (existing) {
        toast({
          title: "Already assigned",
          description: "This owner is already assigned to this group",
          variant: "destructive",
        });
        return;
      }

      // Assign owner to group
      const { error } = await supabase
        .from('owner_groups')
        .insert({
          owner_id: selectedOwnerId,
          group_id: groupId,
        });

      if (error) throw error;

      toast({
        title: "Owner assigned successfully",
        description: "The owner now has access to this group",
      });

      onSuccess();
      onOpenChange(false);
      setSelectedOwnerId("");
    } catch (error: any) {
      console.error('Error assigning owner:', error);
      toast({
        title: "Error assigning owner",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Owner to Group</DialogTitle>
          <DialogDescription>
            Give an owner access to view all properties in this group
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="owner">Owner</Label>
            {loadingOwners ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an owner" />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {getOwnerName(owner)}
                      {owner.email && ` (${owner.email})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={loading || loadingOwners}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assign Owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

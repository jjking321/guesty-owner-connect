import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Save } from "lucide-react";

interface SaveCompsetTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  airroiListingIds: string[];
  guestyAccountId: string;
  onSaved?: () => void;
}

export function SaveCompsetTemplateDialog({
  open,
  onOpenChange,
  airroiListingIds,
  guestyAccountId,
  onSaved,
}: SaveCompsetTemplateDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a name for the template.",
        variant: "destructive",
      });
      return;
    }

    if (airroiListingIds.length === 0) {
      toast({
        title: "No comparables selected",
        description: "Please select at least one comparable to save.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from('compset_templates')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          guesty_account_id: guestyAccountId,
          airroi_listing_ids: airroiListingIds,
          created_by: user.id,
        });

      if (error) throw error;

      toast({
        title: "Template saved",
        description: `"${name}" saved with ${airroiListingIds.length} comparable(s).`,
      });

      setName("");
      setDescription("");
      onOpenChange(false);
      onSaved?.();
    } catch (error: any) {
      console.error("Error saving template:", error);
      toast({
        title: "Error saving template",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Save Compset Template
          </DialogTitle>
          <DialogDescription>
            Save your current selection of {airroiListingIds.length} comparable(s) as a template to apply to other properties.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="template-name">Template Name *</Label>
            <Input
              id="template-name"
              placeholder="e.g., Downtown 2BR Luxury Comps"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="template-description">Description (optional)</Label>
            <Textarea
              id="template-description"
              placeholder="e.g., High-end 2BR rentals within 1 mile of downtown..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

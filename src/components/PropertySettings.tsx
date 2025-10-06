import { useState, useEffect } from "react";
import { Settings, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GoalsInput } from "@/components/GoalsInput";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

interface PropertySettingsProps {
  listingId: string;
}

export function PropertySettings({ listingId }: PropertySettingsProps) {
  const [open, setOpen] = useState(false);
  const [archived, setArchived] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadArchiveStatus();
  }, [listingId]);

  const loadArchiveStatus = async () => {
    const { data, error } = await supabase
      .from("listings")
      .select("archived")
      .eq("id", listingId)
      .single();

    if (!error && data) {
      setArchived(data.archived || false);
    }
  };

  const handleArchiveToggle = async () => {
    setIsArchiving(true);
    try {
      const { error } = await supabase
        .from("listings")
        .update({ archived: !archived })
        .eq("id", listingId);

      if (error) throw error;

      setArchived(!archived);
      toast({
        title: archived ? "Property restored" : "Property archived",
        description: archived
          ? "This property will now appear in all metrics and reports."
          : "This property has been archived and will be excluded from all metrics.",
      });
      
      setShowArchiveDialog(false);
      setOpen(false);
      
      // Reload page to update metrics
      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="icon">
            <Settings className="h-5 w-5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Property Settings</DialogTitle>
            <DialogDescription>
              Manage revenue goals and other property-specific settings
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Revenue Goals</h3>
              <GoalsInput listingId={listingId} />
            </div>

            <Separator />

            <div>
              <h3 className="text-lg font-semibold mb-2">Archive Property</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {archived
                  ? "This property is currently archived and excluded from all metrics and reports."
                  : "Archive this property to exclude it from all metrics and reports."}
              </p>
              <Button
                variant={archived ? "default" : "destructive"}
                onClick={() => setShowArchiveDialog(true)}
              >
                {archived ? (
                  <>
                    <ArchiveRestore className="mr-2 h-4 w-4" />
                    Restore Property
                  </>
                ) : (
                  <>
                    <Archive className="mr-2 h-4 w-4" />
                    Archive Property
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archived ? "Restore Property?" : "Archive Property?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? "This will restore the property and include it in all metrics and reports."
                : "This will hide the property from all metrics and reports. The property and its data will not be deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchiveToggle}
              disabled={isArchiving}
            >
              {isArchiving ? "Processing..." : archived ? "Restore" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

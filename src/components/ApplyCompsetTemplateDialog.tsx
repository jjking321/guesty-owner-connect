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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FolderInput, Trash2, Calendar } from "lucide-react";
import { format } from "date-fns";
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

interface Template {
  id: string;
  name: string;
  description: string | null;
  airroi_listing_ids: string[];
  created_at: string;
}

interface ApplyCompsetTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingId: string;
  guestyAccountId: string;
  onApplied?: () => void;
}

export function ApplyCompsetTemplateDialog({
  open,
  onOpenChange,
  listingId,
  guestyAccountId,
  onApplied,
}: ApplyCompsetTemplateDialogProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      loadTemplates();
    }
  }, [open, guestyAccountId]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('compset_templates')
        .select('*')
        .eq('guesty_account_id', guestyAccountId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      console.error("Error loading templates:", error);
      toast({
        title: "Error loading templates",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (template: Template) => {
    setApplying(template.id);
    try {
      const { data, error } = await supabase.functions.invoke('apply-compset-template', {
        body: {
          template_id: template.id,
          listing_id: listingId,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Template applied",
          description: `Added ${data.applied} comparable(s) from "${template.name}".`,
        });
        onOpenChange(false);
        onApplied?.();
      } else {
        throw new Error(data.error || 'Failed to apply template');
      }
    } catch (error: any) {
      console.error("Error applying template:", error);
      toast({
        title: "Error applying template",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setApplying(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('compset_templates')
        .delete()
        .eq('id', deleteConfirmId);

      if (error) throw error;

      toast({
        title: "Template deleted",
        description: "The template has been removed.",
      });

      setTemplates(prev => prev.filter(t => t.id !== deleteConfirmId));
      setDeleteConfirmId(null);
    } catch (error: any) {
      console.error("Error deleting template:", error);
      toast({
        title: "Error deleting template",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderInput className="h-5 w-5" />
              Apply Compset Template
            </DialogTitle>
            <DialogDescription>
              Select a saved template to apply its comparables to this property.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FolderInput className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No templates saved yet.</p>
                <p className="text-sm mt-2">
                  Save your selected comparables as a template first.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{template.name}</h4>
                        {template.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {template.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>{template.airroi_listing_ids.length} comparable(s)</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(template.created_at), 'MMM d, yyyy')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          onClick={() => handleApply(template)}
                          disabled={applying !== null}
                        >
                          {applying === template.id ? "Applying..." : "Apply"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteConfirmId(template.id)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the template. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

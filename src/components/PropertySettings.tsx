import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GoalsInput } from "@/components/GoalsInput";

interface PropertySettingsProps {
  listingId: string;
}

export function PropertySettings({ listingId }: PropertySettingsProps) {
  const [open, setOpen] = useState(false);

  return (
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
        <div className="mt-4">
          <GoalsInput listingId={listingId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

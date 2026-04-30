import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Settings2, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface ChurnEvent {
  id: string;
  listing_id: string;
  churned_at: string;
  restored_at: string | null;
  reason: string | null;
  category: string | null;
  notes: string | null;
}

interface ListingMini { id: string; nickname: string | null }

export function ManageChurnDrawer() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ChurnEvent[]>([]);
  const [listings, setListings] = useState<Record<string, ListingMini>>({});
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<ChurnEvent>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data: ev } = await supabase
        .from('listing_churn_events')
        .select('id, listing_id, churned_at, restored_at, reason, category, notes')
        .order('churned_at', { ascending: false })
        .limit(500);
      const evs = (ev ?? []) as ChurnEvent[];
      setEvents(evs);
      const ids = Array.from(new Set(evs.map((e) => e.listing_id)));
      if (ids.length > 0) {
        const { data: ls } = await supabase
          .from('listings')
          .select('id, nickname')
          .in('id', ids);
        const map: Record<string, ListingMini> = {};
        for (const l of (ls ?? []) as any[]) map[l.id] = l;
        setListings(map);
      }
      setLoading(false);
    })();
  }, [open]);

  const updateField = (id: string, field: keyof ChurnEvent, value: string) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const save = async (id: string) => {
    const patch = edits[id];
    if (!patch) return;
    setSaving(id);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('listing_churn_events')
      .update({ ...patch, updated_by: user?.id })
      .eq('id', id);
    setSaving(null);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } as ChurnEvent : e)));
    setEdits((prev) => { const { [id]: _, ...rest } = prev; return rest; });
    toast({ title: 'Saved' });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-2" />
          Manage churned units
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Churned units</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No churned units yet.</p>
          ) : (
            events.map((e) => {
              const merged = { ...e, ...edits[e.id] } as ChurnEvent;
              const dirty = !!edits[e.id];
              return (
                <div key={e.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{listings[e.listing_id]?.nickname || e.listing_id}</p>
                      <p className="text-xs text-muted-foreground">
                        Churned {format(new Date(e.churned_at), 'MMM d, yyyy')}
                        {e.restored_at && ` · Restored ${format(new Date(e.restored_at), 'MMM d, yyyy')}`}
                      </p>
                    </div>
                    {dirty && (
                      <Button size="sm" onClick={() => save(e.id)} disabled={saving === e.id}>
                        <Save className="h-3 w-3 mr-1" />{saving === e.id ? 'Saving…' : 'Save'}
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Category</Label>
                      <Input
                        value={merged.category ?? ''}
                        placeholder="e.g. Sold, Owner left, Off-market"
                        onChange={(ev) => updateField(e.id, 'category', ev.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Reason</Label>
                      <Input
                        value={merged.reason ?? ''}
                        placeholder="Short reason"
                        onChange={(ev) => updateField(e.id, 'reason', ev.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      rows={2}
                      value={merged.notes ?? ''}
                      onChange={(ev) => updateField(e.id, 'notes', ev.target.value)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

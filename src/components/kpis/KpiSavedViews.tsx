import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Bookmark, Trash2, Check, Star } from 'lucide-react';
import { toast } from 'sonner';
import type { Aggregation, ComparePreset, KpiRange } from '@/lib/kpis/types';
import type { ReviewScoreMode } from '@/lib/kpis/dataFetcher';

export interface KpiViewConfig {
  aggregation: Aggregation;
  range: KpiRange;
  compare: ComparePreset;
  reviewMode: ReviewScoreMode;
}

interface SavedView {
  id: string;
  name: string;
  config: KpiViewConfig;
  is_default: boolean;
}

interface Props {
  current: KpiViewConfig;
  onApply: (config: KpiViewConfig) => void;
  onDefaultLoaded?: (config: KpiViewConfig) => void;
}

export function KpiSavedViews({ current, onApply, onDefaultLoaded }: Props) {
  const qc = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [defaultApplied, setDefaultApplied] = useState(false);

  const { data: views = [] } = useQuery({
    queryKey: ['kpi-saved-views'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kpi_saved_views')
        .select('id, name, config, is_default')
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as SavedView[];
    },
  });

  // Apply default view once on first load.
  if (!defaultApplied && views.length > 0 && onDefaultLoaded) {
    const def = views.find((v) => v.is_default);
    if (def) onDefaultLoaded(def.config);
    setDefaultApplied(true);
  } else if (!defaultApplied && views.length === 0) {
    setDefaultApplied(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name is required');
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not signed in');

      // If marking as default, clear any existing default first.
      if (makeDefault) {
        await supabase
          .from('kpi_saved_views')
          .update({ is_default: false })
          .eq('user_id', userData.user.id);
      }

      const { error } = await supabase.from('kpi_saved_views').upsert(
        {
          user_id: userData.user.id,
          name: trimmed,
          config: current as unknown as Record<string, unknown>,
          is_default: makeDefault,
        },
        { onConflict: 'user_id,name' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Saved view "${name.trim()}"`);
      setSaveOpen(false);
      setName('');
      setMakeDefault(false);
      qc.invalidateQueries({ queryKey: ['kpi-saved-views'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('kpi_saved_views').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('View deleted');
      qc.invalidateQueries({ queryKey: ['kpi-saved-views'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Not signed in');
      await supabase
        .from('kpi_saved_views')
        .update({ is_default: false })
        .eq('user_id', userData.user.id);
      const { error } = await supabase
        .from('kpi_saved_views')
        .update({ is_default: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Default view updated');
      qc.invalidateQueries({ queryKey: ['kpi-saved-views'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Bookmark className="h-4 w-4" />
            Saved views
            {views.length > 0 && (
              <span className="text-xs text-muted-foreground">({views.length})</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Your views</DropdownMenuLabel>
          {views.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No saved views yet. Save the current filters to recall them quickly.
            </div>
          )}
          {views.map((v) => (
            <DropdownMenuItem
              key={v.id}
              className="flex items-center justify-between gap-2"
              onSelect={(e) => {
                e.preventDefault();
                onApply(v.config);
                toast.success(`Applied "${v.name}"`);
              }}
            >
              <span className="flex items-center gap-2 min-w-0 truncate">
                {v.is_default ? (
                  <Star className="h-3 w-3 fill-current text-amber-500 shrink-0" />
                ) : (
                  <Check className="h-3 w-3 opacity-0 shrink-0" />
                )}
                <span className="truncate">{v.name}</span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                {!v.is_default && (
                  <button
                    type="button"
                    className="p-1 hover:bg-accent rounded"
                    title="Set as default"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDefaultMutation.mutate(v.id);
                    }}
                  >
                    <Star className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  className="p-1 hover:bg-destructive/10 hover:text-destructive rounded"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete saved view "${v.name}"?`)) {
                      deleteMutation.mutate(v.id);
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setSaveOpen(true);
            }}
          >
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="view-name">Name</Label>
              <Input
                id="view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. YTD vs last year"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Saving an existing name will overwrite it.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="view-default"
                checked={makeDefault}
                onCheckedChange={(v) => setMakeDefault(v === true)}
              />
              <Label htmlFor="view-default" className="cursor-pointer text-sm font-normal">
                Set as my default view (auto-loads on page open)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

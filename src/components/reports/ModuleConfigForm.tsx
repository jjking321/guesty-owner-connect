import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import {
  type ReportModule,
  type WidgetType,
  type MetricKey,
  type ScopeKind,
  type BreakdownKey,
  type CompareKey,
  METRIC_LABELS,
  WIDGET_LABELS,
  COMPARE_LABELS,
} from '@/lib/reports/types';

interface Props {
  module: ReportModule;
  onChange: (m: ReportModule) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

interface ListingMultiSelectProps {
  listings: Array<{ id: string; nickname: string | null }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function ListingMultiSelect({ listings, selectedIds, onChange }: ListingMultiSelectProps) {
  const [search, setSearch] = useState('');
  const selectedSet = new Set(selectedIds);
  const filtered = listings.filter((l) =>
    (l.nickname || l.id).toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(Array.from(next));
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selectedSet.has(l.id));
  const toggleAllFiltered = () => {
    const next = new Set(selectedIds);
    if (allFilteredSelected) {
      filtered.forEach((l) => next.delete(l.id));
    } else {
      filtered.forEach((l) => next.add(l.id));
    }
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label>Listings ({selectedIds.length} selected)</Label>
        {selectedIds.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange([])}
          >
            Clear
          </Button>
        )}
      </div>
      <Input
        placeholder="Search listings..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8"
      />
      <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">No listings match.</p>
        ) : (
          <>
            {filtered.length > 1 && (
              <label className="flex items-center gap-2 text-xs cursor-pointer text-muted-foreground border-b pb-1 mb-1">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={() => toggleAllFiltered()}
                />
                <span>{allFilteredSelected ? 'Deselect' : 'Select'} all {search ? 'matching' : ''} ({filtered.length})</span>
              </label>
            )}
            {filtered.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={selectedSet.has(l.id)}
                  onCheckedChange={(v) => toggle(l.id, !!v)}
                />
                <span className="truncate">{l.nickname || l.id}</span>
              </label>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface GenericMultiSelectProps {
  label: string;
  options: Array<{ id: string; label: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function GenericMultiSelect({ label, options, selectedIds, onChange }: GenericMultiSelectProps) {
  const [search, setSearch] = useState('');
  const selectedSet = new Set(selectedIds);
  const filtered = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()));

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(Array.from(next));
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedSet.has(o.id));
  const toggleAllFiltered = () => {
    const next = new Set(selectedIds);
    if (allFilteredSelected) filtered.forEach((o) => next.delete(o.id));
    else filtered.forEach((o) => next.add(o.id));
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label>{label} ({selectedIds.length} selected)</Label>
        {selectedIds.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </div>
      <Input
        placeholder={`Search ${label.toLowerCase()}...`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8"
      />
      <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 text-center">No {label.toLowerCase()} match.</p>
        ) : (
          <>
            {filtered.length > 1 && (
              <label className="flex items-center gap-2 text-xs cursor-pointer text-muted-foreground border-b pb-1 mb-1">
                <Checkbox checked={allFilteredSelected} onCheckedChange={() => toggleAllFiltered()} />
                <span>{allFilteredSelected ? 'Deselect' : 'Select'} all {search ? 'matching' : ''} ({filtered.length})</span>
              </label>
            )}
            {filtered.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={selectedSet.has(o.id)} onCheckedChange={(v) => toggle(o.id, !!v)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function ModuleConfigForm({ module, onChange, onRemove, onMoveUp, onMoveDown }: Props) {
  const update = (patch: Partial<ReportModule>) => onChange({ ...module, ...patch });

  const { data: listings = [] } = useQuery({
    queryKey: ['report-builder-listings'],
    queryFn: async () => {
      const { data } = await supabase
        .from('listings')
        .select('id, nickname')
        .eq('archived', false)
        .order('nickname');
      return (data ?? []) as Array<{ id: string; nickname: string | null }>;
    },
  });

  const { data: owners = [] } = useQuery({
    queryKey: ['report-builder-owners'],
    queryFn: async () => {
      const { data } = await supabase.from('owners').select('id, full_name').order('full_name');
      return (data ?? []) as Array<{ id: string; full_name: string | null }>;
    },
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['report-builder-groups'],
    queryFn: async () => {
      const { data } = await supabase.from('property_groups').select('id, name').order('name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const dateRangePreset =
    'preset' in module.dateRange ? module.dateRange.preset : 'custom';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">{module.title || 'Untitled module'}</CardTitle>
        <div className="flex items-center gap-1">
          {onMoveUp && (
            <Button variant="ghost" size="icon" onClick={onMoveUp} aria-label="Move up">
              <ChevronUp className="h-4 w-4" />
            </Button>
          )}
          {onMoveDown && (
            <Button variant="ghost" size="icon" onClick={onMoveDown} aria-label="Move down">
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove module">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={module.title} onChange={(e) => update({ title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Widget type</Label>
            <Select value={module.type} onValueChange={(v) => update({ type: v as WidgetType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(WIDGET_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Metric</Label>
            <Select
              value={module.metric}
              onValueChange={(v) => {
                const newMetric = v as MetricKey;
                const patch: Partial<ReportModule> = { metric: newMetric };
                // When switching to forecast, default compare to actual revenue
                // (unless the user already picked a forecast-relevant comparison).
                if (
                  newMetric === 'forecast_p50' &&
                  module.compare !== 'actual_revenue' &&
                  module.compare !== 'goal'
                ) {
                  patch.compare = 'actual_revenue';
                }
                // When switching away from forecast, clear actual_revenue
                if (newMetric !== 'forecast_p50' && module.compare === 'actual_revenue') {
                  patch.compare = null;
                }
                update(patch);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(METRIC_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Scope</Label>
            <Select
              value={module.scope.kind}
              onValueChange={(v) => update({ scope: { kind: v as ScopeKind, ids: [] } })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All listings</SelectItem>
                <SelectItem value="listings">Specific listings</SelectItem>
                <SelectItem value="group">Group</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {module.scope.kind === 'listings' && (
          <ListingMultiSelect
            listings={listings}
            selectedIds={module.scope.ids ?? []}
            onChange={(ids) => update({ scope: { kind: 'listings', ids } })}
          />
        )}

        {module.scope.kind === 'group' && (
          <GenericMultiSelect
            label="Groups"
            options={groups.map((g) => ({ id: g.id, label: g.name }))}
            selectedIds={module.scope.ids ?? []}
            onChange={(ids) => update({ scope: { kind: 'group', ids } })}
          />
        )}

        {module.scope.kind === 'owner' && (
          <GenericMultiSelect
            label="Owners"
            options={owners.map((o) => ({ id: o.id, label: o.full_name || o.id }))}
            selectedIds={module.scope.ids ?? []}
            onChange={(ids) => update({ scope: { kind: 'owner', ids } })}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Date range</Label>
            <Select
              value={dateRangePreset}
              onValueChange={(v) => {
                if (v === 'custom') {
                  const today = new Date().toISOString().slice(0, 10);
                  update({ dateRange: { preset: 'custom', start: today, end: today } });
                } else {
                  update({ dateRange: { preset: v as any } });
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">This month</SelectItem>
                <SelectItem value="ytd">Year to date</SelectItem>
                <SelectItem value="ttm">Trailing 12 months</SelectItem>
                <SelectItem value="last_year">Last year</SelectItem>
                <SelectItem value="rest_of_year">Rest of this year</SelectItem>
                <SelectItem value="next_month">Next month</SelectItem>
                <SelectItem value="next_30_days">Next 30 days</SelectItem>
                <SelectItem value="next_90_days">Next 90 days</SelectItem>
                <SelectItem value="next_6_months">Next 6 months</SelectItem>
                <SelectItem value="next_12_months">Next 12 months</SelectItem>
                <SelectItem value="next_year">Next year</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {module.type !== 'kpi' && (
            <div className="space-y-1">
              <Label>{module.type === 'table' ? 'Rows (breakdown)' : 'Breakdown'}</Label>
              <Select
                value={module.breakdown ?? 'month'}
                onValueChange={(v) => update({ breakdown: v as BreakdownKey })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">By month</SelectItem>
                  <SelectItem value="listing">By listing</SelectItem>
                  <SelectItem value="owner">By owner</SelectItem>
                  <SelectItem value="group">By group</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {module.type === 'table' && (
          <div className="space-y-1">
            <Label>Columns (then by) — optional pivot</Label>
            <Select
              value={module.breakdown2 ?? 'none'}
              onValueChange={(v) =>
                update({ breakdown2: v === 'none' ? undefined : (v as BreakdownKey) })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="month" disabled={(module.breakdown ?? 'month') === 'month'}>By month</SelectItem>
                <SelectItem value="listing" disabled={module.breakdown === 'listing'}>By listing</SelectItem>
                <SelectItem value="owner" disabled={module.breakdown === 'owner'}>By owner</SelectItem>
                <SelectItem value="group" disabled={module.breakdown === 'group'}>By group</SelectItem>
              </SelectContent>
            </Select>
            {module.breakdown2 && (
              <p className="text-xs text-muted-foreground">
                Renders as a pivot table. Comparison values appear stacked under each cell.
              </p>
            )}
          </div>
        )}


        {dateRangePreset === 'custom' && 'start' in module.dateRange && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start date</Label>
              <Input
                type="date"
                value={module.dateRange.start}
                onChange={(e) =>
                  update({ dateRange: { ...module.dateRange as any, start: e.target.value } })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>End date</Label>
              <Input
                type="date"
                value={module.dateRange.end}
                onChange={(e) =>
                  update({ dateRange: { ...module.dateRange as any, end: e.target.value } })
                }
              />
            </div>
          </div>
        )}

        {!(module.type === 'table' && module.breakdown2) && (
          <div className="space-y-1">
            <Label>Compare to</Label>
            <Select
              value={module.compare ?? 'none'}
              onValueChange={(v) =>
                update({ compare: v === 'none' ? null : (v as CompareKey) })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="actual_revenue">{COMPARE_LABELS.actual_revenue} (forecast only)</SelectItem>
                <SelectItem value="compset">{COMPARE_LABELS.compset}</SelectItem>
                <SelectItem value="last_year">{COMPARE_LABELS.last_year}</SelectItem>
                <SelectItem value="two_years_ago">{COMPARE_LABELS.two_years_ago}</SelectItem>
                <SelectItem value="previous_period">{COMPARE_LABELS.previous_period}</SelectItem>
                <SelectItem value="last_30_days">{COMPARE_LABELS.last_30_days}</SelectItem>
                <SelectItem value="last_90_days">{COMPARE_LABELS.last_90_days}</SelectItem>
                <SelectItem value="last_month">{COMPARE_LABELS.last_month}</SelectItem>
                <SelectItem value="goal">{COMPARE_LABELS.goal} (revenue only)</SelectItem>
              </SelectContent>
            </Select>
            {module.compare === 'goal' && module.metric !== 'revenue' && (
              <p className="text-xs text-muted-foreground">
                Goal comparison only applies to the Revenue metric.
              </p>
            )}
            {module.compare === 'actual_revenue' && module.metric !== 'forecast_p50' && (
              <p className="text-xs text-muted-foreground">
                Actual Revenue comparison only applies to the Forecast metric.
              </p>
            )}
          </div>
        )}

      </CardContent>
    </Card>
  );
}

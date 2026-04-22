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
            <Select value={module.metric} onValueChange={(v) => update({ metric: v as MetricKey })}>
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
          <div className="space-y-1">
            <Label>Listings ({module.scope.ids?.length ?? 0} selected)</Label>
            <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
              {listings.map((l) => {
                const checked = module.scope.ids?.includes(l.id) ?? false;
                return (
                  <label key={l.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        const ids = new Set(module.scope.ids ?? []);
                        if (v) ids.add(l.id);
                        else ids.delete(l.id);
                        update({ scope: { kind: 'listings', ids: Array.from(ids) } });
                      }}
                    />
                    <span className="truncate">{l.nickname || l.id}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {module.scope.kind === 'group' && (
          <div className="space-y-1">
            <Label>Group</Label>
            <Select
              value={module.scope.ids?.[0] ?? ''}
              onValueChange={(v) => update({ scope: { kind: 'group', ids: [v] } })}
            >
              <SelectTrigger><SelectValue placeholder="Select a group" /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {module.scope.kind === 'owner' && (
          <div className="space-y-1">
            <Label>Owner</Label>
            <Select
              value={module.scope.ids?.[0] ?? ''}
              onValueChange={(v) => update({ scope: { kind: 'owner', ids: [v] } })}
            >
              <SelectTrigger><SelectValue placeholder="Select an owner" /></SelectTrigger>
              <SelectContent>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.full_name || o.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {module.type !== 'kpi' && (
            <div className="space-y-1">
              <Label>Breakdown</Label>
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
        </div>
      </CardContent>
    </Card>
  );
}

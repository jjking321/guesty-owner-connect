import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { Aggregation, ComparePreset, KpiRange, RangePreset } from '@/lib/kpis/types';
import { AGGREGATION_LABELS, COMPARE_LABELS, RANGE_LABELS } from '@/lib/kpis/types';

interface Props {
  aggregation: Aggregation;
  range: KpiRange;
  compare: ComparePreset;
  onAggregationChange: (a: Aggregation) => void;
  onRangeChange: (r: KpiRange) => void;
  onCompareChange: (c: ComparePreset) => void;
}

export function KpiControls({
  aggregation, range, compare,
  onAggregationChange, onRangeChange, onCompareChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-4 items-end">
      <div className="space-y-1.5">
        <Label className="text-xs">Aggregation</Label>
        <Select value={aggregation} onValueChange={(v) => onAggregationChange(v as Aggregation)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(AGGREGATION_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Date range</Label>
        <Select
          value={range.preset}
          onValueChange={(v) => onRangeChange({ preset: v as RangePreset })}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(RANGE_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {range.preset === 'custom' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              className="w-40"
              value={range.start ?? ''}
              onChange={(e) => onRangeChange({ ...range, start: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              className="w-40"
              value={range.end ?? ''}
              onChange={(e) => onRangeChange({ ...range, end: e.target.value })}
            />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Compare to</Label>
        <Select value={compare} onValueChange={(v) => onCompareChange(v as ComparePreset)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(COMPARE_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

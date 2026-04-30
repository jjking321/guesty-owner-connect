import {
  startOfMonth, endOfMonth, startOfYear, endOfYear,
  startOfDay, endOfDay, subDays, subMonths, subYears,
  differenceInCalendarDays, format,
} from 'date-fns';
import type { KpiRange, ResolvedRange, ComparePreset, RangePreset } from './types';
import { COMPARE_LABELS, RANGE_LABELS } from './types';

export function resolveRange(r: KpiRange, now: Date = new Date()): ResolvedRange {
  if (r.preset === 'custom' && r.start && r.end) {
    const start = startOfDay(new Date(r.start));
    const end = endOfDay(new Date(r.end));
    return { start, end, label: `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}` };
  }
  switch (r.preset) {
    case 'this_month':
      return { start: startOfMonth(now), end: endOfMonth(now), label: format(now, 'MMMM yyyy') };
    case 'ytd':
      return { start: startOfYear(now), end: endOfDay(now), label: `YTD ${format(now, 'yyyy')}` };
    case 'ttm':
      return { start: startOfDay(subDays(now, 365)), end: endOfDay(now), label: 'Trailing 12 months' };
    case 'last_30_days':
      return { start: startOfDay(subDays(now, 30)), end: endOfDay(now), label: 'Last 30 days' };
    case 'last_90_days':
      return { start: startOfDay(subDays(now, 90)), end: endOfDay(now), label: 'Last 90 days' };
    case 'last_365_days':
      return { start: startOfDay(subDays(now, 365)), end: endOfDay(now), label: 'Last 365 days' };
    case 'last_year': {
      const ly = subYears(now, 1);
      return { start: startOfYear(ly), end: endOfYear(ly), label: `${format(ly, 'yyyy')}` };
    }
    default:
      return { start: startOfMonth(now), end: endOfMonth(now), label: format(now, 'MMMM yyyy') };
  }
}

export function resolveCompare(primary: ResolvedRange, c: ComparePreset, now: Date = new Date()): ResolvedRange | null {
  if (c === 'none') return null;
  switch (c) {
    case 'last_year': {
      const start = new Date(primary.start); start.setFullYear(start.getFullYear() - 1);
      const end = new Date(primary.end); end.setFullYear(end.getFullYear() - 1);
      return { start, end, label: 'Last year' };
    }
    case 'two_years_ago': {
      const start = new Date(primary.start); start.setFullYear(start.getFullYear() - 2);
      const end = new Date(primary.end); end.setFullYear(end.getFullYear() - 2);
      return { start, end, label: '2 years ago' };
    }
    case 'previous_period': {
      const len = differenceInCalendarDays(primary.end, primary.start) + 1;
      const end = subDays(primary.start, 1);
      const start = subDays(end, len - 1);
      return { start, end: endOfDay(end), label: COMPARE_LABELS.previous_period };
    }
    case 'last_30_days': {
      const end = subDays(now, 1);
      return { start: subDays(end, 29), end: endOfDay(end), label: COMPARE_LABELS.last_30_days };
    }
    case 'last_90_days': {
      const end = subDays(now, 1);
      return { start: subDays(end, 89), end: endOfDay(end), label: COMPARE_LABELS.last_90_days };
    }
    case 'last_month': {
      const lm = subMonths(now, 1);
      return { start: startOfMonth(lm), end: endOfMonth(lm), label: format(lm, 'MMMM yyyy') };
    }
    default:
      return null;
  }
}

export function rangeISO(r: ResolvedRange) {
  return { start: format(r.start, 'yyyy-MM-dd'), end: format(r.end, 'yyyy-MM-dd') };
}

export { RANGE_LABELS, COMPARE_LABELS };
export type { RangePreset };

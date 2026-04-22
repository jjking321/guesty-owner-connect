import {
  startOfMonth,
  endOfMonth,
  startOfYear,
  subYears,
  endOfDay,
  subDays,
  subMonths,
  differenceInCalendarDays,
  format,
} from 'date-fns';
import type { DateRangeConfig, ResolvedDateRange, CompareKey } from './types';
import { COMPARE_LABELS } from './types';

export function resolveDateRange(cfg: DateRangeConfig, now: Date = new Date()): ResolvedDateRange {
  if (cfg.preset === 'custom') {
    const start = new Date(cfg.start);
    const end = new Date(cfg.end);
    return {
      start,
      end,
      label: `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`,
    };
  }

  switch (cfg.preset) {
    case 'this_month': {
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      return { start, end, label: format(now, 'MMMM yyyy') };
    }
    case 'ytd': {
      const start = startOfYear(now);
      return { start, end: endOfDay(now), label: `YTD ${format(now, 'yyyy')}` };
    }
    case 'ttm': {
      const start = subDays(now, 365);
      return { start, end: endOfDay(now), label: 'Trailing 12 months' };
    }
    case 'last_year': {
      const lastYear = subYears(now, 1);
      const start = startOfYear(lastYear);
      const end = new Date(lastYear.getFullYear(), 11, 31, 23, 59, 59);
      return { start, end, label: `Last year (${lastYear.getFullYear()})` };
    }
    default: {
      const start = startOfMonth(now);
      return { start, end: endOfMonth(now), label: format(now, 'MMMM yyyy') };
    }
  }
}

export function rangeToISO(range: ResolvedDateRange): { start: string; end: string } {
  return {
    start: format(range.start, 'yyyy-MM-dd'),
    end: format(range.end, 'yyyy-MM-dd'),
  };
}

export function shiftRangeByYear(range: ResolvedDateRange, years: number): ResolvedDateRange {
  const start = new Date(range.start);
  start.setFullYear(start.getFullYear() + years);
  const end = new Date(range.end);
  end.setFullYear(end.getFullYear() + years);
  return { start, end, label: `${range.label} (shifted ${years}y)` };
}

/**
 * Resolve the comparison range for a given primary range and compare key.
 * Returns null when the compare key has no date-range semantics (e.g. 'goal').
 */
export function resolveCompareRange(
  primary: ResolvedDateRange,
  compare: CompareKey,
  now: Date = new Date(),
): ResolvedDateRange | null {
  if (!compare || compare === 'goal') return null;

  switch (compare) {
    case 'last_year':
      return shiftRangeByYear(primary, -1);
    case 'two_years_ago':
      return shiftRangeByYear(primary, -2);
    case 'previous_period': {
      const lengthDays = differenceInCalendarDays(primary.end, primary.start) + 1;
      const end = subDays(primary.start, 1);
      const start = subDays(end, lengthDays - 1);
      return { start, end: endOfDay(end), label: COMPARE_LABELS.previous_period };
    }
    case 'last_30_days': {
      const end = subDays(now, 1);
      const start = subDays(end, 29);
      return { start, end: endOfDay(end), label: COMPARE_LABELS.last_30_days };
    }
    case 'last_90_days': {
      const end = subDays(now, 1);
      const start = subDays(end, 89);
      return { start, end: endOfDay(end), label: COMPARE_LABELS.last_90_days };
    }
    case 'last_month': {
      const lastMonth = subMonths(now, 1);
      return {
        start: startOfMonth(lastMonth),
        end: endOfMonth(lastMonth),
        label: format(lastMonth, 'MMMM yyyy'),
      };
    }
    default:
      return null;
  }
}

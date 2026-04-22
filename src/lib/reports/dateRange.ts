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

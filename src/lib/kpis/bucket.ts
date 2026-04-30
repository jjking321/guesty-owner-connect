import {
  startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear,
  endOfDay, endOfWeek, endOfMonth, endOfQuarter, endOfYear,
  eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, eachQuarterOfInterval, eachYearOfInterval,
  format,
} from 'date-fns';
import type { Aggregation } from './types';

export interface Bucket {
  start: Date;
  end: Date;
  label: string;
  key: string;
}

export function buildBuckets(start: Date, end: Date, agg: Aggregation): Bucket[] {
  switch (agg) {
    case 'daily':
      return eachDayOfInterval({ start: startOfDay(start), end: endOfDay(end) }).map((d) => ({
        start: startOfDay(d), end: endOfDay(d),
        label: format(d, 'MMM d'),
        key: format(d, 'yyyy-MM-dd'),
      }));
    case 'weekly':
      return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((d) => ({
        start: startOfWeek(d, { weekStartsOn: 1 }),
        end: endOfWeek(d, { weekStartsOn: 1 }),
        label: format(d, "MMM d ''yy"),
        key: format(d, 'yyyy-MM-dd'),
      }));
    case 'monthly':
      return eachMonthOfInterval({ start, end }).map((d) => ({
        start: startOfMonth(d), end: endOfMonth(d),
        label: format(d, 'MMM yyyy'),
        key: format(d, 'yyyy-MM'),
      }));
    case 'quarterly':
      return eachQuarterOfInterval({ start, end }).map((d) => ({
        start: startOfQuarter(d), end: endOfQuarter(d),
        label: `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`,
        key: `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`,
      }));
    case 'yearly':
      return eachYearOfInterval({ start, end }).map((d) => ({
        start: startOfYear(d), end: endOfYear(d),
        label: format(d, 'yyyy'),
        key: format(d, 'yyyy'),
      }));
  }
}

export function findBucketIdx(buckets: Bucket[], date: Date): number {
  // binary search would be nicer but linear is fine for typical KPI window sizes
  for (let i = 0; i < buckets.length; i++) {
    if (date >= buckets[i].start && date <= buckets[i].end) return i;
  }
  return -1;
}

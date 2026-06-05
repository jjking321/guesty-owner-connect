// KPI Dashboard — shared types

export type Aggregation = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type RangePreset =
  | 'this_month'
  | 'ytd'
  | 'ttm'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_365_days'
  | 'last_year'
  | 'custom';

export type ComparePreset =
  | 'none'
  | 'previous_period'
  | 'last_year'
  | 'two_years_ago'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_month';

export interface KpiRange {
  preset: RangePreset;
  start?: string; // ISO date for custom
  end?: string;   // ISO date for custom
}

export interface ResolvedRange {
  start: Date;
  end: Date;
  label: string;
}

export interface SeriesPoint {
  bucket: string;     // human label
  bucketStart: Date;  // for sorting / aligning
  bucketEnd?: Date;
  value: number;
  compareValue?: number;
  compareBucket?: string;
  compareBucketStart?: Date;
  compareBucketEnd?: Date;
}

export interface KpiResult {
  total: number;
  compareTotal?: number;
  series: SeriesPoint[];
  unit: 'number' | 'currency' | 'rating' | 'percent';
  meta?: Record<string, any>;
}

export type KpiMetric = 'listings' | 'gbv' | 'churn' | 'reviews' | 'net_growth' | 'owner_concentration' | 'channel_mix' | 'adr' | 'cancellation';

export interface KpiDetailRow {
  id: string;
  primary: string;       // main label (nickname / guest / etc.)
  secondary?: string;    // sub label
  value?: number | string;
  date?: string;
  extra?: Record<string, any>;
}

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: 'This month',
  ytd: 'Year to date',
  ttm: 'Trailing 12 months',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  last_365_days: 'Last 365 days',
  last_year: 'Last year',
  custom: 'Custom',
};

export const COMPARE_LABELS: Record<ComparePreset, string> = {
  none: 'No comparison',
  previous_period: 'Previous period',
  last_year: 'Last year',
  two_years_ago: '2 years ago',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  last_month: 'Last month',
};

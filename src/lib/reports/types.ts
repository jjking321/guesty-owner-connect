// Custom Reports Builder — shared types

export type WidgetType = 'kpi' | 'table' | 'line' | 'bar';

export type MetricKey =
  | 'revenue'
  | 'nights'
  | 'occupancy'
  | 'adr'
  | 'revpar'
  | 'goal'
  | 'forecast_p50';

export type ScopeKind = 'all' | 'listings' | 'group' | 'owner';

export interface ReportScope {
  kind: ScopeKind;
  ids?: string[]; // listing IDs (for 'listings'), or [groupId] / [ownerId]
}

export type DateRangePreset =
  | 'this_month'
  | 'ytd'
  | 'ttm'
  | 'last_year'
  | 'next_month'
  | 'next_30_days'
  | 'next_90_days'
  | 'next_6_months'
  | 'next_12_months'
  | 'rest_of_year'
  | 'next_year';

export type DateRangeConfig =
  | { preset: DateRangePreset }
  | { preset: 'custom'; start: string; end: string };

export type BreakdownKey = 'month' | 'listing' | 'owner' | 'group';

export type CompareKey =
  | 'last_year'           // same range, shifted -1 year
  | 'previous_period'     // immediately preceding range of equal length
  | 'last_30_days'        // fixed: 30 days ending yesterday
  | 'last_90_days'        // fixed: 90 days ending yesterday
  | 'last_month'          // previous calendar month
  | 'two_years_ago'       // same range, shifted -2 years
  | 'goal'                // monthly revenue goals
  | 'actual_revenue'      // actual revenue for the same range (forecast only)
  | 'compset'             // compset monthly averages for the same range
  | null;

export const COMPARE_LABELS: Record<Exclude<CompareKey, null>, string> = {
  last_year: 'Last year',
  previous_period: 'Previous period',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  last_month: 'Last month',
  two_years_ago: '2 years ago',
  goal: 'Goal',
  actual_revenue: 'Actual Revenue',
  compset: 'Compset',
};

export interface ReportModule {
  id: string;
  type: WidgetType;
  title: string;
  metric: MetricKey;
  scope: ReportScope;
  dateRange: DateRangeConfig;
  breakdown?: BreakdownKey;
  compare?: CompareKey;
}

export interface ReportConfig {
  modules: ReportModule[];
}

export interface CustomReportRow {
  id: string;
  organization_id: string;
  created_by: string;
  name: string;
  description: string | null;
  is_template: boolean;
  config: ReportConfig;
  created_at: string;
  updated_at: string;
}

export interface ResolvedDateRange {
  start: Date;
  end: Date;
  label: string;
}

export interface ModuleDataRow {
  key: string; // bucket label (e.g. "Jan 2026", "Cozy Cabin")
  value: number;
  compareValue?: number; // for vs last year / vs goal
}

export interface ModuleData {
  rows: ModuleDataRow[];
  total: number;
  compareTotal?: number;
  unit: 'currency' | 'percent' | 'number';
  metricLabel: string;
  compareLabel?: string;
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: 'Revenue',
  nights: 'Nights Booked',
  occupancy: 'Occupancy %',
  adr: 'ADR',
  revpar: 'RevPAR',
  goal: 'Goal',
  forecast_p50: 'Forecast (P50)',
};

export const METRIC_UNITS: Record<MetricKey, 'currency' | 'percent' | 'number'> = {
  revenue: 'currency',
  nights: 'number',
  occupancy: 'percent',
  adr: 'currency',
  revpar: 'currency',
  goal: 'currency',
  forecast_p50: 'currency',
};

export const WIDGET_LABELS: Record<WidgetType, string> = {
  kpi: 'KPI Card',
  table: 'Table',
  line: 'Line Chart',
  bar: 'Bar Chart',
};

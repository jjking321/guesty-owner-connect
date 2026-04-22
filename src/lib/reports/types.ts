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

export type DateRangeConfig =
  | { preset: 'this_month' | 'ytd' | 'ttm' | 'last_year' }
  | { preset: 'custom'; start: string; end: string };

export type BreakdownKey = 'month' | 'listing' | 'owner' | 'group';

export type CompareKey = 'last_year' | 'goal' | null;

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

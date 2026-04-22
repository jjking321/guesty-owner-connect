import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { formatValue, formatCsvValue, downloadCsv } from '@/lib/reports/format';
import type { ModuleData, ReportModule } from '@/lib/reports/types';
import { resolveDateRange } from '@/lib/reports/dateRange';

interface Props {
  module: ReportModule;
  data: ModuleData;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';
}

export function BarChartModule({ module, data }: Props) {
  const range = resolveDateRange(module.dateRange);
  const showCompare = data.rows.some((r) => r.compareValue !== undefined);

  const chartData = data.rows.map((r) => ({
    name: r.key,
    [data.metricLabel]: r.value,
    ...(showCompare && data.compareLabel ? { [data.compareLabel]: r.compareValue ?? 0 } : {}),
  }));

  const handleCsv = () => {
    const headers = ['Bucket', data.metricLabel];
    if (showCompare && data.compareLabel) headers.push(data.compareLabel);
    const rows: string[][] = [headers];
    for (const r of data.rows) {
      const row = [r.key, formatCsvValue(r.value, data.unit)];
      if (showCompare && data.compareLabel) {
        row.push(r.compareValue !== undefined ? formatCsvValue(r.compareValue, data.unit) : '');
      }
      rows.push(row);
    }
    downloadCsv(`${slugify(module.title)}.csv`, rows);
  };

  return (
    <Card data-report-module>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{module.title}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{range.label}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCsv}>
          <Download className="h-4 w-4 mr-2" />
          CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => formatValue(Number(v), data.unit)}
              />
              <Tooltip formatter={(v: any) => formatValue(Number(v), data.unit)} />
              <Legend />
              <Bar dataKey={data.metricLabel} fill="hsl(var(--primary))" />
              {showCompare && data.compareLabel && (
                <Bar dataKey={data.compareLabel} fill="hsl(var(--muted-foreground))" />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

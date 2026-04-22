import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
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

export function KpiCard({ module, data }: Props) {
  const range = resolveDateRange(module.dateRange);

  const handleCsv = () => {
    const rows: string[][] = [
      ['Metric', 'Value'],
      [data.metricLabel, formatCsvValue(data.total, data.unit)],
    ];
    if (data.compareTotal !== undefined && data.compareLabel) {
      rows.push([data.compareLabel, formatCsvValue(data.compareTotal, data.unit)]);
    }
    downloadCsv(`${slugify(module.title)}.csv`, rows);
  };

  const delta =
    data.compareTotal !== undefined && data.compareTotal !== 0
      ? ((data.total - data.compareTotal) / data.compareTotal) * 100
      : null;

  return (
    <Card data-report-module>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{module.title}</p>
            <p className="text-3xl font-semibold tracking-tight">
              {formatValue(data.total, data.unit)}
            </p>
            {data.compareTotal !== undefined && (
              <p className="text-xs text-muted-foreground">
                vs {data.compareLabel}: {formatValue(data.compareTotal, data.unit)}
                {delta !== null && (
                  <span className={delta >= 0 ? ' text-emerald-600' : ' text-red-600'}>
                    {' '}
                    ({delta >= 0 ? '+' : ''}
                    {delta.toFixed(1)}%)
                  </span>
                )}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{range.label}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleCsv}>
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

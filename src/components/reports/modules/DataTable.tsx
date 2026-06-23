import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

export function DataTable({ module, data }: Props) {
  const range = resolveDateRange(module.dateRange);
  const pivot = data.pivot;

  // ---------- PIVOT RENDER ----------
  if (pivot) {
    const handleCsv = () => {
      const headers = ['Bucket', ...pivot.columns, 'Total'];
      const rows: string[][] = [headers];
      for (const r of pivot.rows) {
        rows.push([
          r.key,
          ...pivot.columns.map((c) => formatCsvValue(r.values[c] ?? 0, data.unit)),
          formatCsvValue(r.rowTotal, data.unit),
        ]);
      }
      rows.push([
        'Total',
        ...pivot.columns.map((c) => formatCsvValue(pivot.columnTotals[c] ?? 0, data.unit)),
        formatCsvValue(pivot.grandTotal, data.unit),
      ]);
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
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bucket</TableHead>
                {pivot.columns.map((c) => (
                  <TableHead key={c} className="text-right">{c}</TableHead>
                ))}
                <TableHead className="text-right font-semibold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={pivot.columns.length + 2} className="text-center text-muted-foreground">
                    No data
                  </TableCell>
                </TableRow>
              ) : (
                pivot.rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>{r.key}</TableCell>
                    {pivot.columns.map((c) => (
                      <TableCell key={c} className="text-right">
                        {formatValue(r.values[c] ?? 0, data.unit)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium">
                      {formatValue(r.rowTotal, data.unit)}
                    </TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                {pivot.columns.map((c) => (
                  <TableCell key={c} className="text-right">
                    {formatValue(pivot.columnTotals[c] ?? 0, data.unit)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold">
                  {formatValue(pivot.grandTotal, data.unit)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  // ---------- LEGACY (single-column) RENDER ----------
  const showCompare = data.rows.some((r) => r.compareValue !== undefined);

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
    rows.push([
      'Total',
      formatCsvValue(data.total, data.unit),
      ...(showCompare && data.compareTotal !== undefined
        ? [formatCsvValue(data.compareTotal, data.unit)]
        : []),
    ]);
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bucket</TableHead>
              <TableHead className="text-right">{data.metricLabel}</TableHead>
              {showCompare && data.compareLabel && (
                <TableHead className="text-right">{data.compareLabel}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showCompare ? 3 : 2} className="text-center text-muted-foreground">
                  No data
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.key}</TableCell>
                  <TableCell className="text-right">{formatValue(r.value, data.unit)}</TableCell>
                  {showCompare && data.compareLabel && (
                    <TableCell className="text-right">
                      {r.compareValue !== undefined ? formatValue(r.compareValue, data.unit) : '—'}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
            <TableRow className="font-medium">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{formatValue(data.total, data.unit)}</TableCell>
              {showCompare && data.compareLabel && (
                <TableCell className="text-right">
                  {data.compareTotal !== undefined ? formatValue(data.compareTotal, data.unit) : '—'}
                </TableCell>
              )}
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

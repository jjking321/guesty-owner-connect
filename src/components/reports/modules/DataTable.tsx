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

function deltaPct(current: number, compare: number): number | null {
  if (!compare) return null;
  return ((current - compare) / compare) * 100;
}

function StackedCell({
  value,
  compare,
  unit,
  align = 'right',
  bold = false,
}: {
  value: number;
  compare?: number;
  unit: ModuleData['unit'];
  align?: 'right' | 'left';
  bold?: boolean;
}) {
  const showCompare = compare !== undefined;
  const d = showCompare ? deltaPct(value, compare!) : null;
  return (
    <div className={`flex flex-col ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <span className={bold ? 'font-semibold' : ''}>{formatValue(value, unit)}</span>
      {showCompare && (
        <span className="text-[10px] text-muted-foreground leading-tight">
          {formatValue(compare!, unit)}
          {d !== null && (
            <span className={d >= 0 ? ' text-emerald-600' : ' text-red-600'}>
              {' '}({d >= 0 ? '+' : ''}{d.toFixed(1)}%)
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export function DataTable({ module, data }: Props) {
  const range = resolveDateRange(module.dateRange);
  const pivot = data.pivot;

  // ---------- PIVOT RENDER ----------
  if (pivot) {
    const showCompare = pivot.compareLabel !== undefined;

    const handleCsv = () => {
      const headers: string[] = ['Bucket'];
      for (const c of pivot.columns) {
        headers.push(c);
        if (showCompare) headers.push(`${c} (vs ${pivot.compareLabel})`);
      }
      headers.push('Total');
      if (showCompare) headers.push(`Total (vs ${pivot.compareLabel})`);
      const rows: string[][] = [headers];
      for (const r of pivot.rows) {
        const row: string[] = [r.key];
        for (const c of pivot.columns) {
          row.push(formatCsvValue(r.values[c] ?? 0, data.unit));
          if (showCompare) row.push(formatCsvValue(r.compareValues?.[c] ?? 0, data.unit));
        }
        row.push(formatCsvValue(r.rowTotal, data.unit));
        if (showCompare) row.push(formatCsvValue(r.rowCompareTotal ?? 0, data.unit));
        rows.push(row);
      }
      const totalRow: string[] = ['Total'];
      for (const c of pivot.columns) {
        totalRow.push(formatCsvValue(pivot.columnTotals[c] ?? 0, data.unit));
        if (showCompare) totalRow.push(formatCsvValue(pivot.columnCompareTotals?.[c] ?? 0, data.unit));
      }
      totalRow.push(formatCsvValue(pivot.grandTotal, data.unit));
      if (showCompare) totalRow.push(formatCsvValue(pivot.grandCompareTotal ?? 0, data.unit));
      rows.push(totalRow);
      downloadCsv(`${slugify(module.title)}.csv`, rows);
    };

    return (
      <Card data-report-module>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">{module.title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {range.label}
              {showCompare && <> · compared to <span className="font-medium">{pivot.compareLabel}</span></>}
            </p>
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
                        <StackedCell
                          value={r.values[c] ?? 0}
                          compare={showCompare ? (r.compareValues?.[c] ?? 0) : undefined}
                          unit={data.unit}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <StackedCell
                        value={r.rowTotal}
                        compare={showCompare ? (r.rowCompareTotal ?? 0) : undefined}
                        unit={data.unit}
                        bold
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                {pivot.columns.map((c) => (
                  <TableCell key={c} className="text-right">
                    <StackedCell
                      value={pivot.columnTotals[c] ?? 0}
                      compare={showCompare ? (pivot.columnCompareTotals?.[c] ?? 0) : undefined}
                      unit={data.unit}
                    />
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <StackedCell
                    value={pivot.grandTotal}
                    compare={showCompare ? (pivot.grandCompareTotal ?? 0) : undefined}
                    unit={data.unit}
                    bold
                  />
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

import type { ModuleData } from './types';

export function formatValue(value: number, unit: ModuleData['unit']): string {
  if (!isFinite(value)) return '—';
  switch (unit) {
    case 'currency':
      return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      });
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'number':
      return Math.round(value).toLocaleString('en-US');
  }
}

export function formatCsvValue(value: number, unit: ModuleData['unit']): string {
  if (!isFinite(value)) return '';
  switch (unit) {
    case 'currency':
      return value.toFixed(2);
    case 'percent':
      return value.toFixed(1);
    case 'number':
      return String(Math.round(value));
  }
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const v = cell ?? '';
          if (v.includes(',') || v.includes('"') || v.includes('\n')) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        })
        .join(','),
    )
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

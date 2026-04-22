import { useQuery } from '@tanstack/react-query';
import { KpiCard } from './modules/KpiCard';
import { DataTable } from './modules/DataTable';
import { LineChartModule } from './modules/LineChartModule';
import { BarChartModule } from './modules/BarChartModule';
import { fetchModuleData } from '@/lib/reports/dataFetcher';
import type { ReportModule } from '@/lib/reports/types';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  module: ReportModule;
}

export function ModuleRenderer({ module }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['report-module', module],
    queryFn: () => fetchModuleData(module),
  });

  if (isLoading) {
    return (
      <Card data-report-module>
        <CardContent className="p-6 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-3 w-1/4" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card data-report-module>
        <CardContent className="p-6 text-sm text-destructive">
          Failed to load module: {(error as Error)?.message ?? 'unknown error'}
        </CardContent>
      </Card>
    );
  }

  switch (module.type) {
    case 'kpi':
      return <KpiCard module={module} data={data} />;
    case 'table':
      return <DataTable module={module} data={data} />;
    case 'line':
      return <LineChartModule module={module} data={data} />;
    case 'bar':
      return <BarChartModule module={module} data={data} />;
  }
}

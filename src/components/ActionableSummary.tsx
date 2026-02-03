import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, Building2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ActionableSummaryProps {
  totalProperties: number;
  totalIssues: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  lastGenerated: string | null;
}

export function ActionableSummary({
  totalProperties,
  totalIssues,
  criticalCount,
  highCount,
  mediumCount,
  lowCount,
  lastGenerated,
}: ActionableSummaryProps) {
  const stats = [
    {
      label: 'Properties',
      value: totalProperties,
      icon: Building2,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'Critical',
      value: criticalCount,
      icon: AlertTriangle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
    },
    {
      label: 'High',
      value: highCount,
      icon: AlertCircle,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
    },
    {
      label: 'Medium',
      value: mediumCount,
      icon: Info,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-500/10',
    },
    {
      label: 'Low',
      value: lowCount,
      icon: CheckCircle2,
      color: 'text-muted-foreground',
      bgColor: 'bg-muted',
    },
  ];

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap gap-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className={`flex items-center gap-3 px-4 py-2 rounded-lg ${stat.bgColor}`}
              >
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>

          {lastGenerated && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                Last updated {formatDistanceToNow(new Date(lastGenerated), { addSuffix: true })}
              </span>
            </div>
          )}
        </div>

        {totalIssues > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            {totalIssues} total issues across {totalProperties} properties requiring attention
          </p>
        )}
      </CardContent>
    </Card>
  );
}

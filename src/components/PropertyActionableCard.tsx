import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, ExternalLink, X, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Issue {
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  score: number;
  title: string;
  description: string;
  affected_dates?: string[];
  revenue_impact?: number;
  data_snapshot?: Record<string, unknown>;
}

interface PropertyActionableCardProps {
  rank: number;
  propertyId: string;
  propertyName: string;
  thumbnail?: string | null;
  aggregateScore: number;
  issues: Issue[];
  aiSummary: string | null;
  dismissed: boolean;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  onDismiss: () => void;
  isDismissing: boolean;
}

const PRIORITY_CONFIG = {
  critical: {
    color: 'bg-destructive text-destructive-foreground',
    icon: AlertTriangle,
    label: 'Critical',
  },
  high: {
    color: 'bg-orange-500 text-white',
    icon: AlertCircle,
    label: 'High',
  },
  medium: {
    color: 'bg-yellow-500 text-black',
    icon: Info,
    label: 'Medium',
  },
  low: {
    color: 'bg-muted text-muted-foreground',
    icon: CheckCircle2,
    label: 'Low',
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  unbookable_gap: 'Unbookable Gap',
  low_rating: 'Low Rating',
  low_probability: 'Low Probability',
  forecast_miss: 'Forecast Gap',
  recent_low_review: 'Low Review',
  missing_goals: 'Missing Goals',
  pricing_high: 'Overpriced',
  pricing_low: 'Underpriced',
  yoy_pacing_gap: 'YoY Pacing',
  high_demand_available: 'High Demand',
};

export function PropertyActionableCard({
  rank,
  propertyId,
  propertyName,
  thumbnail,
  aggregateScore,
  issues,
  aiSummary,
  dismissed,
  criticalCount,
  highCount,
  mediumCount,
  lowCount,
  onDismiss,
  isDismissing,
}: PropertyActionableCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const previewIssues = issues.slice(0, 2);
  const remainingIssues = issues.slice(2);

  return (
    <Card className={cn("transition-all", dismissed && "opacity-60")}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-2">
          <div className="flex items-start gap-4">
            {/* Rank */}
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
              {rank}
            </div>

            {/* Thumbnail */}
            <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted">
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt={propertyName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                  No Image
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-lg truncate">{propertyName}</h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="outline" className="font-mono">
                    Score: {aggregateScore}
                  </Badge>
                </div>
              </div>

              {/* Issue count badges */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {criticalCount > 0 && (
                  <Badge className={PRIORITY_CONFIG.critical.color}>
                    {criticalCount} Critical
                  </Badge>
                )}
                {highCount > 0 && (
                  <Badge className={PRIORITY_CONFIG.high.color}>
                    {highCount} High
                  </Badge>
                )}
                {mediumCount > 0 && (
                  <Badge className={PRIORITY_CONFIG.medium.color}>
                    {mediumCount} Medium
                  </Badge>
                )}
                {lowCount > 0 && (
                  <Badge className={PRIORITY_CONFIG.low.color}>
                    {lowCount} Low
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Preview Issues */}
          <div className="space-y-2 mb-3">
            {previewIssues.map((issue, idx) => (
              <IssueItem key={idx} issue={issue} />
            ))}
          </div>

          {/* Expandable Content */}
          <CollapsibleContent>
            {remainingIssues.length > 0 && (
              <div className="space-y-2 mb-3">
                {remainingIssues.map((issue, idx) => (
                  <IssueItem key={idx} issue={issue} />
                ))}
              </div>
            )}

            {/* AI Summary */}
            {aiSummary && (
              <div className="bg-muted/50 rounded-lg p-3 mb-3">
                <p className="text-sm font-medium mb-1">AI Recommendation:</p>
                <p className="text-sm text-muted-foreground">{aiSummary}</p>
              </div>
            )}
          </CollapsibleContent>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {isOpen ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    {remainingIssues.length > 0
                      ? `Show ${remainingIssues.length} More Issues`
                      : 'Show Details'}
                  </>
                )}
              </Button>
            </CollapsibleTrigger>

            <div className="flex gap-2">
              {!dismissed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDismiss}
                  disabled={isDismissing}
                >
                  <X className="h-4 w-4 mr-1" />
                  Dismiss
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => navigate(`/listings/${propertyId}`)}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                View Property
              </Button>
            </div>
          </div>
        </CardContent>
      </Collapsible>
    </Card>
  );
}

function IssueItem({ issue }: { issue: Issue }) {
  const config = PRIORITY_CONFIG[issue.priority];
  const Icon = config.icon;
  const categoryLabel = CATEGORY_LABELS[issue.category] || issue.category;

  return (
    <div className="flex items-start gap-2 text-sm">
      <Badge className={cn("flex-shrink-0 text-xs", config.color)}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
      <span className="text-muted-foreground flex-shrink-0">[{categoryLabel}]</span>
      <span className="flex-1">{issue.title}</span>
      {issue.revenue_impact && issue.revenue_impact > 0 && (
        <span className="flex-shrink-0 text-destructive font-medium">
          -${issue.revenue_impact.toLocaleString()}
        </span>
      )}
    </div>
  );
}

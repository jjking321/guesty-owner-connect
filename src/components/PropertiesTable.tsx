import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PropertyMetrics {
  id: string;
  nickname: string;
  thumbnail: string | null;
  address: any;
  propertyType: string | null;
  actualRevenue: number;
  budgetTotal: number;
  projectionTotal: number;
  goalTotal: number;
  forecastedRevenue: number;
  forecastUpdatedAt: string | null;
  budgetAchievement: number;
  projectionAchievement: number;
  goalAchievement: number;
  forecastBudgetAchievement: number;
  forecastProjectionAchievement: number;
  forecastGoalAchievement: number;
  status: "on-track" | "at-risk" | "behind";
  hasGoals: boolean;
  hasLockedGoals: boolean;
  goalsLockedCount: number;
}

interface PropertiesTableProps {
  properties: PropertyMetrics[];
  isLoading: boolean;
}

export function PropertiesTable({ properties, isLoading }: PropertiesTableProps) {
  const navigate = useNavigate();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      "on-track": { label: "On Track", className: "bg-green-500/10 text-green-700 dark:text-green-400" },
      "at-risk": { label: "At Risk", className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
      behind: { label: "Behind", className: "bg-red-500/10 text-red-700 dark:text-red-400" },
    };
    const variant = variants[status as keyof typeof variants] || variants["on-track"];
    return (
      <Badge variant="outline" className={variant.className}>
        {variant.label}
      </Badge>
    );
  };

  const getAchievementIndicator = (percentage: number) => {
    if (percentage >= 95) {
      return <TrendingUp className="h-4 w-4 text-green-600" />;
    } else if (percentage >= 80) {
      return <Minus className="h-4 w-4 text-yellow-600" />;
    } else {
      return <TrendingDown className="h-4 w-4 text-red-600" />;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <div className="p-6 space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (!properties.length) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground">No properties found</p>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">Property</TableHead>
                <TableHead className="text-right">Actual YTD</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Projection</TableHead>
                <TableHead className="text-right">Goal</TableHead>
                <TableHead className="text-right">Forecast</TableHead>
                <TableHead className="text-center">Goal Progress</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((property) => (
                <TableRow
                  key={property.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/listings/${property.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {property.thumbnail && (
                        <img
                          src={property.thumbnail}
                          alt={property.nickname}
                          className="w-12 h-12 rounded object-cover"
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium">{property.nickname}</p>
                          <p className="text-sm text-muted-foreground">
                            {property.address?.city || "No location"}
                          </p>
                        </div>
                        {property.hasLockedGoals && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Lock className="h-4 w-4 text-green-600 flex-shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{property.goalsLockedCount} of 12 goals locked</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {!property.hasGoals && (
                          <Badge variant="outline" className="text-xs">No Goals</Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(property.actualRevenue)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatCurrency(property.budgetTotal)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatCurrency(property.projectionTotal)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatCurrency(property.goalTotal)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {getAchievementIndicator(property.forecastGoalAchievement)}
                    <span className="font-medium">
                      {formatCurrency(property.forecastedRevenue)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-sm font-medium">
                      {property.forecastGoalAchievement.toFixed(1)}%
                    </span>
                    <div className="w-full max-w-[100px] h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          property.forecastGoalAchievement >= 95
                            ? "bg-green-600"
                            : property.forecastGoalAchievement >= 80
                            ? "bg-yellow-600"
                            : "bg-red-600"
                        }`}
                        style={{
                          width: `${Math.min(property.forecastGoalAchievement, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {getStatusBadge(property.status)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
    </TooltipProvider>
  );
}

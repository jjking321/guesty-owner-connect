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
import { Checkbox } from "@/components/ui/checkbox";
import { TrendingUp, TrendingDown, Minus, Lock, ArrowUpDown, ArrowUp, ArrowDown, Building2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSmartNavigation, type NavigationReferrer } from "@/hooks/useSmartNavigation";

interface PropertyMetrics {
  id: string;
  nickname: string;
  thumbnail: string | null;
  address: any;
  propertyType: string | null;
  actualRevenue: number;
  directRevenue?: number;
  attributedRevenue?: number;
  projectionTotal: number;
  forecastedRevenue: number;
  forecastUpdatedAt: string | null;
  projectionAchievement: number;
  forecastProjectionAchievement: number;
  status: "on-track" | "at-risk" | "behind";
  hasGoals: boolean;
  hasLockedGoals: boolean;
  goalsLockedCount: number;
  archived?: boolean;
  isComposite?: boolean;
  occupancy?: number;
  adr?: number;
  revpar?: number;
}

interface PropertiesTableProps {
  properties: PropertyMetrics[];
  isLoading: boolean;
  sortBy?: "name" | "actual" | "forecast" | "goalProgress" | "status";
  sortDirection?: "asc" | "desc";
  onSort?: (field: "name" | "actual" | "forecast" | "goalProgress" | "status") => void;
  referrer?: NavigationReferrer;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectProperty?: (id: string) => void;
  onSelectAll?: () => void;
}

export function PropertiesTable({ 
  properties, 
  isLoading, 
  sortBy, 
  sortDirection, 
  onSort, 
  referrer,
  selectable = false,
  selectedIds = new Set(),
  onSelectProperty,
  onSelectAll,
}: PropertiesTableProps) {
  const navigate = useNavigate();
  const { navigateToProperty } = useSmartNavigation();

  const SortableHeader = ({ field, children, align = "left" }: { 
    field: "name" | "actual" | "forecast" | "goalProgress" | "status"; 
    children: React.ReactNode;
    align?: "left" | "right" | "center";
  }) => {
    if (!onSort) return <TableHead className={align === "right" ? "text-right" : align === "center" ? "text-center" : ""}>{children}</TableHead>;
    
    const isActive = sortBy === field;
    const Icon = isActive ? (sortDirection === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    
    return (
      <TableHead 
        className={`cursor-pointer hover:bg-muted/50 select-none ${align === "right" ? "text-right" : align === "center" ? "text-center" : ""}`}
        onClick={() => onSort(field)}
      >
        <div className={`flex items-center gap-2 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : ""}`}>
          {children}
          <Icon className="h-4 w-4" />
        </div>
      </TableHead>
    );
  };

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
                {selectable && (
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedIds.size > 0 && selectedIds.size === properties.length}
                      onCheckedChange={onSelectAll}
                      aria-label="Select all"
                      className={selectedIds.size > 0 && selectedIds.size < properties.length ? "data-[state=checked]:bg-primary" : ""}
                    />
                  </TableHead>
                )}
                <SortableHeader field="name">Property</SortableHeader>
                <SortableHeader field="actual" align="right">Actual YTD</SortableHeader>
                <TableHead className="text-right">Occ %</TableHead>
                <TableHead className="text-right">ADR</TableHead>
                <TableHead className="text-right">RevPAR</TableHead>
                <TableHead className="text-right">Goal</TableHead>
                <SortableHeader field="forecast" align="right">Forecast</SortableHeader>
                <SortableHeader field="goalProgress" align="center">Goal Progress</SortableHeader>
                <SortableHeader field="status" align="center">Status</SortableHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((property) => (
              <TableRow
                key={property.id}
                className={`cursor-pointer hover:bg-muted/50 ${property.archived ? 'opacity-60' : ''}`}
                onClick={(e) => {
                  // Don't navigate if clicking checkbox
                  if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
                    return;
                  }
                  if (referrer) {
                    navigateToProperty(property.id, referrer);
                  } else {
                    navigate(`/listings/${property.id}`);
                  }
                }}
              >
                  {selectable && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(property.id)}
                        onCheckedChange={() => onSelectProperty?.(property.id)}
                        aria-label={`Select ${property.nickname}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {property.thumbnail && (
                        <img
                          src={property.thumbnail}
                          alt={property.nickname}
                          className={`w-12 h-12 rounded object-cover ${property.archived ? 'opacity-40 grayscale' : ''}`}
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <div>
                        <div className="flex items-center gap-2">
                            <p className="font-medium">{property.nickname}</p>
                            {property.isComposite && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                <Building2 className="h-3 w-3 mr-1" />
                                Full
                              </Badge>
                            )}
                            {property.archived && (
                              <Badge variant="outline" className="bg-muted text-muted-foreground">
                                Archived
                              </Badge>
                            )}
                          </div>
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
                  <div className="flex flex-col items-end">
                    <span>{formatCurrency(property.actualRevenue)}</span>
                    {(property.attributedRevenue ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        +{formatCurrency(property.attributedRevenue || 0)} from Full
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {property.occupancy !== undefined ? `${property.occupancy.toFixed(1)}%` : '--'}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {property.adr !== undefined ? formatCurrency(property.adr) : '--'}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {property.revpar !== undefined ? formatCurrency(property.revpar) : '--'}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatCurrency(property.projectionTotal)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {getAchievementIndicator(property.forecastProjectionAchievement)}
                    <span className="font-medium">
                      {formatCurrency(property.forecastedRevenue)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-sm font-medium">
                      {property.forecastProjectionAchievement.toFixed(1)}%
                    </span>
                    <div className="w-full max-w-[100px] h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          property.forecastProjectionAchievement >= 95
                            ? "bg-green-600"
                            : property.forecastProjectionAchievement >= 80
                            ? "bg-yellow-600"
                            : "bg-red-600"
                        }`}
                        style={{
                          width: `${Math.min(property.forecastProjectionAchievement, 100)}%`,
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

import React, { useState, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TrendingUp, TrendingDown, Minus, Lock, ArrowUpDown, ArrowUp, ArrowDown, Building2, Settings2, ChevronUp, ChevronDown as ChevronDownIcon, RotateCcw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSmartNavigation, type NavigationReferrer } from "@/hooks/useSmartNavigation";

export type ColumnKey = 'property' | 'actual' | 'occupancy' | 'adr' | 'revpar' | 'goal' | 'forecast' | 'goalProgress' | 'status';

interface ColumnConfig {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  canHide: boolean;
}

const ALL_COLUMNS: ColumnConfig[] = [
  { key: 'property', label: 'Property', defaultVisible: true, canHide: false },
  { key: 'actual', label: 'Actual YTD', defaultVisible: true, canHide: true },
  { key: 'occupancy', label: 'Occ %', defaultVisible: true, canHide: true },
  { key: 'adr', label: 'ADR', defaultVisible: true, canHide: true },
  { key: 'revpar', label: 'RevPAR', defaultVisible: true, canHide: true },
  { key: 'goal', label: 'Goal', defaultVisible: true, canHide: true },
  { key: 'forecast', label: 'Forecast', defaultVisible: true, canHide: true },
  { key: 'goalProgress', label: 'Goal Progress', defaultVisible: true, canHide: true },
  { key: 'status', label: 'Status', defaultVisible: true, canHide: true },
];

const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
const DEFAULT_COLUMN_ORDER: ColumnKey[] = ALL_COLUMNS.map(c => c.key);

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
  sortBy?: "name" | "actual" | "occupancy" | "adr" | "revpar" | "goal" | "forecast" | "goalProgress" | "status";
  sortDirection?: "asc" | "desc";
  onSort?: (field: "name" | "actual" | "occupancy" | "adr" | "revpar" | "goal" | "forecast" | "goalProgress" | "status") => void;
  referrer?: NavigationReferrer;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectProperty?: (id: string) => void;
  onSelectAll?: () => void;
  visibleColumns?: ColumnKey[];
  columnOrder?: ColumnKey[];
  onColumnConfigChange?: (visible: ColumnKey[], order: ColumnKey[]) => void;
  showColumnConfig?: boolean;
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
  visibleColumns = DEFAULT_VISIBLE_COLUMNS,
  columnOrder = DEFAULT_COLUMN_ORDER,
  onColumnConfigChange,
  showColumnConfig = false,
}: PropertiesTableProps) {
  const navigate = useNavigate();
  const { navigateToProperty } = useSmartNavigation();
  const [configOpen, setConfigOpen] = useState(false);

  // Order columns according to columnOrder, only show visible ones
  const orderedVisibleColumns = useMemo(() => {
    return columnOrder.filter(key => visibleColumns.includes(key));
  }, [columnOrder, visibleColumns]);

  const toggleColumnVisibility = (key: ColumnKey) => {
    const col = ALL_COLUMNS.find(c => c.key === key);
    if (!col?.canHide) return;
    
    const newVisible = visibleColumns.includes(key)
      ? visibleColumns.filter(k => k !== key)
      : [...visibleColumns, key];
    
    onColumnConfigChange?.(newVisible, columnOrder);
  };

  const moveColumn = (key: ColumnKey, direction: 'up' | 'down') => {
    const idx = columnOrder.indexOf(key);
    if (idx === -1) return;
    
    // Can't move property column
    if (key === 'property') return;
    
    const newOrder = [...columnOrder];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    
    // Don't swap with property (always first)
    if (swapIdx <= 0 || swapIdx >= newOrder.length) return;
    
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    onColumnConfigChange?.(visibleColumns, newOrder);
  };

  const resetToDefaults = () => {
    onColumnConfigChange?.(DEFAULT_VISIBLE_COLUMNS, DEFAULT_COLUMN_ORDER);
  };

  const SortableHeader = ({ field, children, align = "left" }: { 
    field: "name" | "actual" | "occupancy" | "adr" | "revpar" | "goal" | "forecast" | "goalProgress" | "status"; 
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

  const renderColumnHeader = (key: ColumnKey) => {
    switch (key) {
      case 'property':
        return <SortableHeader field="name">Property</SortableHeader>;
      case 'actual':
        return <SortableHeader field="actual" align="right">Actual YTD</SortableHeader>;
      case 'occupancy':
        return <SortableHeader field="occupancy" align="right">Occ %</SortableHeader>;
      case 'adr':
        return <SortableHeader field="adr" align="right">ADR</SortableHeader>;
      case 'revpar':
        return <SortableHeader field="revpar" align="right">RevPAR</SortableHeader>;
      case 'goal':
        return <SortableHeader field="goal" align="right">Goal</SortableHeader>;
      case 'forecast':
        return <SortableHeader field="forecast" align="right">Forecast</SortableHeader>;
      case 'goalProgress':
        return <SortableHeader field="goalProgress" align="center">Goal Progress</SortableHeader>;
      case 'status':
        return <SortableHeader field="status" align="center">Status</SortableHeader>;
      default:
        return null;
    }
  };

  const renderColumnCell = (key: ColumnKey, property: PropertyMetrics) => {
    switch (key) {
      case 'property':
        return (
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
        );
      case 'actual':
        return (
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
        );
      case 'occupancy':
        return (
          <TableCell className="text-right text-muted-foreground">
            {property.occupancy !== undefined ? `${property.occupancy.toFixed(1)}%` : '--'}
          </TableCell>
        );
      case 'adr':
        return (
          <TableCell className="text-right text-muted-foreground">
            {property.adr !== undefined ? formatCurrency(property.adr) : '--'}
          </TableCell>
        );
      case 'revpar':
        return (
          <TableCell className="text-right text-muted-foreground">
            {property.revpar !== undefined ? formatCurrency(property.revpar) : '--'}
          </TableCell>
        );
      case 'goal':
        return (
          <TableCell className="text-right text-muted-foreground">
            {formatCurrency(property.projectionTotal)}
          </TableCell>
        );
      case 'forecast':
        return (
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-2">
              {getAchievementIndicator(property.forecastProjectionAchievement)}
              <span className="font-medium">
                {formatCurrency(property.forecastedRevenue)}
              </span>
            </div>
          </TableCell>
        );
      case 'goalProgress':
        return (
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
        );
      case 'status':
        return (
          <TableCell className="text-center">
            {getStatusBadge(property.status)}
          </TableCell>
        );
      default:
        return null;
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
        {showColumnConfig && onColumnConfigChange && (
          <div className="p-3 border-b flex justify-end">
            <Popover open={configOpen} onOpenChange={setConfigOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">Configure Columns</h4>
                    <Button variant="ghost" size="sm" onClick={resetToDefaults}>
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {columnOrder.map((key, idx) => {
                      const col = ALL_COLUMNS.find(c => c.key === key);
                      if (!col) return null;
                      const isVisible = visibleColumns.includes(key);
                      const isFirst = key === 'property';
                      const canMoveUp = idx > 1; // Can't move to position 0 (property)
                      const canMoveDown = idx < columnOrder.length - 1 && idx > 0;
                      
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between py-1.5 px-2 rounded ${
                            isFirst ? 'bg-muted/50' : 'hover:bg-muted/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={isVisible}
                              disabled={!col.canHide}
                              onCheckedChange={() => toggleColumnVisibility(key)}
                            />
                            <span className={`text-sm ${!isVisible ? 'text-muted-foreground' : ''}`}>
                              {col.label}
                            </span>
                            {isFirst && (
                              <Badge variant="secondary" className="text-xs">Locked</Badge>
                            )}
                          </div>
                          {!isFirst && (
                            <div className="flex items-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={!canMoveUp}
                                onClick={() => moveColumn(key, 'up')}
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={!canMoveDown}
                                onClick={() => moveColumn(key, 'down')}
                              >
                                <ChevronDownIcon className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
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
                {orderedVisibleColumns.map(key => (
                  <React.Fragment key={key}>
                    {renderColumnHeader(key)}
                  </React.Fragment>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((property) => (
                <TableRow
                  key={property.id}
                  className={`cursor-pointer hover:bg-muted/50 ${property.archived ? 'opacity-60' : ''}`}
                  onClick={(e) => {
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
                  {orderedVisibleColumns.map(key => (
                    <React.Fragment key={key}>
                      {renderColumnCell(key, property)}
                    </React.Fragment>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </TooltipProvider>
  );
}

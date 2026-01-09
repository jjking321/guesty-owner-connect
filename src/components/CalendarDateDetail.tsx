import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RateSimulator } from "./RateSimulator";
import { ProbabilityData, getProbabilityColor } from "@/lib/probabilityCalculator";

interface CompsetDayDetail {
  airroi_listing_id: string;
  name: string;
  thumbnail: string | null;
  rate: number;
  available: boolean;
  diffFromYou: number | null;
  diffPercent: number | null;
}

interface CompsetDailyInfo {
  totalCount: number;
  bookedCount: number;
  avgRate: number;
  comparables: CompsetDayDetail[];
}

interface CalendarDayData {
  price: number | null;
  currency: string | null;
  status: string | null;
  is_available: boolean;
  block_reason: string | null;
}

interface CalendarDateDetailProps {
  selectedDate: string | null;
  onClose: () => void;
  myDayData: CalendarDayData | undefined;
  compsetInfo: CompsetDailyInfo | undefined;
  compareToCompset: boolean;
  onComparableClick?: (airroiListingId: string) => void;
  probabilityData?: ProbabilityData;
}

export function CalendarDateDetail({
  selectedDate,
  onClose,
  myDayData,
  compsetInfo,
  compareToCompset,
  onComparableClick,
  probabilityData,
}: CalendarDateDetailProps) {
  if (!selectedDate) return null;

  const formatPrice = (price: number | null | undefined, currency: string | null | undefined) => {
    if (price === null || price === undefined) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const getMyStatus = () => {
    if (!myDayData) return { label: 'No data', color: 'bg-muted' };
    if (myDayData.status === 'booked' || myDayData.block_reason === 'reservation') {
      return { label: 'Booked', color: 'bg-teal-500' };
    }
    if (myDayData.status === 'unavailable' || myDayData.block_reason === 'blocked') {
      return { label: 'Blocked', color: 'bg-slate-400' };
    }
    if (myDayData.is_available) {
      return { label: 'Available', color: 'bg-emerald-500' };
    }
    return { label: 'Unknown', color: 'bg-muted' };
  };

  const myStatus = getMyStatus();
  const myPrice = myDayData?.price;
  const priceDiff = compsetInfo?.avgRate && myPrice 
    ? ((myPrice - compsetInfo.avgRate) / compsetInfo.avgRate) * 100 
    : null;

  return (
    <Sheet open={!!selectedDate} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {format(new Date(selectedDate), 'EEEE, MMMM d, yyyy')}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${myStatus.color}`} />
            {myStatus.label}
            {myPrice && (
              <span className="font-semibold text-foreground ml-2">
                @ {formatPrice(myPrice, myDayData?.currency)}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Booking Probability Summary */}
          {probabilityData && probabilityData.probability !== null && (
            <>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Booking Probability
                </h4>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-muted/30 rounded-full h-6 overflow-hidden">
                    <div
                      className={`h-full ${getProbabilityColor(probabilityData.probability).badge} transition-all flex items-center justify-center`}
                      style={{ width: `${probabilityData.probability}%` }}
                    >
                      <span className="text-xs font-bold text-white">
                        {Math.round(probabilityData.probability)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Compset Summary */}
          {compareToCompset && compsetInfo && compsetInfo.totalCount > 0 && (
            <>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Compset Summary
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Avg Rate</div>
                    <div className="text-xl font-bold">
                      {formatPrice(compsetInfo.avgRate, myDayData?.currency)}
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">Comps Booked</div>
                    <div className="text-xl font-bold">
                      {compsetInfo.bookedCount} <span className="text-sm font-normal text-muted-foreground">/ {compsetInfo.totalCount}</span>
                    </div>
                  </div>
                </div>
                {priceDiff !== null && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg ${
                    priceDiff > 10 ? 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400' :
                    priceDiff < -10 ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400' :
                    'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400'
                  }`}>
                    <span className="text-sm">Your price is</span>
                    <Badge variant="secondary" className={`font-semibold ${
                      priceDiff > 10 ? 'bg-red-600 text-white' :
                      priceDiff < -10 ? 'bg-emerald-600 text-white' :
                      'bg-amber-600 text-white'
                    }`}>
                      {priceDiff > 0 ? '+' : ''}{priceDiff.toFixed(1)}%
                    </Badge>
                    <span className="text-sm">
                      {priceDiff > 10 ? 'above market' : priceDiff < -10 ? 'below market' : 'at market'}
                    </span>
                  </div>
                )}
              </div>

              <Separator />

              {/* Individual Comparables */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Comparables ({compsetInfo.comparables.length})
                </h4>
                <div className="space-y-3">
                  {compsetInfo.comparables.map((comp, idx) => (
                    <div 
                      key={idx} 
                      className={`flex items-center gap-3 p-2 rounded-lg bg-muted/30 transition-colors ${
                        onComparableClick ? 'cursor-pointer hover:bg-muted/60' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => onComparableClick?.(comp.airroi_listing_id)}
                    >
                      {comp.thumbnail ? (
                        <img 
                          src={comp.thumbnail} 
                          alt={comp.name}
                          className="w-12 h-12 rounded-md object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                          <span className="text-xs text-muted-foreground">No img</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{comp.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-sm font-semibold ${comp.available ? 'text-emerald-600' : 'text-foreground'}`}>
                            {formatPrice(comp.rate, myDayData?.currency)}
                          </span>
                          <Badge 
                            variant={comp.available ? "outline" : "secondary"}
                            className={`text-xs ${comp.available ? 'border-emerald-500 text-emerald-600' : 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-400'}`}
                          >
                            {comp.available ? 'Available' : 'Booked'}
                          </Badge>
                        </div>
                      </div>
                      {comp.diffFromYou !== null && myPrice && (
                        <div className={`text-sm font-medium ${
                          comp.diffFromYou < 0 ? 'text-red-600' : 'text-emerald-600'
                        }`}>
                          {comp.diffFromYou < 0 ? '+' : ''}{formatPrice(-comp.diffFromYou, myDayData?.currency)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* No compset data message */}
          {compareToCompset && (!compsetInfo || compsetInfo.totalCount === 0) && (
            <div className="p-4 bg-muted/30 rounded-lg text-center text-muted-foreground">
              No compset rate data available for this date
            </div>
          )}

          {!compareToCompset && !probabilityData && (
            <div className="p-4 bg-muted/30 rounded-lg text-center text-muted-foreground">
              Enable "Compare to Compset" or "Booking Probability" to see market data
            </div>
          )}

          {/* Rate Simulator - only for available dates with probability data */}
          {probabilityData && myDayData?.is_available && (
            <>
              <Separator />
              <RateSimulator 
                probabilityData={probabilityData}
                currency={myDayData?.currency || "USD"}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

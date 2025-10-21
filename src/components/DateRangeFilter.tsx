import { useState } from "react";
import { format, subDays, startOfYear, endOfYear, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type DateRangePreset = "ytd" | "last365" | "lastWeek" | "lastMonth" | "custom";

export interface DateRange {
  from: Date;
  to: Date;
  preset: DateRangePreset;
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const presets: { value: DateRangePreset; label: string; getRange: () => { from: Date; to: Date } }[] = [
    {
      value: "ytd",
      label: "Year to Date",
      getRange: () => ({
        from: startOfYear(new Date()),
        to: new Date(),
      }),
    },
    {
      value: "last365",
      label: "Last 365 Days",
      getRange: () => ({
        from: subDays(new Date(), 364),
        to: new Date(),
      }),
    },
    {
      value: "lastWeek",
      label: "Last 7 Days",
      getRange: () => ({
        from: subDays(new Date(), 6),
        to: new Date(),
      }),
    },
    {
      value: "lastMonth",
      label: "Last Month",
      getRange: () => {
        const lastMonth = subMonths(new Date(), 1);
        return {
          from: startOfMonth(lastMonth),
          to: endOfMonth(lastMonth),
        };
      },
    },
  ];

  const handlePresetChange = (presetValue: string) => {
    const preset = presets.find((p) => p.value === presetValue);
    if (preset) {
      const range = preset.getRange();
      onChange({
        ...range,
        preset: preset.value,
      });
    }
  };

  const handleCustomDateChange = (selectedDate: Date | undefined, type: "from" | "to") => {
    if (!selectedDate) return;
    
    onChange({
      from: type === "from" ? selectedDate : value.from,
      to: type === "to" ? selectedDate : value.to,
      preset: "custom",
    });
  };

  const currentPreset = presets.find((p) => p.value === value.preset);

  return (
    <div className="flex items-center gap-2">
      <Select value={value.preset} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select period" />
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom Range</SelectItem>
        </SelectContent>
      </Select>

      {value.preset === "custom" && (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "justify-start text-left font-normal",
                !value.from && !value.to && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value.from && value.to ? (
                <>
                  {format(value.from, "MMM dd, yyyy")} - {format(value.to, "MMM dd, yyyy")}
                </>
              ) : (
                <span>Pick dates</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex gap-2 p-3">
              <div>
                <p className="text-sm font-medium mb-2">From</p>
                <Calendar
                  mode="single"
                  selected={value.from}
                  onSelect={(date) => handleCustomDateChange(date, "from")}
                  initialFocus
                  className="pointer-events-auto"
                />
              </div>
              <div>
                <p className="text-sm font-medium mb-2">To</p>
                <Calendar
                  mode="single"
                  selected={value.to}
                  onSelect={(date) => handleCustomDateChange(date, "to")}
                  className="pointer-events-auto"
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {value.preset !== "custom" && currentPreset && (
        <div className="text-sm text-muted-foreground">
          {format(value.from, "MMM dd, yyyy")} - {format(value.to, "MMM dd, yyyy")}
        </div>
      )}
    </div>
  );
}

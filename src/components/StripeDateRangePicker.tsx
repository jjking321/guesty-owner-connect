import * as React from "react";
import { format, subDays, subMonths, startOfMonth, startOfQuarter, startOfYear } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface StripeDateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

const today = new Date();

const presets = [
  { label: "Today", getRange: () => ({ from: today, to: today }) },
  { label: "Last 7 days", getRange: () => ({ from: subDays(today, 6), to: today }) },
  { label: "Last 4 weeks", getRange: () => ({ from: subDays(today, 27), to: today }) },
  { label: "Last 6 months", getRange: () => ({ from: subMonths(today, 6), to: today }) },
  { label: "Last 12 months", getRange: () => ({ from: subMonths(today, 12), to: today }) },
  { label: "Month to date", getRange: () => ({ from: startOfMonth(today), to: today }) },
  { label: "Quarter to date", getRange: () => ({ from: startOfQuarter(today), to: today }) },
  { label: "Year to date", getRange: () => ({ from: startOfYear(today), to: today }) },
  { label: "All time", getRange: () => ({ from: undefined, to: undefined }) },
];

export function StripeDateRangePicker({
  value,
  onChange,
  className,
}: StripeDateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [tempRange, setTempRange] = React.useState<DateRange>(value);
  const [selectedPreset, setSelectedPreset] = React.useState<string | null>(null);
  const [startInput, setStartInput] = React.useState(value.from ? format(value.from, "MM/dd/yyyy") : "");
  const [endInput, setEndInput] = React.useState(value.to ? format(value.to, "MM/dd/yyyy") : "");

  // Update temp values when popover opens
  React.useEffect(() => {
    if (open) {
      setTempRange(value);
      setStartInput(value.from ? format(value.from, "MM/dd/yyyy") : "");
      setEndInput(value.to ? format(value.to, "MM/dd/yyyy") : "");
      
      // Try to match current value to a preset
      const matchedPreset = presets.find(preset => {
        const presetRange = preset.getRange();
        if (!presetRange.from && !presetRange.to && !value.from && !value.to) {
          return true; // All time
        }
        if (presetRange.from && presetRange.to && value.from && value.to) {
          return (
            format(presetRange.from, "yyyy-MM-dd") === format(value.from, "yyyy-MM-dd") &&
            format(presetRange.to, "yyyy-MM-dd") === format(value.to, "yyyy-MM-dd")
          );
        }
        return false;
      });
      setSelectedPreset(matchedPreset?.label || null);
    }
  }, [open, value]);

  const handlePresetClick = (preset: typeof presets[0]) => {
    const range = preset.getRange();
    setTempRange(range);
    setSelectedPreset(preset.label);
    setStartInput(range.from ? format(range.from, "MM/dd/yyyy") : "");
    setEndInput(range.to ? format(range.to, "MM/dd/yyyy") : "");
  };

  const handleCalendarSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range) {
      setTempRange({ from: range.from, to: range.to });
      setSelectedPreset(null);
      setStartInput(range.from ? format(range.from, "MM/dd/yyyy") : "");
      setEndInput(range.to ? format(range.to, "MM/dd/yyyy") : "");
    }
  };

  const handleStartInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStartInput(e.target.value);
    const parsed = new Date(e.target.value);
    if (!isNaN(parsed.getTime())) {
      setTempRange(prev => ({ ...prev, from: parsed }));
      setSelectedPreset(null);
    }
  };

  const handleEndInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndInput(e.target.value);
    const parsed = new Date(e.target.value);
    if (!isNaN(parsed.getTime())) {
      setTempRange(prev => ({ ...prev, to: parsed }));
      setSelectedPreset(null);
    }
  };

  const handleClear = () => {
    const allTimeRange = { from: undefined, to: undefined };
    setTempRange(allTimeRange);
    setSelectedPreset("All time");
    setStartInput("");
    setEndInput("");
  };

  const handleApply = () => {
    onChange(tempRange);
    setOpen(false);
  };

  const getDisplayText = () => {
    if (!value.from && !value.to) {
      return "All time";
    }
    if (value.from && value.to) {
      return `${format(value.from, "MMM d, yyyy")} – ${format(value.to, "MMM d, yyyy")}`;
    }
    if (value.from) {
      return `${format(value.from, "MMM d, yyyy")} –`;
    }
    return "Select dates";
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start text-left font-normal min-w-[260px]",
            !value.from && !value.to && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {getDisplayText()}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-auto p-0" 
        align="start"
        sideOffset={4}
      >
        <div className="flex">
          {/* Left sidebar - Presets */}
          <div className="w-36 border-r bg-muted/30 p-2 space-y-1">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handlePresetClick(preset)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                  selectedPreset === preset.label
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Right side - Calendar and inputs */}
          <div className="p-3">
            {/* Date inputs */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Start</label>
                <Input
                  type="text"
                  placeholder="MM/DD/YYYY"
                  value={startInput}
                  onChange={handleStartInputChange}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">End</label>
                <Input
                  type="text"
                  placeholder="MM/DD/YYYY"
                  value={endInput}
                  onChange={handleEndInputChange}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Two calendars side by side */}
            <Calendar
              mode="range"
              selected={{ from: tempRange.from, to: tempRange.to }}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              className="pointer-events-auto"
            />

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-3 pt-3 border-t">
              <Button variant="ghost" size="sm" onClick={handleClear}>
                Clear
              </Button>
              <Button size="sm" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

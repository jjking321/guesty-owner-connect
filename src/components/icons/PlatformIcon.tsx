import * as React from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AirbnbIcon } from "./AirbnbIcon";
import { VrboIcon } from "./VrboIcon";
import { BookingIcon } from "./BookingIcon";

interface PlatformIconProps {
  platform: string;
  className?: string;
}

/**
 * Unified component that maps platform names to their brand icons.
 * Case-insensitive matching for common variations.
 * Falls back to a generic Building2 icon for unknown platforms.
 */
export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const normalizedPlatform = platform.toLowerCase().trim();

  if (normalizedPlatform === "airbnb") {
    return <AirbnbIcon className={cn("text-[#FF385C]", className)} style={{ color: "#FF385C" }} />;
  }

  if (normalizedPlatform === "vrbo") {
    return <VrboIcon className={className} />;
  }

  if (
    normalizedPlatform === "booking" ||
    normalizedPlatform === "booking.com"
  ) {
    return <BookingIcon className={className} />;
  }

  // Fallback for unknown platforms
  return <Building2 className={cn("text-muted-foreground", className)} />;
}

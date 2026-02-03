import * as React from "react";

import { cn } from "@/lib/utils";

type Props = React.SVGProps<SVGSVGElement> & {
  title?: string;
};

/**
 * Booking.com mark (inline SVG). Uses brand dark blue color.
 */
export function BookingIcon({ className, title = "Booking.com", ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable={false}
      className={cn("inline-block", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <rect width="24" height="24" rx="4" fill="#003580" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="11"
        fontWeight="bold"
        fill="white"
        fontFamily="Arial, sans-serif"
      >
        B.
      </text>
    </svg>
  );
}

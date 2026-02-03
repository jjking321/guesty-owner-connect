import * as React from "react";

import { cn } from "@/lib/utils";

type Props = React.SVGProps<SVGSVGElement> & {
  title?: string;
};

/**
 * VRBO mark (inline SVG). Uses brand blue color.
 */
export function VrboIcon({ className, title = "VRBO", ...props }: Props) {
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
      <path
        fill="#0066CC"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2.5-5.5l2.5 3 2.5-3L17 17H7l2.5-4.5zm2.5-7a2 2 0 100 4 2 2 0 000-4z"
      />
      <text
        x="12"
        y="13"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="5"
        fontWeight="bold"
        fill="#0066CC"
        fontFamily="Arial, sans-serif"
      >
        V
      </text>
    </svg>
  );
}

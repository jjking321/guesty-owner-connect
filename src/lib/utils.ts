import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parse a YYYY-MM-DD date string as a local date (not UTC)
 * This prevents timezone shift issues where "2026-01-17" becomes Jan 16 in US timezones
 */
export function parseLocalDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a date-only string for display without timezone shift
 */
export function formatDateDisplay(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const date = parseLocalDate(dateStr);
  return date ? date.toLocaleDateString() : '';
}

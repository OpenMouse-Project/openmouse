// Shared catalog of ticket categories, statuses and priorities used by the
// ticket creation modal and surfaced in the dashboard.

export const TICKET_CATEGORIES = [
  "Device Not Detected",
  "Firmware",
  "DPI",
  "Polling Rate",
  "Lighting",
  "Compatibility",
  "Crash",
  "Installation",
  "Wireless",
  "Performance",
  "Other",
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const DEFAULT_PRIORITY: TicketPriority = "NORMAL";
export const DEFAULT_STATUS: TicketStatus = "OPEN";

/** Maps a human value from the Discord modal (a select option value) to a priority. */
export function priorityFromValue(value: string): TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(value)
    ? (value as TicketPriority)
    : DEFAULT_PRIORITY;
}

export function isTicketCategory(value: string): value is TicketCategory {
  return (TICKET_CATEGORIES as readonly string[]).includes(value);
}

/** Human labels for the Discord thread embed's status/priority lines. */
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN PROGRESS",
  WAITING_FOR_USER: "WAITING FOR USER",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
};

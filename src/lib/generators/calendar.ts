/** Calendar math for planner pages. Dates are handled in UTC so output never depends on the viewer's time zone. */

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Parse "YYYY-MM" or "YYYY-MM-DD". Returns null for an empty or invalid value (undated planner). */
export function parseStart(value: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value?.trim() ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1));
  return Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1 ? null : d;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Monday-based weekday index (0 = Monday). */
export function mondayIndex(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** The Monday on or before `d`. */
export function startOfWeek(d: Date): Date {
  return addDays(d, -mondayIndex(d));
}

/** Month grid cells: day numbers, or null for padding cells. Always whole weeks. */
export function monthGrid(month: Date): (number | null)[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const lead = mondayIndex(first);
  const days = daysInMonth(first);
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let i = 1; i <= days; i++) cells.push(i);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function shortDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

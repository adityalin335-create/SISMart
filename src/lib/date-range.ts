import { endOfDay, startOfDay } from 'date-fns';
import type { Table } from 'dexie';
import type { DateRange } from '@/components/DateRangeFilter';

export function getDateRangeBounds(range: DateRange) {
  return {
    start: range.from ? startOfDay(range.from) : undefined,
    end: range.to ? endOfDay(range.to) : undefined,
  };
}

export function isDateInRange(date: Date, range: DateRange): boolean {
  const timestamp = date.getTime();
  const { start, end } = getDateRangeBounds(range);
  return (!start || timestamp >= start.getTime()) && (!end || timestamp <= end.getTime());
}

export function formatRetailDate(date: Date, locale = 'id-ID'): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export async function queryDateRange<T extends { date: Date }>(
  table: Table<T, number>,
  range: DateRange,
): Promise<T[]> {
  const { start, end } = getDateRangeBounds(range);
  if (start && end) {
    const records = await table.where('date').between(start, end, true, true).toArray();
    return records.sort((a, b) => b.date.getTime() - a.date.getTime());
  }
  if (start) {
    const records = await table.where('date').aboveOrEqual(start).toArray();
    return records.sort((a, b) => b.date.getTime() - a.date.getTime());
  }
  if (end) return table.where('date').belowOrEqual(end).reverse().toArray();
  return table.orderBy('date').reverse().toArray();
}

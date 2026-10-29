import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type Transaction } from '@/lib/db';
import { formatRetailDate, getDateRangeBounds, queryDateRange } from '@/lib/date-range';

const makeTransaction = (date: Date, receiptNumber: string): Omit<Transaction, 'id'> => ({
  subtotal: 100,
  discountType: null,
  discountValue: 0,
  discountAmount: 0,
  total: 100,
  paymentMethodId: 1,
  paymentAmount: 100,
  change: 0,
  profit: 50,
  date,
  receiptNumber,
  status: 'completed',
  customerName: '',
});

describe('shared date range helpers', () => {
  beforeEach(async () => {
    await db.transactions.clear();
  });

  afterEach(async () => {
    await db.transactions.clear();
  });

  it('uses inclusive local-day bounds and a consistent Indonesian date format', () => {
    const date = new Date(2026, 9, 29);
    const bounds = getDateRangeBounds({ from: date, to: date });

    expect(bounds.start?.getHours()).toBe(0);
    expect(bounds.end?.getHours()).toBe(23);
    expect(formatRetailDate(date)).toBe('29/10/2026');
  });

  it('filters indexed records before returning the selected range', async () => {
    const start = new Date(2026, 9, 29);
    await db.transactions.bulkAdd([
      makeTransaction(new Date(2026, 9, 28, 23, 59), 'TX-BEFORE'),
      makeTransaction(new Date(2026, 9, 29, 0, 0), 'TX-START'),
      makeTransaction(new Date(2026, 9, 29, 23, 59), 'TX-END'),
      makeTransaction(new Date(2026, 9, 30, 0, 0), 'TX-AFTER'),
    ]);

    const records = await queryDateRange(db.transactions, { from: start, to: start });

    expect(records.map(record => record.receiptNumber)).toEqual(['TX-END', 'TX-START']);
  });
});

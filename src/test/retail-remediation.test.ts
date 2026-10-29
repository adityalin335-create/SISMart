import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type Transaction } from '@/lib/db';
import { createSaleWithItems } from '@/lib/sales';
import { hasValidProductAmounts } from '@/lib/product-validation';
import { calculateProductSales } from '@/lib/report-calculations';
import { getStockReportPeriod, getTrackedStockProducts } from '@/lib/stock-report-period';
import { applySaleStockDelta } from '@/lib/stock-movements';

const now = new Date('2026-03-08T12:30:00');

function makeTransaction(receiptNumber: string): Omit<Transaction, 'id'> {
  return {
    subtotal: 100,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    total: 100,
    paymentMethodId: 1,
    paymentAmount: 100,
    change: 0,
    profit: 0,
    date: now,
    receiptNumber,
    status: 'completed',
  };
}

function makeItem(productId: number, quantity = 1) {
  return {
    productId,
    productName: `Product ${productId}`,
    quantity,
    price: 100,
    hpp: 50,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    subtotal: 100 * quantity,
  };
}

async function addProduct(stock: number) {
  return db.products.add({
    name: 'Test Product',
    sku: `TEST-${stock}`,
    categoryId: 1,
    price: 100,
    hpp: 50,
    stock,
    unit: 'pcs',
    createdAt: now,
    updatedAt: now,
    isDeleted: 0,
    deletedAt: null,
  });
}

describe('Retail audit remediation', () => {
  beforeEach(async () => {
    await db.debts.clear();
    await db.stockIns.clear();
    await db.stockOuts.clear();
    await db.transactionItems.clear();
    await db.transactions.clear();
    await db.products.clear();
  });

  afterEach(async () => {
    await db.debts.clear();
    await db.stockIns.clear();
    await db.stockOuts.clear();
    await db.transactionItems.clear();
    await db.transactions.clear();
    await db.products.clear();
  });

  it('prevents a sale deduction from making stock negative', async () => {
    const productId = await addProduct(1);

    await expect(applySaleStockDelta({
      productId,
      delta: 2,
      quantity: 2,
      transactionId: 1,
      referenceNumber: 'TX-NEGATIVE',
      date: now,
    })).rejects.toThrow('Stok Test Product tidak mencukupi');

    expect((await db.products.get(productId))?.stock).toBe(1);
    expect(await db.stockOuts.count()).toBe(0);
  });

  it('rolls back transaction data and stock movements when a sale fails', async () => {
    const productId = await addProduct(2);

    await expect(createSaleWithItems({
      transaction: makeTransaction('TX-ROLLBACK'),
      items: [makeItem(productId), makeItem(productId + 100)],
    })).rejects.toThrow('Produk tidak ditemukan');

    expect(await db.transactions.count()).toBe(0);
    expect(await db.transactionItems.count()).toBe(0);
    expect(await db.stockOuts.count()).toBe(0);
    expect((await db.products.get(productId))?.stock).toBe(2);
  });

  it('allows only one of two concurrent sales to consume the final unit', async () => {
    const productId = await addProduct(1);
    const sale = (receiptNumber: string) => createSaleWithItems({
      transaction: makeTransaction(receiptNumber),
      items: [makeItem(productId)],
    });

    const results = await Promise.allSettled([sale('TX-RACE-1'), sale('TX-RACE-2')]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.products.get(productId))?.stock).toBe(0);
    expect(await db.transactions.count()).toBe(1);
    expect(await db.stockOuts.count()).toBe(1);
  });

  it('rejects negative and non-finite product prices or stock', () => {
    expect(hasValidProductAmounts(0, 0, 0)).toBe(true);
    expect(hasValidProductAmounts(-1, 0, 0)).toBe(false);
    expect(hasValidProductAmounts(1, -1, 0)).toBe(false);
    expect(hasValidProductAmounts(1, 0, -1)).toBe(false);
    expect(hasValidProductAmounts(Number.NaN, 0, 0)).toBe(false);
    expect(hasValidProductAmounts(1, Number.POSITIVE_INFINITY, 0)).toBe(false);
  });

  it('allocates transaction discounts across products for consistent profit totals', () => {
    const transaction = {
      ...makeTransaction('TX-DISCOUNT'),
      id: 1,
      subtotal: 300,
      discountAmount: 30,
      total: 270,
    };
    const items = [
      { ...makeItem(1, 2), id: 1, transactionId: 1, productName: 'Product A', subtotal: 200 },
      { ...makeItem(2), id: 2, transactionId: 1, productName: 'Product B', subtotal: 100 },
    ];

    const summaries = calculateProductSales(items, [transaction]);

    expect(summaries.reduce((sum, item) => sum + item.revenue, 0) - transaction.discountAmount).toBe(transaction.total);
    expect(summaries.reduce((sum, item) => sum + item.profit, 0)).toBe(120);
    expect(summaries.map(item => item.profit)).toEqual([80, 40]);
  });

  it('uses exactly the selected number of inclusive calendar days for stock reports', () => {
    const { start, end } = getStockReportPeriod(now, 7);

    expect(start.toDateString()).toBe(new Date(2026, 2, 2).toDateString());
    expect(start.getHours()).toBe(0);
    expect(end.toDateString()).toBe(now.toDateString());
    expect(end.getHours()).toBe(23);
    expect(getStockReportPeriod(now, 30).start.toDateString()).toBe(new Date(2026, 1, 7).toDateString());
    expect(() => getStockReportPeriod(now, 0)).toThrow('Periode laporan stok tidak valid');
  });

  it('excludes inactive and untracked products from availability summaries', () => {
    const trackedProducts = getTrackedStockProducts([
      { stock: 5, trackStock: true, isDeleted: 0 },
      { stock: 10, trackStock: false, isDeleted: 0 },
      { stock: 3, trackStock: true, isDeleted: 1 },
    ]);

    expect(trackedProducts).toEqual([{ stock: 5, trackStock: true, isDeleted: 0 }]);
  });
});

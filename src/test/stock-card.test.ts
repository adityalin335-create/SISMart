import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getDailyStockCardSummaries, getStockCardMovements } from '@/lib/stock-card';
import { applySaleStockDelta, ensureStockCardHistory } from '@/lib/stock-movements';

describe('Stock Card', () => {
  let productId: number;

  beforeEach(async () => {
    await db.stockIns.clear();
    await db.stockOuts.clear();
    await db.transactionItems.clear();
    await db.transactions.clear();
    await db.receivingItems.clear();
    await db.receivings.clear();
    await db.products.clear();

    productId = await db.products.add({
      name: 'Produk Kartu Stok',
      sku: 'CARD-001',
      categoryId: 1,
      price: 20000,
      hpp: 10000,
      stock: 14,
      unit: 'pcs',
      createdAt: new Date('2026-01-01T00:00:00'),
      updatedAt: new Date('2026-10-06T00:00:00'),
      isDeleted: 0,
      deletedAt: null,
    });

    await db.stockIns.add({
      productId,
      supplierId: 0,
      movementType: 'opening_stock',
      referenceNumber: 'OPENING-CARD-001',
      quantity: 10,
      buyPrice: 10000,
      totalPrice: 100000,
      date: new Date('2026-10-01T00:00:00'),
      notes: 'Opening stock',
    });
    const receivingId = await db.receivings.add({
      receivingNumber: 'RCV-20261002-TEST',
      purchaseOrderId: 1,
      supplierId: 1,
      supplierName: 'Supplier',
      supplierDeliveryNoteNumber: 'SJ-1',
      receivedAt: new Date('2026-10-02T09:00:00'),
      status: 'confirmed',
      notes: '',
      createdByName: 'Pemilik',
      updatedAt: new Date('2026-10-02T09:00:00'),
    });
    await db.stockIns.add({
      productId,
      supplierId: 1,
      receivingId,
      quantity: 5,
      movementType: 'receiving',
      referenceNumber: 'RCV-20261002-TEST',
      buyPrice: 10000,
      totalPrice: 50000,
      date: new Date('2026-10-02T09:00:00'),
      notes: '',
    });
    await db.stockIns.add({
      productId,
      supplierId: 0,
      quantity: 1,
      movementType: 'return',
      referenceNumber: 'RETURN-001',
      buyPrice: 10000,
      totalPrice: 10000,
      date: new Date('2026-10-03T09:00:00'),
      notes: 'Retur pelanggan',
    });
    await db.stockIns.add({
      productId,
      supplierId: 0,
      quantity: 3,
      movementType: 'stock_opname',
      referenceNumber: 'OPNAME-42',
      buyPrice: 10000,
      totalPrice: 30000,
      date: new Date('2026-10-04T09:00:00'),
      notes: 'Adjustment Stock Opname (Sesi #42)',
    });
    await db.stockOuts.add({
      productId,
      quantity: 1,
      movementType: 'stock_adjustment',
      referenceNumber: 'ADJ-001',
      reason: 'adjustment',
      date: new Date('2026-10-05T09:00:00'),
      notes: 'Stok rusak',
    });
    await db.stockOuts.add({
      productId,
      quantity: 2,
      movementType: 'stock_opname',
      referenceNumber: 'OPNAME-43',
      reason: 'opname',
      date: new Date('2026-10-06T09:00:00'),
      notes: 'Adjustment Stock Opname (Sesi #43)',
    });
    const transactionId = await db.transactions.add({
      subtotal: 20000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 20000,
      paymentMethodId: 1,
      paymentAmount: 20000,
      change: 0,
      profit: 0,
      date: new Date('2026-10-07T09:00:00'),
      receiptNumber: 'TX-001',
      status: 'completed',
    });
    await db.transactionItems.add({
      transactionId,
      productId,
      productName: 'Produk Kartu Stok',
      quantity: 2,
      price: 20000,
      hpp: 10000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      subtotal: 40000,
    });
    await db.stockOuts.add({
      productId,
      movementType: 'sale',
      referenceNumber: 'TX-001',
      transactionId,
      quantity: 2,
      reason: 'sales',
      date: new Date('2026-10-07T09:00:00'),
      notes: '',
    });
  });

  afterEach(async () => {
    await db.stockIns.clear();
    await db.stockOuts.clear();
    await db.transactionItems.clear();
    await db.transactions.clear();
    await db.receivingItems.clear();
    await db.receivings.clear();
    await db.products.clear();
  });

  it('shows each supported movement source and reconciles the last balance to current stock', async () => {
    const product = await db.products.get(productId);
    const movements = await getStockCardMovements(product!);

    expect(movements.map(movement => movement.type)).toEqual([
      'opening_stock',
      'receiving',
      'return',
      'stock_opname',
      'stock_adjustment',
      'stock_opname',
      'sale',
    ]);
    expect(movements.map(movement => movement.balance)).toEqual([10, 15, 16, 19, 18, 16, 14]);
    expect(movements[0].referenceNumber).toBe('OPENING-CARD-001');
    expect(movements[1].referenceNumber).toBe('RCV-20261002-TEST');
    expect(movements[3].referenceNumber).toBe('OPNAME-42');
    expect(movements[movements.length - 1]?.balance).toBe(product?.stock);
    expect(movements.reduce((sum, movement) => sum + movement.stockIn - movement.stockOut, 0))
      .toBe(product?.stock);
    const dailySummaries = getDailyStockCardSummaries(movements);
    expect(dailySummaries[dailySummaries.length - 1]?.closingStock).toBe(product?.stock);
  });

  it('records sales as stock movements atomically and does not double-count transaction items', async () => {
    await applySaleStockDelta({
      productId,
      delta: 1,
      quantity: 1,
      transactionId: 900,
      referenceNumber: 'TX-900',
      date: new Date('2026-10-08T09:00:00'),
      createdBy: 4,
    });

    const product = await db.products.get(productId);
    const movements = await getStockCardMovements(product!);
    const newSaleEntries = movements.filter(item => item.referenceNumber === 'TX-900');

    expect(product?.stock).toBe(13);
    expect(newSaleEntries).toHaveLength(1);
    expect(newSaleEntries[0]).toMatchObject({ type: 'sale', stockOut: 1, balance: 13 });
    expect(movements[movements.length - 1]?.balance).toBe(product?.stock);
  });

  it('backfills explicit opening and sales movements once for restored legacy data', async () => {
    await db.stockIns.clear();
    await db.stockOuts.clear();

    await ensureStockCardHistory();
    await ensureStockCardHistory();

    const openingEntries = (await db.stockIns.toArray()).filter(item => item.movementType === 'opening_stock');
    const saleEntries = (await db.stockOuts.toArray()).filter(item => item.movementType === 'sale');
    const product = await db.products.get(productId);
    const movements = await getStockCardMovements(product!);

    expect(openingEntries).toHaveLength(1);
    expect(openingEntries[0].quantity).toBe(16);
    expect(saleEntries).toHaveLength(1);
    expect(movements.map(item => item.balance)).toEqual([16, 14]);
    expect(movements[movements.length - 1]?.balance).toBe(product?.stock);
  });

  it('groups same-day movements and carries each closing balance into the next opening', () => {
    const dayOne = new Date(2026, 9, 1, 9);
    const dayTwo = new Date(2026, 9, 2, 9);
    const dayThree = new Date(2026, 9, 3, 9);
    const daily = getDailyStockCardSummaries([
      { id: 'opening', date: dayOne, referenceNumber: 'OPEN-1', type: 'opening_stock', stockIn: 10, stockOut: 0, balance: 10 },
      { id: 'receive', date: dayTwo, referenceNumber: 'RCV-1', type: 'receiving', stockIn: 5, stockOut: 0, balance: 15 },
      { id: 'sale', date: new Date(2026, 9, 2, 12), referenceNumber: 'TX-1', type: 'sale', stockIn: 0, stockOut: 2, balance: 13 },
      { id: 'return', date: new Date(2026, 9, 2, 13), referenceNumber: 'RET-1', type: 'return', stockIn: 1, stockOut: 0, balance: 14 },
      { id: 'opname', date: new Date(2026, 9, 2, 14), referenceNumber: 'SO-1', type: 'stock_opname', stockIn: 0, stockOut: 1, balance: 13 },
      { id: 'adjustment', date: new Date(2026, 9, 2, 15), referenceNumber: 'ADJ-1', type: 'stock_adjustment', stockIn: 2, stockOut: 0, balance: 15 },
      { id: 'sale-next-day', date: dayThree, referenceNumber: 'TX-2', type: 'sale', stockIn: 0, stockOut: 1, balance: 14 },
    ]);

    expect(daily).toHaveLength(3);
    expect(daily[0]).toMatchObject({ openingStock: 10, closingStock: 10 });
    expect(daily[1]).toMatchObject({
      openingStock: 10,
      receiving: 5,
      sales: 2,
      returns: 1,
      stockOpnameAdjustment: -1,
      reconciliationAdjustment: 2,
      closingStock: 15,
      isConsistent: true,
    });
    expect(daily[1].movements).toHaveLength(5);
    expect(daily[2]).toMatchObject({ openingStock: 15, sales: 1, closingStock: 14 });
    for (const summary of daily) {
      expect(summary.closingStock).toBe(
        summary.openingStock +
          summary.receiving +
          summary.returns +
          summary.stockOpnameAdjustment -
          summary.sales +
          summary.reconciliationAdjustment,
      );
      expect(summary.isConsistent).toBe(true);
    }
  });

  it('reconciles hidden non-opname adjustments into closing stock without exposing a summary column', () => {
    const date = new Date(2026, 9, 1, 9);
    const daily = getDailyStockCardSummaries([
      { id: 'opening', date, referenceNumber: 'OPEN-1', type: 'opening_stock', stockIn: 10, stockOut: 0, balance: 10 },
      { id: 'adjustment', date: new Date(2026, 9, 1, 10), referenceNumber: 'ADJ-1', type: 'stock_adjustment', stockIn: 2, stockOut: 0, balance: 12 },
    ]);

    expect(daily[0]).toMatchObject({
      openingStock: 10,
      receiving: 0,
      sales: 0,
      returns: 0,
      stockOpnameAdjustment: 0,
      reconciliationAdjustment: 2,
      closingStock: 12,
      isConsistent: true,
    });
    expect(daily[0]).not.toHaveProperty('otherAdjustment');
    expect(daily[0].movements.map(movement => movement.referenceNumber)).toEqual(['OPEN-1', 'ADJ-1']);
  });

  it('marks a daily summary invalid when its calculated balance does not match the movement balance', () => {
    const date = new Date(2026, 9, 1, 9);
    const daily = getDailyStockCardSummaries([
      { id: 'opening', date, referenceNumber: 'OPEN-1', type: 'opening_stock', stockIn: 10, stockOut: 0, balance: 10 },
      { id: 'receive', date: new Date(2026, 9, 1, 10), referenceNumber: 'RCV-1', type: 'receiving', stockIn: 5, stockOut: 0, balance: 99 },
    ]);

    expect(daily[0].closingStock).toBe(15);
    expect(daily[0].isConsistent).toBe(false);
  });
});

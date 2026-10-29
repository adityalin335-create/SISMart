import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { completeStockOpname } from '@/lib/stock-opname';

describe('Stock Opname posting', () => {
  let productId: number;
  let opnameId: number;

  beforeEach(async () => {
    await db.stockIns.clear();
    await db.stockOuts.clear();
    await db.stockOpnameItems.clear();
    await db.stockOpnames.clear();
    await db.products.clear();

    productId = await db.products.add({
      name: 'Produk Opname',
      sku: 'OPNAME-001',
      categoryId: 1,
      price: 20000,
      hpp: 10000,
      stock: 10,
      unit: 'pcs',
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeleted: 0,
      deletedAt: null,
    });
    opnameId = await db.stockOpnames.add({
      date: new Date(),
      status: 'draft',
      createdBy: 1,
    });
    await db.stockOpnameItems.add({
      opnameId,
      productId,
      systemStock: 10,
      systemStockUpdatedAt: (await db.products.get(productId))!.updatedAt,
      realStock: 8,
      difference: -2,
    });
  });

  afterEach(async () => {
    await db.stockIns.clear();
    await db.stockOuts.clear();
    await db.stockOpnameItems.clear();
    await db.stockOpnames.clear();
    await db.products.clear();
  });

  it('rejects posting when stock changed during the active count', async () => {
    await db.products.update(productId, { stock: 12 });

    await expect(completeStockOpname(opnameId, 'Final count', 1))
      .rejects.toThrow('berubah selama sesi opname');

    expect((await db.products.get(productId))?.stock).toBe(12);
    expect((await db.stockOpnames.get(opnameId))?.status).toBe('draft');
    expect(await db.stockOuts.count()).toBe(0);
  });

  it('rejects posting when stock moved away and returned to the snapshot balance', async () => {
    const updatedAt = new Date(Date.now() + 1000);
    await db.products.update(productId, { stock: 12, updatedAt });
    await db.products.update(productId, { stock: 10, updatedAt: new Date(updatedAt.getTime() + 1000) });

    await expect(completeStockOpname(opnameId, 'Final count', 1))
      .rejects.toThrow('berubah selama sesi opname');

    expect((await db.stockOpnames.get(opnameId))?.status).toBe('draft');
    expect(await db.stockOuts.count()).toBe(0);
  });

  it('allows non-stock product edits after a current opname snapshot', async () => {
    await db.stockOpnameItems.update(
      (await db.stockOpnameItems.toCollection().first())!.id!,
      { systemStockInId: 0, systemStockOutId: 0 },
    );
    await db.products.update(productId, {
      name: 'Produk Opname Diubah',
      updatedAt: new Date(Date.now() + 1000),
    });

    await expect(completeStockOpname(opnameId, 'Final count', 1)).resolves.toBeUndefined();
    expect((await db.products.get(productId))?.stock).toBe(8);
    expect((await db.stockOpnames.get(opnameId))?.status).toBe('completed');
  });

  it('rejects stock movements after a current opname snapshot even if stock is restored', async () => {
    await db.stockOpnameItems.update(
      (await db.stockOpnameItems.toCollection().first())!.id!,
      { systemStockInId: 0, systemStockOutId: 0 },
    );
    await db.stockOuts.add({
      productId,
      movementType: 'stock_adjustment',
      quantity: 1,
      reason: 'adjustment',
      date: new Date(),
      notes: 'Stock changed during opname',
    });
    await db.products.update(productId, { stock: 10 });

    await expect(completeStockOpname(opnameId, 'Final count', 1))
      .rejects.toThrow('berubah selama sesi opname');
    expect((await db.stockOpnames.get(opnameId))?.status).toBe('draft');
  });

  it('posts a stock opname movement with an explicit reference when the snapshot is current', async () => {
    await completeStockOpname(opnameId, 'Final count', 1);

    expect((await db.products.get(productId))?.stock).toBe(8);
    expect((await db.stockOpnames.get(opnameId))?.status).toBe('completed');
    expect(await db.stockOuts.toArray()).toMatchObject([
      {
        movementType: 'stock_opname',
        referenceNumber: `OPNAME-${opnameId}`,
        quantity: 2,
      },
    ]);
  });
});

import { db } from '@/lib/db';

export async function completeStockOpname(
  opnameId: number,
  notes: string,
  createdBy?: number,
): Promise<void> {
  const now = new Date();
  await db.transaction('rw', [db.products, db.stockOpnames, db.stockOpnameItems, db.stockIns, db.stockOuts], async () => {
    const opname = await db.stockOpnames.get(opnameId);
    if (!opname || opname.status !== 'draft') {
      throw new Error('Sesi stock opname tidak ditemukan atau sudah selesai.');
    }
    const items = await db.stockOpnameItems.where('opnameId').equals(opnameId).toArray();
    if (items.length === 0) throw new Error('Sesi stock opname tidak memiliki produk.');
    const currentProducts = await db.products.bulkGet(items.map(item => item.productId));
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const product = currentProducts[index];
      if (!product) throw new Error('Produk pada sesi stock opname tidak ditemukan.');
      const stockInAfterSnapshot = item.systemStockInId === undefined
        ? undefined
        : await db.stockIns.where('productId').equals(item.productId)
          .filter(movement => movement.id! > item.systemStockInId!)
          .first();
      const stockOutAfterSnapshot = item.systemStockOutId === undefined
        ? undefined
        : await db.stockOuts.where('productId').equals(item.productId)
          .filter(movement => movement.id! > item.systemStockOutId!)
          .first();
      const legacySnapshotChanged = item.systemStockInId === undefined &&
        item.systemStockOutId === undefined &&
        item.systemStockUpdatedAt !== undefined &&
        new Date(product.updatedAt).getTime() !== new Date(item.systemStockUpdatedAt).getTime();
      if (
        product.stock !== item.systemStock ||
        stockInAfterSnapshot !== undefined ||
        stockOutAfterSnapshot !== undefined ||
        legacySnapshotChanged
      ) {
        throw new Error(`Stok ${product.name} berubah selama sesi opname. Batalkan sesi dan mulai ulang sebelum menyimpan.`);
      }
    }

    await db.stockOpnames.update(opnameId, {
      status: 'completed',
      date: now,
      notes: notes.trim() || undefined,
    });

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const difference = item.realStock - item.systemStock;
      await db.products.update(item.productId, { stock: item.realStock, updatedAt: now });
      if (difference > 0) {
        const product = currentProducts[index]!;
        await db.stockIns.add({
          productId: item.productId,
          supplierId: 0,
          movementType: 'stock_opname',
          referenceNumber: `OPNAME-${opnameId}`,
          quantity: difference,
          buyPrice: product.hpp,
          totalPrice: product.hpp * difference,
          date: now,
          notes: `Adjustment Stock Opname (Sesi #${opnameId})`,
          createdBy,
        });
      } else if (difference < 0) {
        await db.stockOuts.add({
          productId: item.productId,
          movementType: 'stock_opname',
          referenceNumber: `OPNAME-${opnameId}`,
          quantity: Math.abs(difference),
          reason: 'opname',
          date: now,
          notes: `Adjustment Stock Opname (Sesi #${opnameId})`,
          createdBy,
        });
      }
    }
  });
}

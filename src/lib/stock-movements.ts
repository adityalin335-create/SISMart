import { db, isStockManaged } from '@/lib/db';

interface SaleMovementInput {
  productId: number;
  quantity: number;
  transactionId: number;
  referenceNumber: string;
  date: Date;
  createdBy?: number;
}

export async function recordSaleStockOut(input: SaleMovementInput): Promise<void> {
  if (input.quantity <= 0) return;
  await db.stockOuts.add({
    productId: input.productId,
    movementType: 'sale',
    referenceNumber: input.referenceNumber,
    transactionId: input.transactionId,
    quantity: input.quantity,
    reason: 'sales',
    date: input.date,
    notes: '',
    createdBy: input.createdBy,
  });
}

export async function recordSaleStockReturn(input: SaleMovementInput): Promise<void> {
  if (input.quantity <= 0) return;
  await db.stockIns.add({
    productId: input.productId,
    supplierId: 0,
    movementType: 'return',
    referenceNumber: input.referenceNumber,
    transactionId: input.transactionId,
    quantity: input.quantity,
    buyPrice: 0,
    totalPrice: 0,
    date: input.date,
    notes: 'Stock returned from sale adjustment',
    createdBy: input.createdBy,
  });
}

export async function applySaleStockDelta(
  input: SaleMovementInput & { delta: number },
): Promise<void> {
  if (input.delta === 0) return;
  if (!Number.isFinite(input.delta)) {
    throw new Error('Perubahan stok penjualan tidak valid.');
  }
  await db.transaction('rw', [db.products, db.stockIns, db.stockOuts], async () => {
    const product = await db.products.get(input.productId);
    if (!product || !isStockManaged(product)) return;
    const newStock = Math.round((product.stock - input.delta) * 1e6) / 1e6;
    if (newStock < 0) {
      throw new Error(`Stok ${product.name} tidak mencukupi. Tersedia ${product.stock}.`);
    }
    await db.products.update(input.productId, {
      stock: newStock,
      updatedAt: input.date,
    });
    const movement = { ...input, quantity: Math.abs(input.delta) };
    if (input.delta > 0) await recordSaleStockOut(movement);
    else await recordSaleStockReturn(movement);
  });
}

export async function ensureStockCardHistory(): Promise<void> {
  await db.transaction('rw', [db.products, db.stockIns, db.stockOuts, db.transactions, db.transactionItems], async () => {
    const products = await db.products.toArray();
    const transactions = await db.transactions.toArray();
    const transactionById = new Map(transactions.map(transaction => [transaction.id, transaction]));
    const items = await db.transactionItems.toArray();
    const stockIns = await db.stockIns.toArray();
    const stockOuts = await db.stockOuts.toArray();
    const recordedSales = new Set(stockOuts
      .filter(movement => movement.transactionId !== undefined &&
        (movement.movementType === 'sale' || movement.reason === 'sales'))
      .map(movement => `${movement.transactionId}:${movement.productId}`));

    for (const item of items) {
      const transaction = transactionById.get(item.transactionId);
      const product = products.find(entry => entry.id === item.productId);
      const saleKey = `${item.transactionId}:${item.productId}`;
      if (!transaction || !product || !isStockManaged(product) || recordedSales.has(saleKey)) continue;
      await db.stockOuts.add({
        productId: item.productId,
        movementType: 'sale',
        referenceNumber: transaction.orderNumber || transaction.receiptNumber,
        transactionId: item.transactionId,
        quantity: item.quantity,
        reason: 'sales',
        date: new Date(transaction.date),
        notes: 'Backfilled sales movement during backup restore',
        createdBy: transaction.createdBy,
      });
      recordedSales.add(saleKey);
    }

    const openingProductIds = new Set([
      ...stockIns.filter(movement => movement.movementType === 'opening_stock').map(movement => movement.productId),
      ...stockOuts.filter(movement => movement.movementType === 'opening_stock').map(movement => movement.productId),
    ]);
    const currentStockIns = await db.stockIns.toArray();
    const currentStockOuts = await db.stockOuts.toArray();
    const inboundByProduct = new Map<number, number>();
    const outboundByProduct = new Map<number, number>();
    for (const movement of currentStockIns) {
      inboundByProduct.set(movement.productId, (inboundByProduct.get(movement.productId) ?? 0) + movement.quantity);
    }
    for (const movement of currentStockOuts) {
      outboundByProduct.set(movement.productId, (outboundByProduct.get(movement.productId) ?? 0) + movement.quantity);
    }

    for (const product of products) {
      if (!product.id || !isStockManaged(product) || openingProductIds.has(product.id)) continue;
      const openingBalance = Math.round((
        product.stock -
        (inboundByProduct.get(product.id) ?? 0) +
        (outboundByProduct.get(product.id) ?? 0)
      ) * 1e6) / 1e6;
      const movement = {
        productId: product.id,
        movementType: 'opening_stock' as const,
        referenceNumber: `OPENING-${product.sku || product.id}`,
        quantity: Math.abs(openingBalance),
        date: new Date(product.createdAt),
        notes: 'Opening balance restored from legacy backup',
      };
      if (openingBalance < 0) {
        await db.stockOuts.add({ ...movement, reason: 'opening_stock' });
      } else {
        await db.stockIns.add({
          ...movement,
          supplierId: 0,
          buyPrice: product.hpp,
          totalPrice: openingBalance * product.hpp,
        });
      }
    }
  });
}

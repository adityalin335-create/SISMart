import {
  db,
  isStockManaged,
  type PurchaseReturn,
  type PurchaseReturnItem,
  type ReturnReason,
  type SalesReturn,
  type SalesReturnCondition,
  type SalesReturnItem,
  type SalesReturnResolution,
} from '@/lib/db';

const roundMoney = (value: number) => Math.round(value);
const makeReturnNumber = (prefix: 'PR' | 'SR') =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

function assertPositiveQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Kuantitas retur harus lebih dari nol.');
}

function itemReturnTotal(item: { totalValue: number }, quantity: number, originalQuantity: number) {
  return roundMoney(item.totalValue * quantity / originalQuantity);
}

export async function getPurchaseReturnableProducts(supplierId: number) {
  const [receivings, receivingItems, returns, returnItems] = await Promise.all([
    db.receivings.where('supplierId').equals(supplierId).toArray(),
    db.receivingItems.toArray(),
    db.purchaseReturns.where('supplierId').equals(supplierId).toArray(),
    db.purchaseReturnItems.toArray(),
  ]);
  const confirmedIds = new Set(receivings.filter(item => item.status === 'confirmed').map(item => item.id!));
  const usedByReceivingItem = new Map<number, number>();
  const returnById = new Map(returns.map(item => [item.id!, item]));
  for (const item of returnItems) {
    const parent = returnById.get(item.purchaseReturnId);
    if (!parent || (parent.status !== 'confirmed' &&
      !(parent.status === 'pending_approval' && !parent.reversalOfId))) continue;
    const direction = parent.status === 'confirmed' && parent.reversalOfId ? -1 : 1;
    usedByReceivingItem.set(item.receivingItemId,
      (usedByReceivingItem.get(item.receivingItemId) ?? 0) + direction * item.quantity);
  }
  const summaries = new Map<number, {
    productId: number;
    productName: string;
    sku: string;
    unit: string;
    availableQuantity: number;
    returnValue: number;
  }>();
  for (const item of receivingItems) {
    if (!confirmedIds.has(item.receivingId)) continue;
    const remaining = item.quantityReceived - item.quantityDamaged - (usedByReceivingItem.get(item.id!) ?? 0);
    if (remaining <= 0) continue;
    const entry = summaries.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      unit: item.unit,
      availableQuantity: 0,
      returnValue: 0,
    };
    entry.availableQuantity += remaining;
    entry.returnValue += remaining * item.actualUnitCost;
    summaries.set(item.productId, entry);
  }
  return [...summaries.values()];
}

async function allocatePurchaseReturnItems(
  supplierId: number,
  quantities: Array<{ productId: number; quantity: number }>,
): Promise<PurchaseReturnItem[]> {
  const receivingHeaders = await db.receivings.where('supplierId').equals(supplierId).toArray();
  const receivingIds = receivingHeaders.filter(header => header.status === 'confirmed').map(header => header.id!);
  const receivedItems = receivingIds.length
    ? await db.receivingItems.where('receivingId').anyOf(receivingIds).toArray()
    : [];
  const allReturns = await db.purchaseReturns.where('supplierId').equals(supplierId).toArray();
  const returnById = new Map(allReturns.map(ret => [ret.id!, ret]));
  const existingItems = (await db.purchaseReturnItems.toArray()).filter(item =>
    (() => {
      const parent = returnById.get(item.purchaseReturnId);
      return parent?.status === 'confirmed' ||
        (parent?.status === 'pending_approval' && !parent.reversalOfId);
    })(),
  );
  const used = new Map<number, number>();
  for (const item of existingItems) {
    const parent = returnById.get(item.purchaseReturnId)!;
    const direction = parent.status === 'confirmed' && parent.reversalOfId ? -1 : 1;
    used.set(item.receivingItemId, (used.get(item.receivingItemId) ?? 0) + direction * item.quantity);
  }

  const allocated: PurchaseReturnItem[] = [];
  for (const request of quantities) {
    assertPositiveQuantity(request.quantity);
    let remaining = request.quantity;
    const sources = receivedItems
      .filter(item => item.productId === request.productId)
      .sort((a, b) => a.receivingId - b.receivingId || (a.id ?? 0) - (b.id ?? 0));
    for (const source of sources) {
      const available = source.quantityReceived - source.quantityDamaged - (used.get(source.id!) ?? 0);
      if (available <= 0) continue;
      const quantity = Math.min(available, remaining);
      allocated.push({
        purchaseReturnId: 0,
        receivingItemId: source.id!,
        receivingId: source.receivingId,
        productId: source.productId,
        productName: source.productName,
        sku: source.sku,
        unit: source.unit,
        quantity,
        unitCost: source.actualUnitCost,
        totalValue: quantity * source.actualUnitCost,
      });
      used.set(source.id!, (used.get(source.id!) ?? 0) + quantity);
      remaining -= quantity;
      if (remaining <= 0) break;
    }
    if (remaining > 0) throw new Error(`Jumlah retur ${request.productId} melebihi jumlah diterima yang masih dapat diretur.`);
  }
  return allocated;
}

async function applyPurchaseReturnStock(items: PurchaseReturnItem[], returnNumber: string, date: Date, createdBy?: number) {
  for (const item of items) {
    const product = await db.products.get(item.productId);
    if (!product) throw new Error(`Produk ${item.productName} tidak ditemukan.`);
    if (!isStockManaged(product)) continue;
    if (product.stock < item.quantity) {
      throw new Error(`Stok ${product.name} tidak cukup untuk retur. Tersedia ${product.stock}.`);
    }
    await db.products.update(product.id!, {
      stock: Math.round((product.stock - item.quantity) * 1e6) / 1e6,
      updatedAt: date,
    });
    await db.stockOuts.add({
      productId: item.productId,
      movementType: 'purchase_return',
      referenceNumber: returnNumber,
      quantity: item.quantity,
      reason: 'purchase_return',
      date,
      notes: `Retur pembelian ${returnNumber}`,
      createdBy,
    });
  }
}

async function applyPurchaseReturnReversalStock(items: PurchaseReturnItem[], returnNumber: string, date: Date, createdBy?: number) {
  for (const item of items) {
    const product = await db.products.get(item.productId);
    if (!product) throw new Error(`Produk ${item.productName} tidak ditemukan.`);
    if (!isStockManaged(product)) continue;
    await db.products.update(product.id!, {
      stock: Math.round((product.stock + item.quantity) * 1e6) / 1e6,
      updatedAt: date,
    });
    await db.stockIns.add({
      productId: item.productId,
      supplierId: 0,
      movementType: 'purchase_return',
      referenceNumber: returnNumber,
      quantity: item.quantity,
      buyPrice: item.unitCost,
      totalPrice: item.totalValue,
      date,
      notes: `Pembalik retur pembelian ${returnNumber}`,
      createdBy,
    });
  }
}

export async function createPurchaseReturn(input: {
  supplierId: number;
  quantities: Array<{ productId: number; quantity: number }>;
  reason: ReturnReason;
  notes?: string;
  createdBy?: number;
  createdByName: string;
}): Promise<number> {
  if (!Number.isSafeInteger(input.supplierId) || input.supplierId <= 0) throw new Error('Supplier tidak valid.');
  if (!input.quantities.length) throw new Error('Pilih minimal satu produk untuk diretur.');
  const uniqueProducts = new Set(input.quantities.map(item => item.productId));
  if (uniqueProducts.size !== input.quantities.length) throw new Error('Produk retur duplikat.');
  const settings = await db.storeSettings.toCollection().first();
  const requiresApproval = settings?.returnApprovalRequired === true;
  const now = new Date();
  return db.transaction('rw', [
    db.purchaseReturns, db.purchaseReturnItems, db.receivings, db.receivingItems,
    db.products, db.stockOuts, db.suppliers,
  ], async () => {
    const supplier = await db.suppliers.get(input.supplierId);
    if (!supplier || supplier.isDeleted) throw new Error('Supplier tidak ditemukan atau tidak aktif.');
    const items = await allocatePurchaseReturnItems(input.supplierId, input.quantities);
    for (const item of items) {
      const product = await db.products.get(item.productId);
      if (product && isStockManaged(product) && product.stock < item.quantity) {
        throw new Error(`Stok ${product.name} tidak cukup untuk retur. Tersedia ${product.stock}.`);
      }
    }
    const returnNumber = makeReturnNumber('PR');
    const record: Omit<PurchaseReturn, 'id'> = {
      returnNumber,
      supplierId: supplier.id!,
      supplierName: supplier.name,
      date: now,
      status: requiresApproval ? 'pending_approval' : 'confirmed',
      reason: input.reason,
      notes: input.notes?.trim() ?? '',
      totalValue: items.reduce((sum, item) => sum + item.totalValue, 0),
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdAt: now,
      ...(!requiresApproval ? { approvedBy: input.createdBy, approvedByName: input.createdByName, approvedAt: now } : {}),
    };
    const id = await db.purchaseReturns.add(record);
    const records = items.map(item => ({ ...item, purchaseReturnId: id }));
    await db.purchaseReturnItems.bulkAdd(records);
    if (!requiresApproval) await applyPurchaseReturnStock(records, returnNumber, now, input.createdBy);
    return id;
  });
}

export async function approvePurchaseReturn(returnId: number, approvedBy?: number, approvedByName = '') {
  const now = new Date();
  await db.transaction('rw', [db.purchaseReturns, db.purchaseReturnItems, db.receivingItems, db.receivings, db.products, db.stockIns, db.stockOuts], async () => {
    const record = await db.purchaseReturns.get(returnId);
    if (!record || record.status !== 'pending_approval') throw new Error('Retur pembelian tidak menunggu persetujuan.');
    const items = await db.purchaseReturnItems.where('purchaseReturnId').equals(returnId).toArray();
    if (record.reversalOfId) {
      const original = await db.purchaseReturns.get(record.reversalOfId);
      if (!original || original.status !== 'confirmed') throw new Error('Retur sumber tidak dapat dibalik.');
      await applyPurchaseReturnReversalStock(items, record.returnNumber, now, record.createdBy);
      await db.purchaseReturns.update(returnId, { status: 'confirmed', approvedBy, approvedByName, approvedAt: now, date: now });
      return;
    }
    const supplierIds = new Set((await db.receivings.bulkGet([...new Set(items.map(item => item.receivingId))]))
      .filter(receiving => receiving?.status === 'confirmed')
      .map(receiving => receiving!.supplierId));
    if (supplierIds.size !== 1 || !supplierIds.has(record.supplierId)) throw new Error('Sumber penerimaan retur tidak valid.');
    const allReturns = await db.purchaseReturns.where('supplierId').equals(record.supplierId).toArray();
    const returnById = new Map(allReturns.map(ret => [ret.id!, ret]));
    const otherReturnItems = (await db.purchaseReturnItems.toArray()).filter(item =>
      item.purchaseReturnId !== returnId && (
        returnById.get(item.purchaseReturnId)?.status === 'confirmed' ||
        (returnById.get(item.purchaseReturnId)?.status === 'pending_approval' && !returnById.get(item.purchaseReturnId)?.reversalOfId)
      ),
    );
    const returnedBySource = new Map<number, number>();
    for (const item of otherReturnItems) {
      const parent = returnById.get(item.purchaseReturnId)!;
      const direction = parent.status === 'confirmed' && parent.reversalOfId ? -1 : 1;
      returnedBySource.set(item.receivingItemId, (returnedBySource.get(item.receivingItemId) ?? 0) + direction * item.quantity);
    }
    for (const item of items) {
      const source = await db.receivingItems.get(item.receivingItemId);
      if (!source || source.receivingId !== item.receivingId ||
        source.quantityReceived - source.quantityDamaged - (returnedBySource.get(source.id!) ?? 0) < item.quantity) {
        throw new Error(`Jumlah retur ${item.productName} telah melebihi jumlah diterima yang tersisa.`);
      }
    }
    await applyPurchaseReturnStock(items, record.returnNumber, now, record.createdBy);
    await db.purchaseReturns.update(returnId, {
      status: 'confirmed',
      approvedBy,
      approvedByName,
      approvedAt: now,
      date: now,
    });
  });
}

export async function reversePurchaseReturn(originalId: number, createdBy?: number, createdByName = ''): Promise<number> {
  const now = new Date();
  const settings = await db.storeSettings.toCollection().first();
  return db.transaction('rw', [db.purchaseReturns, db.purchaseReturnItems, db.products, db.stockIns, db.stockOuts], async () => {
    const original = await db.purchaseReturns.get(originalId);
    if (!original || original.status !== 'confirmed') throw new Error('Hanya retur pembelian terkonfirmasi yang dapat dibalik.');
    if (original.reversalOfId) throw new Error('Dokumen pembalik tidak dapat dibalik kembali.');
    if ((await db.purchaseReturns.where('reversalOfId').equals(originalId).first())) {
      throw new Error('Dokumen pembalik untuk retur ini sudah dibuat.');
    }
    const sourceItems = await db.purchaseReturnItems.where('purchaseReturnId').equals(originalId).toArray();
    const requiresApproval = settings?.returnApprovalRequired === true;
    const returnNumber = makeReturnNumber('PR');
    const reversalId = await db.purchaseReturns.add({
      returnNumber, supplierId: original.supplierId, supplierName: original.supplierName,
      date: now, status: requiresApproval ? 'pending_approval' : 'confirmed',
      reason: original.reason, notes: `Pembalik ${original.returnNumber}${original.notes ? ` · ${original.notes}` : ''}`,
      totalValue: original.totalValue, createdBy, createdByName, createdAt: now, reversalOfId: originalId,
      ...(!requiresApproval ? { approvedBy: createdBy, approvedByName: createdByName, approvedAt: now } : {}),
    });
    const items = sourceItems.map(({ id: _id, ...item }) => ({ ...item, purchaseReturnId: reversalId }));
    await db.purchaseReturnItems.bulkAdd(items);
    if (!requiresApproval) await applyPurchaseReturnReversalStock(items, returnNumber, now, createdBy);
    return reversalId;
  });
}

function getNetSaleValue(item: { subtotal: number; quantity: number }, transaction: { subtotal: number; discountAmount: number }) {
  const transactionDiscount = transaction.subtotal > 0
    ? transaction.discountAmount * item.subtotal / transaction.subtotal
    : 0;
  return Math.max(0, item.subtotal - transactionDiscount);
}

export async function getSalesReturnableItems(transactionId: number) {
  const transaction = await db.transactions.get(transactionId);
  if (!transaction || transaction.status !== 'completed') return [];
  const [items, returns, returnItems] = await Promise.all([
    db.transactionItems.where('transactionId').equals(transactionId).toArray(),
    db.salesReturns.where('transactionId').equals(transactionId).toArray(),
    db.salesReturnItems.toArray(),
  ]);
  const returnById = new Map(returns.map(record => [record.id!, record]));
  const used = new Map<number, number>();
  for (const item of returnItems) {
    const parent = returnById.get(item.salesReturnId);
    if (!parent || (parent.status !== 'confirmed' &&
      !(parent.status === 'pending_approval' && !parent.reversalOfId))) continue;
    const direction = parent.status === 'confirmed' && parent.reversalOfId ? -1 : 1;
    used.set(item.transactionItemId, (used.get(item.transactionItemId) ?? 0) + direction * item.quantity);
  }
  const products = await db.products.bulkGet(items.map(item => item.productId));
  return items.map((item, index) => ({
    transactionItemId: item.id!,
    productId: item.productId,
    productName: item.productName,
    sku: products[index]?.sku ?? '',
    unit: products[index]?.unit ?? 'pcs',
    soldQuantity: item.quantity,
    returnedQuantity: used.get(item.id!) ?? 0,
    availableQuantity: Math.max(0, item.quantity - (used.get(item.id!) ?? 0)),
    unitPrice: item.quantity > 0 ? getNetSaleValue(item, transaction) / item.quantity : 0,
    unitCost: item.hpp,
  })).filter(item => item.availableQuantity > 0);
}

export async function createSalesReturn(input: {
  transactionId: number;
  items: Array<{
    transactionItemId: number;
    quantity: number;
    condition: SalesReturnCondition;
    exchangeProductId?: number;
    exchangeQuantity?: number;
  }>;
  reason: ReturnReason;
  resolution: SalesReturnResolution;
  notes?: string;
  createdBy?: number;
  createdByName: string;
}): Promise<number> {
  if (!input.items.length) throw new Error('Pilih minimal satu item untuk diretur.');
  if (new Set(input.items.map(item => item.transactionItemId)).size !== input.items.length) {
    throw new Error('Item retur duplikat.');
  }
  const now = new Date();
  const settings = await db.storeSettings.toCollection().first();
  const requiresApproval = settings?.returnApprovalRequired === true;
  return db.transaction('rw', [
    db.salesReturns, db.salesReturnItems, db.transactions, db.transactionItems,
    db.products, db.stockIns, db.stockOuts,
  ], async () => {
    const transaction = await db.transactions.get(input.transactionId);
    if (!transaction || transaction.status !== 'completed') throw new Error('Transaksi asal tidak ditemukan atau belum selesai.');
    const returnItems: SalesReturnItem[] = [];
    for (const request of input.items) {
      assertPositiveQuantity(request.quantity);
      const source = await db.transactionItems.get(request.transactionItemId);
      if (!source || source.transactionId !== input.transactionId) throw new Error('Item tidak berasal dari transaksi yang dipilih.');
      const existing = (await db.salesReturnItems.where('transactionItemId').equals(source.id!).toArray())
          .filter(item => item.salesReturnId > 0);
      let usedQuantity = 0;
      for (const previous of existing) {
        const parent = await db.salesReturns.get(previous.salesReturnId);
        if (parent?.status === 'confirmed') usedQuantity += parent.reversalOfId ? -previous.quantity : previous.quantity;
        else if (parent?.status === 'pending_approval' && !parent.reversalOfId) usedQuantity += previous.quantity;
      }
      const remaining = source.quantity - usedQuantity;
      if (request.quantity > remaining) throw new Error(`Jumlah retur ${source.productName} melebihi jumlah terjual yang tersisa (${remaining}).`);
      if (input.resolution === 'exchange' && (!request.exchangeProductId || !request.exchangeQuantity || request.exchangeQuantity <= 0)) {
        throw new Error('Pilih produk dan kuantitas pengganti untuk setiap item retur tukar.');
      }
      const returnAmount = itemReturnTotal({ totalValue: getNetSaleValue(source, transaction) }, request.quantity, source.quantity);
      let exchangeProductName: string | undefined;
      let exchangeValue = 0;
      const replacement = input.resolution === 'exchange'
        ? await db.products.get(request.exchangeProductId!)
        : undefined;
      if (input.resolution === 'exchange') {
        if (!replacement || replacement.isDeleted) throw new Error('Produk pengganti tidak ditemukan atau tidak aktif.');
        exchangeProductName = replacement.name;
        exchangeValue = replacement.price * request.exchangeQuantity!;
        if (exchangeValue > returnAmount) throw new Error('Nilai barang pengganti melebihi nilai retur.');
        const allReturnItems = await db.salesReturnItems.toArray();
        const allParents = await db.salesReturns.toArray();
        const pendingReturnIds = new Set(allParents.filter(parent =>
          parent.status === 'pending_approval' && !parent.reversalOfId,
        ).map(parent => parent.id!));
        const reserved = allReturnItems
          .filter(item => pendingReturnIds.has(item.salesReturnId) && item.exchangeProductId === replacement.id)
          .reduce((sum, item) => sum + (item.exchangeQuantity ?? 0), 0);
        if (isStockManaged(replacement) && replacement.stock - reserved < request.exchangeQuantity!) {
          throw new Error(`Stok produk pengganti ${replacement.name} tidak mencukupi.`);
        }
      }
      returnItems.push({
        salesReturnId: 0,
        transactionItemId: source.id!,
        productId: source.productId,
        productName: source.productName,
        sku: (await db.products.get(source.productId))?.sku ?? '',
        unit: (await db.products.get(source.productId))?.unit ?? 'pcs',
        quantity: request.quantity,
        condition: request.condition,
        unitPrice: source.quantity ? getNetSaleValue(source, transaction) / source.quantity : 0,
        unitCost: source.hpp,
        totalValue: returnAmount,
        exchangeProductId: input.resolution === 'exchange' ? request.exchangeProductId : undefined,
        exchangeProductName,
        exchangeQuantity: input.resolution === 'exchange' ? request.exchangeQuantity : undefined,
        exchangeValue: input.resolution === 'exchange' ? exchangeValue : undefined,
      });
    }
    const totalValue = returnItems.reduce((sum, item) => sum + item.totalValue, 0);
    const overallPriorReturns = await db.salesReturns.where('transactionId').equals(input.transactionId).toArray();
    const confirmedOrPending = new Set(overallPriorReturns
      .filter(record => record.status === 'confirmed' || (record.status === 'pending_approval' && !record.reversalOfId))
      .map(record => record.id!));
    const previousValue = (await db.salesReturnItems.toArray())
      .filter(item => confirmedOrPending.has(item.salesReturnId))
      .reduce((sum, item) => {
        const parent = overallPriorReturns.find(record => record.id === item.salesReturnId);
        return sum + (parent?.reversalOfId && parent.status === 'confirmed' ? -item.totalValue : item.totalValue);
      }, 0);
    if (previousValue + totalValue > transaction.total) throw new Error('Nilai retur melebihi nilai transaksi asal.');

    const refundValue = input.resolution === 'refund'
      ? totalValue
      : Math.max(0, totalValue - returnItems.reduce((sum, item) => sum + (item.exchangeValue ?? 0), 0));
    const returnNumber = makeReturnNumber('SR');
    const record: Omit<SalesReturn, 'id'> = {
      returnNumber,
      transactionId: input.transactionId,
      receiptNumber: transaction.receiptNumber,
      customerId: transaction.customerId,
      customerName: transaction.customerName ?? '',
      date: now,
      status: requiresApproval ? 'pending_approval' : 'confirmed',
      reason: input.reason,
      notes: input.notes?.trim() ?? '',
      resolution: input.resolution,
      totalValue,
      refundValue,
      exchangeValue: returnItems.reduce((sum, item) => sum + (item.exchangeValue ?? 0), 0),
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdAt: now,
      ...(!requiresApproval ? { approvedBy: input.createdBy, approvedByName: input.createdByName, approvedAt: now } : {}),
    };
    const id = await db.salesReturns.add(record);
    const savedItems = returnItems.map(item => ({ ...item, salesReturnId: id }));
    await db.salesReturnItems.bulkAdd(savedItems);
    if (!requiresApproval) await applySalesReturnEffects(id, record, savedItems, now);
    return id;
  });
}

async function applySalesReturnEffects(returnId: number, record: SalesReturn, items: SalesReturnItem[], date: Date) {
  for (const item of items) {
    const product = await db.products.get(item.productId);
    if (item.condition === 'resellable' && product && isStockManaged(product)) {
      await db.products.update(product.id!, { stock: product.stock + item.quantity, updatedAt: date });
      await db.stockIns.add({
        productId: item.productId,
        supplierId: 0,
        movementType: 'sales_return',
        referenceNumber: record.returnNumber,
        transactionId: record.transactionId,
        quantity: item.quantity,
        buyPrice: item.unitCost,
        totalPrice: item.unitCost * item.quantity,
        date,
        notes: `Retur penjualan ${record.returnNumber}`,
        createdBy: record.createdBy,
      });
    }
    if (record.resolution === 'exchange' && item.exchangeProductId && item.exchangeQuantity) {
      const replacement = await db.products.get(item.exchangeProductId);
      if (!replacement || replacement.isDeleted) throw new Error('Produk pengganti tidak ditemukan atau tidak aktif.');
      if (isStockManaged(replacement)) {
        if (replacement.stock < item.exchangeQuantity) throw new Error(`Stok produk pengganti ${replacement.name} tidak mencukupi.`);
        await db.products.update(replacement.id!, { stock: replacement.stock - item.exchangeQuantity, updatedAt: date });
        await db.stockOuts.add({
          productId: replacement.id!,
          movementType: 'exchange',
          referenceNumber: record.returnNumber,
          transactionId: record.transactionId,
          quantity: item.exchangeQuantity,
          reason: 'sales_return_exchange',
          date,
          notes: `Barang pengganti retur ${record.returnNumber}`,
          createdBy: record.createdBy,
        });
      }
    }
  }
  void returnId;
}

export async function approveSalesReturn(returnId: number, approvedBy?: number, approvedByName = '') {
  const now = new Date();
  await db.transaction('rw', [
    db.salesReturns, db.salesReturnItems, db.transactions, db.transactionItems,
    db.products, db.stockIns, db.stockOuts,
  ], async () => {
    const record = await db.salesReturns.get(returnId);
    if (!record || record.status !== 'pending_approval') throw new Error('Retur penjualan tidak menunggu persetujuan.');
    const items = await db.salesReturnItems.where('salesReturnId').equals(returnId).toArray();
    if (record.reversalOfId) {
      const original = await db.salesReturns.get(record.reversalOfId);
      if (!original || original.status !== 'confirmed') throw new Error('Retur sumber tidak dapat dibalik.');
      await applySalesReturnReversalEffects(record, items, now);
      await db.salesReturns.update(returnId, { status: 'confirmed', approvedBy, approvedByName, approvedAt: now, date: now });
      return;
    }
    const allReturns = await db.salesReturns.where('transactionId').equals(record.transactionId).toArray();
    const returnById = new Map(allReturns.map(item => [item.id!, item]));
    const acceptedIds = new Set(allReturns.filter(item => item.id !== returnId && (
      item.status === 'confirmed' || (item.status === 'pending_approval' && !item.reversalOfId)
    )).map(item => item.id!));
    const used = new Map<number, number>();
    for (const item of (await db.salesReturnItems.toArray()).filter(item => acceptedIds.has(item.salesReturnId))) {
      const parent = returnById.get(item.salesReturnId)!;
      const direction = parent.status === 'confirmed' && parent.reversalOfId ? -1 : 1;
      used.set(item.transactionItemId, (used.get(item.transactionItemId) ?? 0) + direction * item.quantity);
    }
    for (const item of items) {
      const source = await db.transactionItems.get(item.transactionItemId);
      if (!source || source.quantity - (used.get(source.id!) ?? 0) < item.quantity) {
        throw new Error(`Jumlah retur ${item.productName} telah melebihi jumlah terjual yang tersisa.`);
      }
    }
    await applySalesReturnEffects(returnId, record, items, now);
    await db.salesReturns.update(returnId, {
      status: 'confirmed',
      approvedBy,
      approvedByName,
      approvedAt: now,
      date: now,
    });
  });
}

async function applySalesReturnReversalEffects(record: SalesReturn, items: SalesReturnItem[], date: Date) {
  for (const item of items) {
    const product = await db.products.get(item.productId);
    if (item.condition === 'resellable' && product && isStockManaged(product)) {
      if (product.stock < item.quantity) throw new Error(`Stok ${product.name} tidak cukup untuk membalik retur.`);
      await db.products.update(product.id!, { stock: product.stock - item.quantity, updatedAt: date });
      await db.stockOuts.add({
        productId: item.productId,
        movementType: 'sales_return',
        referenceNumber: record.returnNumber,
        transactionId: record.transactionId,
        quantity: item.quantity,
        reason: 'sales_return_reversal',
        date,
        notes: `Pembalik retur penjualan ${record.returnNumber}`,
        createdBy: record.createdBy,
      });
    }
    if (item.exchangeProductId && item.exchangeQuantity) {
      const replacement = await db.products.get(item.exchangeProductId);
      if (!replacement || replacement.isDeleted) throw new Error('Produk pengganti tidak ditemukan atau tidak aktif.');
      if (isStockManaged(replacement)) {
        await db.products.update(replacement.id!, { stock: replacement.stock + item.exchangeQuantity, updatedAt: date });
        await db.stockIns.add({
          productId: replacement.id!,
          supplierId: 0,
          movementType: 'exchange',
          referenceNumber: record.returnNumber,
          transactionId: record.transactionId,
          quantity: item.exchangeQuantity,
          buyPrice: replacement.hpp,
          totalPrice: replacement.hpp * item.exchangeQuantity,
          date,
          notes: `Pembalik barang pengganti ${record.returnNumber}`,
          createdBy: record.createdBy,
        });
      }
    }
  }
}

export async function reverseSalesReturn(originalId: number, createdBy?: number, createdByName = ''): Promise<number> {
  const now = new Date();
  const settings = await db.storeSettings.toCollection().first();
  return db.transaction('rw', [
    db.salesReturns, db.salesReturnItems, db.products, db.stockIns, db.stockOuts,
  ], async () => {
    const original = await db.salesReturns.get(originalId);
    if (!original || original.status !== 'confirmed') throw new Error('Hanya retur penjualan terkonfirmasi yang dapat dibalik.');
    if (original.reversalOfId) throw new Error('Dokumen pembalik tidak dapat dibalik kembali.');
    if (await db.salesReturns.where('reversalOfId').equals(originalId).first()) {
      throw new Error('Dokumen pembalik untuk retur ini sudah dibuat.');
    }
    const sourceItems = await db.salesReturnItems.where('salesReturnId').equals(originalId).toArray();
    const requiresApproval = settings?.returnApprovalRequired === true;
    const returnNumber = makeReturnNumber('SR');
    const reversalId = await db.salesReturns.add({
      returnNumber,
      transactionId: original.transactionId,
      receiptNumber: original.receiptNumber,
      customerId: original.customerId,
      customerName: original.customerName,
      date: now,
      status: requiresApproval ? 'pending_approval' : 'confirmed',
      reason: original.reason,
      notes: `Pembalik ${original.returnNumber}${original.notes ? ` · ${original.notes}` : ''}`,
      resolution: original.resolution,
      totalValue: original.totalValue,
      refundValue: original.refundValue,
      exchangeValue: original.exchangeValue,
      createdBy,
      createdByName,
      createdAt: now,
      reversalOfId: originalId,
      ...(!requiresApproval ? { approvedBy: createdBy, approvedByName: createdByName, approvedAt: now } : {}),
    });
    const items = sourceItems.map(({ id: _id, ...item }) => ({ ...item, salesReturnId: reversalId }));
    await db.salesReturnItems.bulkAdd(items);
    if (!requiresApproval) {
      await applySalesReturnReversalEffects(
        { ...original, id: reversalId, returnNumber, createdBy },
        items,
        now,
      );
    }
    return reversalId;
  });
}

export function getReturnReportTotals(
  sales: Array<{ total: number }>,
  purchases: Array<{ totalValue: number }>,
  salesReturns: Array<Pick<SalesReturn, 'status' | 'totalValue' | 'refundValue' | 'exchangeValue' | 'reversalOfId'>>,
  purchaseReturns: Array<Pick<PurchaseReturn, 'status' | 'totalValue'>>,
) {
  const exchangeSales = salesReturns.filter(row => row.status === 'confirmed')
    .reduce((sum, row) => sum + (row.reversalOfId ? -1 : 1) * (row.exchangeValue ?? 0), 0);
  const grossSales = sales.reduce((sum, row) => sum + row.total, 0) + exchangeSales;
  const salesReturnValue = salesReturns.filter(row => row.status === 'confirmed')
    .reduce((sum, row) => sum + (row.reversalOfId ? -row.totalValue : row.totalValue), 0);
  const grossPurchases = purchases.reduce((sum, row) => sum + row.totalValue, 0);
  const purchaseReturnValue = purchaseReturns.filter(row => row.status === 'confirmed')
    .reduce((sum, row) => sum + (row.reversalOfId ? -row.totalValue : row.totalValue), 0);
  return {
    grossSales,
    salesReturns: salesReturnValue,
    netSales: grossSales - salesReturnValue,
    grossPurchases,
    purchaseReturns: purchaseReturnValue,
    netPurchases: grossPurchases - purchaseReturnValue,
  };
}

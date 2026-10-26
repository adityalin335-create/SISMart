import {
  db,
  isStockManaged,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type Receiving,
  type ReceivingItem,
} from '@/lib/db';

export interface ReceivingItemInput {
  purchaseOrderItemId: number;
  quantityReceived: number;
  quantityDamaged: number;
  actualUnitCost: number;
}

export interface SaveReceivingInput {
  purchaseOrderId: number;
  supplierDeliveryNoteNumber: string;
  receivedAt: Date;
  notes: string;
  createdBy?: number;
  createdByName: string;
  items: ReceivingItemInput[];
}

export interface ReceivingFormData {
  order: PurchaseOrder;
  items: Array<PurchaseOrderItem & { receivedToDate: number; remaining: number }>;
}

function newReceivingNumber(date: Date): string {
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' })
    .format(date)
    .replace(/-/g, '');
  return `RCV-${dateKey}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function assertValidQuantity(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} harus berupa angka nol atau lebih.`);
  }
}

async function getConfirmedItemsForOrder(
  purchaseOrderId: number,
): Promise<{ receivingIds: number[]; items: ReceivingItem[] }> {
  const headers = await db.receivings.where('purchaseOrderId').equals(purchaseOrderId).toArray();
  const receivingIds = headers.filter(header => header.status === 'confirmed').map(header => header.id!);
  const items = receivingIds.length
    ? await db.receivingItems.where('receivingId').anyOf(receivingIds).toArray()
    : [];
  return { receivingIds, items };
}

export async function getReceivingFormData(purchaseOrderId: number): Promise<ReceivingFormData | null> {
  const order = await db.purchaseOrders.get(purchaseOrderId);
  if (!order) return null;
  const orderItems = await db.purchaseOrderItems.where('purchaseOrderId').equals(purchaseOrderId).toArray();
  const { items: confirmedItems } = await getConfirmedItemsForOrder(purchaseOrderId);
  const received = new Map<number, number>();
  for (const item of confirmedItems) {
    received.set(item.purchaseOrderItemId, (received.get(item.purchaseOrderItemId) ?? 0) + item.quantityReceived);
  }
  return {
    order,
    items: orderItems.map(item => {
      const receivedToDate = received.get(item.id!) ?? 0;
      return { ...item, receivedToDate, remaining: Math.max(0, item.quantity - receivedToDate) };
    }),
  };
}

export async function saveReceivingDraft(
  input: SaveReceivingInput,
  options: { id?: number } = {},
): Promise<number> {
  if (!Number.isSafeInteger(input.purchaseOrderId) || input.purchaseOrderId <= 0) {
    throw new Error('Purchase Order tidak valid.');
  }
  if (!(input.receivedAt instanceof Date) || Number.isNaN(input.receivedAt.getTime())) {
    throw new Error('Tanggal penerimaan tidak valid.');
  }
  if (input.items.length === 0) throw new Error('Purchase Order tidak memiliki item penerimaan.');

  const duplicateItemIds = new Set(input.items.map(item => item.purchaseOrderItemId));
  if (duplicateItemIds.size !== input.items.length) {
    throw new Error('Item Purchase Order tidak boleh dicatat lebih dari sekali.');
  }
  for (const item of input.items) {
    assertValidQuantity(item.quantityReceived, 'Kuantitas diterima');
    assertValidQuantity(item.quantityDamaged, 'Kuantitas rusak');
    if (item.quantityDamaged > item.quantityReceived) {
      throw new Error('Kuantitas rusak tidak boleh melebihi kuantitas diterima.');
    }
    if (!Number.isFinite(item.actualUnitCost) || item.actualUnitCost < 0) {
      throw new Error('Biaya beli aktual tidak valid.');
    }
  }

  return db.transaction('rw', [db.receivings, db.receivingItems, db.purchaseOrders, db.purchaseOrderItems], async () => {
    const order = await db.purchaseOrders.get(input.purchaseOrderId);
    if (!order || !['submitted', 'partially_received'].includes(order.status)) {
      throw new Error('Receiving hanya dapat dibuat dari PO yang sudah diajukan dan masih terbuka.');
    }
    const orderItems = await db.purchaseOrderItems.where('purchaseOrderId').equals(order.id!).toArray();
    const orderItemById = new Map(orderItems.map(item => [item.id!, item]));
    if (input.items.some(item => !orderItemById.has(item.purchaseOrderItemId))) {
      throw new Error('Item receiving tidak sesuai dengan Purchase Order.');
    }
    const confirmed = await getConfirmedItemsForOrder(order.id!);
    const receivedTotals = new Map<number, number>();
    for (const item of confirmed.items) {
      receivedTotals.set(item.purchaseOrderItemId, (receivedTotals.get(item.purchaseOrderItemId) ?? 0) + item.quantityReceived);
    }
    for (const item of input.items) {
      const orderItem = orderItemById.get(item.purchaseOrderItemId)!;
      const remaining = orderItem.quantity - (receivedTotals.get(item.purchaseOrderItemId) ?? 0);
      if (item.quantityReceived > remaining) {
        throw new Error(`Kuantitas ${orderItem.productName} melebihi sisa PO (${Math.max(remaining, 0)} ${orderItem.unit}).`);
      }
    }

    const id = options.id;
    const existing = id === undefined ? undefined : await db.receivings.get(id);
    if (id !== undefined && (!existing || existing.status !== 'draft')) {
      throw new Error('Receiving tidak ditemukan atau sudah dikonfirmasi.');
    }
    if (existing && existing.purchaseOrderId !== order.id) {
      throw new Error('Purchase Order pada draft receiving tidak dapat diubah.');
    }

    const now = new Date();
    const record: Receiving = {
      ...(existing ?? {}),
      receivingNumber: existing?.receivingNumber ?? newReceivingNumber(input.receivedAt),
      purchaseOrderId: order.id!,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      supplierDeliveryNoteNumber: input.supplierDeliveryNoteNumber.trim(),
      receivedAt: input.receivedAt,
      status: 'draft',
      notes: input.notes.trim(),
      createdBy: existing?.createdBy ?? input.createdBy,
      createdByName: existing?.createdByName ?? input.createdByName,
      updatedAt: now,
      syncedAt: null,
    };
    const receivingId = existing ? id! : await db.receivings.add(record);
    if (existing) await db.receivings.put({ ...record, id: receivingId });
    await db.receivingItems.where('receivingId').equals(receivingId).delete();
    await db.receivingItems.bulkAdd(input.items.map(item => {
      const poItem = orderItemById.get(item.purchaseOrderItemId)!;
      return {
        receivingId,
        purchaseOrderItemId: poItem.id!,
        productId: poItem.productId,
        productName: poItem.productName,
        sku: poItem.sku,
        unit: poItem.unit,
        quantityReceived: item.quantityReceived,
        quantityDamaged: item.quantityDamaged,
        actualUnitCost: item.actualUnitCost,
      };
    }));
    return receivingId;
  });
}

export async function confirmReceiving(
  receivingId: number,
  confirmedBy?: number,
  confirmedByName = '',
): Promise<void> {
  await db.transaction(
    'rw',
    [db.receivings, db.receivingItems, db.purchaseOrders, db.purchaseOrderItems, db.products, db.hppHistory, db.stockIns],
    async () => {
      const receiving = await db.receivings.get(receivingId);
      if (!receiving || receiving.status !== 'draft') {
        throw new Error('Receiving tidak ditemukan atau sudah dikonfirmasi.');
      }
      if (!receiving.supplierDeliveryNoteNumber.trim()) {
        throw new Error('Nomor surat jalan supplier wajib diisi sebelum konfirmasi.');
      }
      const order = await db.purchaseOrders.get(receiving.purchaseOrderId);
      if (!order || !['submitted', 'partially_received'].includes(order.status)) {
        throw new Error('Purchase Order tidak lagi dapat menerima barang.');
      }
      const orderItems = await db.purchaseOrderItems.where('purchaseOrderId').equals(order.id!).toArray();
      const orderItemById = new Map(orderItems.map(item => [item.id!, item]));
      const items = await db.receivingItems.where('receivingId').equals(receivingId).toArray();
      if (!items.some(item => item.quantityReceived > 0)) {
        throw new Error('Minimal satu item harus memiliki kuantitas diterima lebih dari nol.');
      }

      const confirmed = await getConfirmedItemsForOrder(order.id!);
      const receivedTotals = new Map<number, number>();
      for (const item of confirmed.items) {
        receivedTotals.set(item.purchaseOrderItemId, (receivedTotals.get(item.purchaseOrderItemId) ?? 0) + item.quantityReceived);
      }

      for (const item of items) {
        assertValidQuantity(item.quantityReceived, 'Kuantitas diterima');
        assertValidQuantity(item.quantityDamaged, 'Kuantitas rusak');
        if (item.quantityDamaged > item.quantityReceived) {
          throw new Error('Kuantitas rusak tidak boleh melebihi kuantitas diterima.');
        }
        if (!Number.isFinite(item.actualUnitCost) || item.actualUnitCost < 0) {
          throw new Error('Biaya beli aktual tidak valid.');
        }
        const poItem = orderItemById.get(item.purchaseOrderItemId);
        if (!poItem || poItem.productId !== item.productId) {
          throw new Error('Item receiving tidak sesuai dengan Purchase Order.');
        }
        const remaining = poItem.quantity - (receivedTotals.get(item.purchaseOrderItemId) ?? 0);
        if (item.quantityReceived > remaining) {
          throw new Error(`Kuantitas ${poItem.productName} melebihi sisa PO (${Math.max(remaining, 0)} ${poItem.unit}).`);
        }

        const quantityAccepted = item.quantityReceived - item.quantityDamaged;
        if (quantityAccepted <= 0) continue;
        const product = await db.products.get(item.productId);
        if (!product || product.isDeleted) {
          throw new Error(`Produk ${item.productName} tidak ditemukan atau sudah tidak aktif.`);
        }
        if (!isStockManaged(product)) continue;

        const oldStock = product.stock;
        const newStock = Math.round((oldStock + quantityAccepted) * 1e6) / 1e6;
        const newHpp = newStock > 0
          ? Math.round(((oldStock * product.hpp) + (quantityAccepted * item.actualUnitCost)) / newStock)
          : item.actualUnitCost;
        const now = new Date();
        await db.hppHistory.add({
          productId: product.id!,
          oldHpp: product.hpp,
          newHpp,
          source: 'receiving',
          date: now,
        });
        await db.stockIns.add({
          productId: product.id!,
          supplierId: receiving.supplierId,
          receivingId,
          movementType: 'receiving',
          referenceNumber: receiving.receivingNumber,
          quantity: quantityAccepted,
          buyPrice: item.actualUnitCost,
          totalPrice: quantityAccepted * item.actualUnitCost,
          date: receiving.receivedAt,
          notes: `Receiving ${receiving.receivingNumber}`,
          createdBy: receiving.createdBy,
        });
        await db.products.update(product.id!, { stock: newStock, hpp: newHpp, updatedAt: now });
      }

      const receivedAfterConfirmation = new Map(receivedTotals);
      for (const item of items) {
        receivedAfterConfirmation.set(
          item.purchaseOrderItemId,
          (receivedAfterConfirmation.get(item.purchaseOrderItemId) ?? 0) + item.quantityReceived,
        );
      }
      const fullyReceived = orderItems.every(item =>
        (receivedAfterConfirmation.get(item.id!) ?? 0) >= item.quantity,
      );
      const hasReceived = [...receivedAfterConfirmation.values()].some(quantity => quantity > 0);
      const now = new Date();
      await db.receivings.update(receivingId, {
        status: 'confirmed',
        confirmedBy,
        confirmedByName,
        confirmedAt: now,
        updatedAt: now,
        syncedAt: null,
      });
      await db.purchaseOrders.update(order.id!, {
        status: fullyReceived ? 'received' : hasReceived ? 'partially_received' : 'submitted',
        updatedAt: now,
        syncedAt: null,
      });
    },
  );
}

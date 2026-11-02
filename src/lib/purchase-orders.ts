import {
  db,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseOrderStatus,
} from '@/lib/db';
import { generateUuid } from '@/lib/uuid';

export interface PurchaseOrderItemInput {
  productId: number;
  quantity: number;
  unitCost: number;
}

export interface SavePurchaseOrderInput {
  supplierId: number;
  orderDate: Date;
  expectedDate?: Date;
  notes: string;
  items: PurchaseOrderItemInput[];
  createdBy?: number;
  createdByName: string;
}

function getIndonesiaDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

export async function savePurchaseOrder(
  input: SavePurchaseOrderInput,
  options: { id?: number; submit?: boolean } = {},
): Promise<number> {
  const { id, submit = false } = options;
  const uniqueProductIds = new Set(input.items.map(item => item.productId));

  if (!Number.isInteger(input.supplierId) || input.supplierId <= 0) {
    throw new Error('Supplier PO tidak valid.');
  }
  if (!(input.orderDate instanceof Date) || Number.isNaN(input.orderDate.getTime())) {
    throw new Error('Tanggal PO tidak valid.');
  }
  if (input.expectedDate && Number.isNaN(input.expectedDate.getTime())) {
    throw new Error('Tanggal perkiraan barang datang tidak valid.');
  }
  if (input.expectedDate && getIndonesiaDateKey(input.expectedDate) < getIndonesiaDateKey(input.orderDate)) {
    throw new Error('Tanggal perkiraan barang datang tidak boleh sebelum tanggal PO.');
  }
  if (input.items.length === 0) {
    throw new Error('Tambahkan minimal satu barang ke PO.');
  }
  if (uniqueProductIds.size !== input.items.length) {
    throw new Error('Barang yang sama tidak boleh ditambahkan lebih dari sekali.');
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.productId) || item.productId <= 0) {
      throw new Error('Barang PO tidak valid.');
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error('Kuantitas harus lebih besar dari nol.');
    }
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) {
      throw new Error('Harga beli tidak valid.');
    }
  }

  const now = new Date();
  const dateKey = getIndonesiaDateKey(input.orderDate);
  const newPoNumber = `PO-${dateKey}-${generateUuid().slice(0, 8).toUpperCase()}`;

  return db.transaction('rw', [db.purchaseOrders, db.purchaseOrderItems, db.suppliers, db.products], async () => {
    const supplier = await db.suppliers.get(input.supplierId);
    if (!supplier || supplier.isDeleted) {
      throw new Error('Supplier tidak ditemukan atau sudah tidak aktif.');
    }

    const products = await db.products.bulkGet(input.items.map(item => item.productId));
    if (products.some(product => !product || product.isDeleted)) {
      throw new Error('Satu atau lebih barang tidak ditemukan atau sudah tidak aktif.');
    }

    const existing = id === undefined ? undefined : await db.purchaseOrders.get(id);
    if (id !== undefined && !existing) {
      throw new Error('Purchase Order tidak ditemukan.');
    }
    if (existing && existing.status !== 'draft') {
      throw new Error('Hanya PO berstatus draft yang dapat diubah.');
    }

    const productById = new Map(products.filter(Boolean).map(product => [product!.id!, product!]));
    const items: Omit<PurchaseOrderItem, 'id'>[] = input.items.map(item => {
      const product = productById.get(item.productId)!;
      return {
        purchaseOrderId: id ?? 0,
        productId: product.id!,
        productName: product.name,
        sku: product.sku,
        unit: product.unit,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal: item.quantity * item.unitCost,
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    if (!Number.isFinite(subtotal)) {
      throw new Error('Total PO melebihi batas nilai yang dapat diproses.');
    }

    const status: PurchaseOrderStatus = submit ? 'submitted' : 'draft';
    const record: PurchaseOrder = {
      ...(existing ?? {}),
      poNumber: existing?.poNumber ?? newPoNumber,
      supplierId: supplier.id!,
      supplierName: supplier.name,
      supplierPhone: supplier.phone,
      status,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate,
      notes: input.notes.trim(),
      subtotal,
      createdBy: existing?.createdBy ?? input.createdBy,
      createdByName: existing?.createdByName ?? input.createdByName,
      submittedAt: submit ? (existing?.submittedAt ?? now) : existing?.submittedAt,
      updatedAt: now,
      syncedAt: null,
    };

    let purchaseOrderId = id;
    if (purchaseOrderId === undefined) {
      purchaseOrderId = await db.purchaseOrders.add(record);
    } else {
      await db.purchaseOrders.put({ ...record, id: purchaseOrderId });
      await db.purchaseOrderItems.where('purchaseOrderId').equals(purchaseOrderId).delete();
    }

    await db.purchaseOrderItems.bulkAdd(
      items.map(item => ({ ...item, purchaseOrderId: purchaseOrderId! })),
    );
    return purchaseOrderId;
  });
}

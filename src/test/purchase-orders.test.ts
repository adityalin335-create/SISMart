import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { savePurchaseOrder } from '@/lib/purchase-orders';
import { buildBackupData, restoreFromBackupData } from '@/lib/backup';

describe('Purchase Orders', () => {
  let supplierId: number;
  let productId: number;

  beforeEach(async () => {
    await db.purchaseOrderItems.clear();
    await db.purchaseOrders.clear();
    await db.products.clear();
    await db.suppliers.clear();

    supplierId = await db.suppliers.add({
      name: 'Supplier Test',
      phone: '08123456789',
      address: '',
      notes: '',
      createdAt: new Date(),
      isDeleted: 0,
      deletedAt: null,
    });
    productId = await db.products.add({
      name: 'Produk Test',
      sku: 'PO-TEST-001',
      categoryId: 1,
      price: 15000,
      hpp: 9000,
      stock: 5,
      unit: 'pcs',
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeleted: 0,
      deletedAt: null,
    });
  });

  afterEach(async () => {
    await db.purchaseOrderItems.clear();
    await db.purchaseOrders.clear();
    await db.products.clear();
    await db.suppliers.clear();
  });

  const input = () => ({
    supplierId,
    orderDate: new Date('2026-10-26T00:00:00'),
    notes: 'Pesanan mingguan',
    items: [{ productId, quantity: 3, unitCost: 8000 }],
    createdByName: 'Pemilik',
  });

  it('saves a draft PO and its item atomically', async () => {
    const id = await savePurchaseOrder(input());
    const order = await db.purchaseOrders.get(id);
    const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(id).toArray();

    expect(order?.status).toBe('draft');
    expect(order?.poNumber).toMatch(/^PO-\d{8}-[A-F0-9]{8}$/);
    expect(order?.supplierName).toBe('Supplier Test');
    expect(order?.subtotal).toBe(24000);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productId,
      productName: 'Produk Test',
      quantity: 3,
      unitCost: 8000,
      lineTotal: 24000,
    });
  });

  it('submits a PO and prevents editing it afterward', async () => {
    const id = await savePurchaseOrder(input(), { submit: true });
    expect((await db.purchaseOrders.get(id))?.status).toBe('submitted');
    await expect(savePurchaseOrder(input(), { id })).rejects.toThrow('Hanya PO berstatus draft yang dapat diubah.');
  });

  it('updates a draft and replaces its items without changing its number', async () => {
    const id = await savePurchaseOrder(input());
    const initialOrder = await db.purchaseOrders.get(id);
    await savePurchaseOrder({
      ...input(),
      items: [{ productId, quantity: 5, unitCost: 7500 }],
    }, { id });

    const updatedOrder = await db.purchaseOrders.get(id);
    const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(id).toArray();
    expect(updatedOrder?.poNumber).toBe(initialOrder?.poNumber);
    expect(updatedOrder?.subtotal).toBe(37500);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });

  it('rejects invalid quantities and inactive suppliers', async () => {
    await expect(savePurchaseOrder({
      ...input(),
      items: [{ productId, quantity: 0, unitCost: 8000 }],
    })).rejects.toThrow('Kuantitas harus lebih besar dari nol.');

    await db.suppliers.update(supplierId, { isDeleted: 1 });
    await expect(savePurchaseOrder(input())).rejects.toThrow('Supplier tidak ditemukan atau sudah tidak aktif.');
  });

  it('rejects expected delivery dates earlier than the PO date', async () => {
    await expect(savePurchaseOrder({
      ...input(),
      expectedDate: new Date('2026-10-25T00:00:00+07:00'),
    })).rejects.toThrow('Tanggal perkiraan barang datang tidak boleh sebelum tanggal PO.');
  });

  it('uses the Indonesia local date in the PO number', async () => {
    const id = await savePurchaseOrder({
      ...input(),
      orderDate: new Date('2026-10-25T17:00:00.000Z'),
    });
    const order = await db.purchaseOrders.get(id);

    expect(order?.poNumber).toMatch(/^PO-20261026-[A-F0-9]{8}$/);
  });

  it('includes purchase orders in backup and restores their dates', async () => {
    await savePurchaseOrder(input(), { submit: true });
    const backup = await buildBackupData();
    await db.purchaseOrderItems.clear();
    await db.purchaseOrders.clear();

    await restoreFromBackupData(backup);
    const restoredOrder = await db.purchaseOrders.toCollection().first();
    const restoredItem = await db.purchaseOrderItems.toCollection().first();
    expect(restoredOrder?.status).toBe('submitted');
    expect(restoredOrder?.orderDate).toBeInstanceOf(Date);
    expect(restoredOrder?.submittedAt).toBeInstanceOf(Date);
    expect(restoredItem?.productName).toBe('Produk Test');
  });
});

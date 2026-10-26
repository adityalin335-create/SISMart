import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { savePurchaseOrder } from '@/lib/purchase-orders';
import { confirmReceiving, saveReceivingDraft } from '@/lib/receivings';
import { buildBackupData, restoreFromBackupData } from '@/lib/backup';

describe('Receiving', () => {
  let supplierId: number;
  let productId: number;
  let purchaseOrderId: number;
  let purchaseOrderItemId: number;

  beforeEach(async () => {
    await db.receivingItems.clear();
    await db.receivings.clear();
    await db.purchaseOrderItems.clear();
    await db.purchaseOrders.clear();
    await db.hppHistory.clear();
    await db.stockIns.clear();
    await db.products.clear();
    await db.suppliers.clear();

    supplierId = await db.suppliers.add({
      name: 'Supplier Receiving Test',
      phone: '',
      address: '',
      notes: '',
      createdAt: new Date(),
      isDeleted: 0,
      deletedAt: null,
    });
    productId = await db.products.add({
      name: 'Produk Receiving Test',
      sku: 'RCV-TEST-001',
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
    purchaseOrderId = await savePurchaseOrder({
      supplierId,
      orderDate: new Date('2026-10-26T00:00:00'),
      notes: '',
      items: [{ productId, quantity: 5, unitCost: 8000 }],
      createdByName: 'Pemilik',
    }, { submit: true });
    const orderItem = await db.purchaseOrderItems.where('purchaseOrderId').equals(purchaseOrderId).first();
    purchaseOrderItemId = orderItem!.id!;
  });

  afterEach(async () => {
    await db.receivingItems.clear();
    await db.receivings.clear();
    await db.purchaseOrderItems.clear();
    await db.purchaseOrders.clear();
    await db.hppHistory.clear();
    await db.stockIns.clear();
    await db.products.clear();
    await db.suppliers.clear();
  });

  const input = (quantityReceived: number, quantityDamaged = 0) => ({
    purchaseOrderId,
    supplierDeliveryNoteNumber: 'SJ-001',
    receivedAt: new Date('2026-10-26T00:00:00'),
    notes: '',
    createdByName: 'Pemilik',
    items: [{
      purchaseOrderItemId,
      quantityReceived,
      quantityDamaged,
      actualUnitCost: 8000,
    }],
  });

  it('keeps draft stock unchanged and updates stock only after confirmation', async () => {
    const id = await saveReceivingDraft(input(2, 1));

    expect((await db.receivings.get(id))?.status).toBe('draft');
    expect((await db.products.get(productId))?.stock).toBe(5);
    expect((await db.purchaseOrders.get(purchaseOrderId))?.status).toBe('submitted');

    await confirmReceiving(id, 7, 'Pemilik');

    expect((await db.receivings.get(id))?.status).toBe('confirmed');
    expect((await db.products.get(productId))?.stock).toBe(6);
    expect((await db.products.get(productId))?.hpp).toBe(8833);
    expect((await db.purchaseOrders.get(purchaseOrderId))?.status).toBe('partially_received');
    expect((await db.hppHistory.toArray()).filter(entry => entry.source === 'receiving')).toHaveLength(1);
    expect(await db.stockIns.where('receivingId').equals(id).toArray()).toMatchObject([
      { quantity: 1, buyPrice: 8000, totalPrice: 8000 },
    ]);
  });

  it('supports completing a PO with a later full receipt', async () => {
    const partialId = await saveReceivingDraft(input(2));
    await confirmReceiving(partialId);

    const finalId = await saveReceivingDraft(input(3));
    await confirmReceiving(finalId);

    expect((await db.products.get(productId))?.stock).toBe(10);
    expect((await db.purchaseOrders.get(purchaseOrderId))?.status).toBe('received');
  });

  it('rejects receiving quantities above the remaining PO quantity', async () => {
    await expect(saveReceivingDraft(input(6))).rejects.toThrow('melebihi sisa PO');

    const validDraft = await saveReceivingDraft(input(4));
    const competingDraft = await saveReceivingDraft(input(2));
    await confirmReceiving(validDraft);
    await expect(confirmReceiving(competingDraft)).rejects.toThrow('melebihi sisa PO');

    expect((await db.products.get(productId))?.stock).toBe(9);
    expect((await db.receivings.get(competingDraft))?.status).toBe('draft');
  });

  it('rejects damaged quantity above quantity received', async () => {
    await expect(saveReceivingDraft(input(1, 2))).rejects.toThrow(
      'Kuantitas rusak tidak boleh melebihi kuantitas diterima.',
    );
  });

  it('includes receiving history in backup and restores date fields', async () => {
    await saveReceivingDraft(input(2));
    const backup = await buildBackupData();
    await db.receivings.clear();
    await db.receivingItems.clear();

    await restoreFromBackupData(backup);

    const receiving = await db.receivings.toCollection().first();
    expect(receiving?.receivedAt).toBeInstanceOf(Date);
    expect(await db.receivingItems.count()).toBe(1);
  });
});

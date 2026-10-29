import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { db, type Transaction } from '@/lib/db';
import {
  approvePurchaseReturn,
  approveSalesReturn,
  createPurchaseReturn,
  createSalesReturn,
  getReturnReportTotals,
  reversePurchaseReturn,
  reverseSalesReturn,
} from '@/lib/returns';
import { getDailyStockCardSummaries, getStockCardMovements } from '@/lib/stock-card';
import { applySaleStockDelta } from '@/lib/stock-movements';
import ReturnPrint, { type ReturnPrintData } from '@/components/ReturnPrint';

const date = new Date('2026-10-29T10:00:00');

async function resetTables() {
  await Promise.all([
    db.purchaseReturnItems.clear(), db.purchaseReturns.clear(),
    db.salesReturnItems.clear(), db.salesReturns.clear(),
    db.stockIns.clear(), db.stockOuts.clear(), db.receivingItems.clear(),
    db.receivings.clear(), db.transactionItems.clear(), db.transactions.clear(),
    db.products.clear(), db.suppliers.clear(), db.storeSettings.clear(),
  ]);
}

async function createProduct(name: string, stock: number, price = 100, hpp = 40) {
  return db.products.add({
    name, sku: name.replaceAll(' ', '').toUpperCase(), categoryId: 1, price, hpp,
    stock, unit: 'pcs', createdAt: date, updatedAt: date, isDeleted: 0, deletedAt: null,
  });
}

async function createReceiving(productId: number, quantity: number, unitCost = 40) {
  const supplierId = (await db.suppliers.toCollection().first())?.id ??
    await db.suppliers.add({ name: 'Supplier A', phone: '', address: '', notes: '', createdAt: date, isDeleted: 0, deletedAt: null });
  const receivingId = await db.receivings.add({
    receivingNumber: 'RCV-001', purchaseOrderId: 1, supplierId, supplierName: 'Supplier A',
    supplierDeliveryNoteNumber: 'SJ-1', receivedAt: date, status: 'confirmed', notes: '',
    createdBy: 1, createdByName: 'Owner', confirmedBy: 1, confirmedByName: 'Owner', confirmedAt: date, updatedAt: date,
  });
  const receivingItemId = await db.receivingItems.add({
    receivingId, purchaseOrderItemId: 1, productId, productName: (await db.products.get(productId))!.name,
    sku: (await db.products.get(productId))!.sku, unit: 'pcs', quantityReceived: quantity,
    quantityDamaged: 0, actualUnitCost: unitCost,
  });
  return { supplierId, receivingId, receivingItemId };
}

async function createTransaction(productId: number, quantity: number): Promise<number> {
  const transaction: Omit<Transaction, 'id'> = {
    subtotal: quantity * 100, discountType: null, discountValue: 0, discountAmount: 0,
    total: quantity * 100, paymentMethodId: 1, paymentAmount: quantity * 100,
    change: 0, profit: quantity * 60, date, receiptNumber: 'TX-001', status: 'completed',
    customerName: 'Customer A',
  };
  const transactionId = await db.transactions.add(transaction);
  await db.transactionItems.add({
    transactionId, productId, productName: (await db.products.get(productId))!.name,
    quantity, price: 100, hpp: 40, discountType: null, discountValue: 0,
    discountAmount: 0, subtotal: quantity * 100,
  });
  return transactionId;
}

const purchaseInput = (supplierId: number, productId: number, quantity: number) => ({
  supplierId, quantities: [{ productId, quantity }], reason: 'damaged' as const,
  notes: 'Kemasan rusak', createdBy: 4, createdByName: 'Staff',
});

const salesInput = (transactionId: number, transactionItemId: number, quantity: number) => ({
  transactionId, items: [{ transactionItemId, quantity, condition: 'resellable' as const }],
  reason: 'quality' as const, resolution: 'refund' as const, notes: 'Retur pelanggan',
  createdBy: 5, createdByName: 'Kasir',
});

describe('Return management', () => {
  beforeEach(resetTables);
  afterEach(async () => {
    cleanup();
    await resetTables();
  });

  it('supports partial purchase returns and then a full return of the remaining received quantity', async () => {
    const productId = await createProduct('Susu UHT', 10);
    const { supplierId } = await createReceiving(productId, 5);

    await createPurchaseReturn(purchaseInput(supplierId, productId, 2));
    expect((await db.products.get(productId))?.stock).toBe(8);
    expect((await db.purchaseReturnItems.toArray()).reduce((sum, item) => sum + item.quantity, 0)).toBe(2);
    await createPurchaseReturn(purchaseInput(supplierId, productId, 3));

    expect((await db.products.get(productId))?.stock).toBe(5);
    expect((await db.purchaseReturns.toArray()).map(item => item.status)).toEqual(['confirmed', 'confirmed']);
    expect((await db.purchaseReturnItems.toArray()).reduce((sum, item) => sum + item.quantity, 0)).toBe(5);
  });

  it('prevents a purchase return from exceeding received quantity or available stock', async () => {
    const productId = await createProduct('Minyak', 2);
    const { supplierId } = await createReceiving(productId, 3);

    await expect(createPurchaseReturn(purchaseInput(supplierId, productId, 4)))
      .rejects.toThrow('melebihi jumlah diterima');
    await expect(createPurchaseReturn(purchaseInput(supplierId, productId, 3)))
      .rejects.toThrow('Stok Minyak tidak cukup');
    expect(await db.purchaseReturns.count()).toBe(0);
    expect((await db.products.get(productId))?.stock).toBe(2);
  });

  it('reserves pending purchase returns and applies stock only after approval', async () => {
    const productId = await createProduct('Beras', 6);
    const { supplierId } = await createReceiving(productId, 6);
    const settingsId = await db.storeSettings.add({
      storeName: 'Toko', address: '', phone: '', receiptFooter: '', onboardingDone: true,
      lastBackupAt: null, deviceId: 'device-test', returnApprovalRequired: true,
    });

    const id = await createPurchaseReturn(purchaseInput(supplierId, productId, 2));
    expect((await db.products.get(productId))?.stock).toBe(6);
    expect((await db.purchaseReturns.get(id))?.status).toBe('pending_approval');
    expect((await db.storeSettings.get(settingsId))?.returnApprovalRequired).toBe(true);

    await approvePurchaseReturn(id, 1, 'Owner');
    expect((await db.products.get(productId))?.stock).toBe(4);
    expect((await db.purchaseReturns.get(id))?.approvedByName).toBe('Owner');
    expect((await db.purchaseReturns.get(id))?.approvedAt).toBeInstanceOf(Date);
  });

  it('supports partial and full sales returns with a bounded refund', async () => {
    const productId = await createProduct('Kopi', 0);
    const transactionId = await createTransaction(productId, 4);
    const sourceItem = await db.transactionItems.where('transactionId').equals(transactionId).first();

    await createSalesReturn(salesInput(transactionId, sourceItem!.id!, 1));
    expect((await db.products.get(productId))?.stock).toBe(1);
    await createSalesReturn(salesInput(transactionId, sourceItem!.id!, 3));
    expect((await db.products.get(productId))?.stock).toBe(4);
    expect((await db.salesReturns.toArray()).reduce((sum, item) => sum + item.refundValue, 0)).toBe(400);
    await expect(createSalesReturn(salesInput(transactionId, sourceItem!.id!, 1)))
      .rejects.toThrow('melebihi jumlah terjual');
  });

  it('rejects a sales return beyond the remaining sold quantity and transaction value', async () => {
    const productId = await createProduct('Teh', 0);
    const transactionId = await createTransaction(productId, 2);
    const sourceItem = await db.transactionItems.where('transactionId').equals(transactionId).first();

    await expect(createSalesReturn(salesInput(transactionId, sourceItem!.id!, 3)))
      .rejects.toThrow('melebihi jumlah terjual');
  });

  it('records refund provenance and respects approval before changing stock', async () => {
    const productId = await createProduct('Biskuit', 0);
    const transactionId = await createTransaction(productId, 1);
    const sourceItem = await db.transactionItems.where('transactionId').equals(transactionId).first();
    await db.storeSettings.add({
      storeName: 'Toko', address: '', phone: '', receiptFooter: '', onboardingDone: true,
      lastBackupAt: null, deviceId: 'device-test', returnApprovalRequired: true,
    });

    const id = await createSalesReturn(salesInput(transactionId, sourceItem!.id!, 1));
    const pending = await db.salesReturns.get(id);
    expect(pending).toMatchObject({ status: 'pending_approval', refundValue: 100, createdByName: 'Kasir' });
    expect((await db.products.get(productId))?.stock).toBe(0);
    await approveSalesReturn(id, 2, 'Owner');
    expect((await db.products.get(productId))?.stock).toBe(1);
    expect((await db.salesReturns.get(id))?.approvedBy).toBe(2);
  });

  it('exchanges a damaged returned item for a replacement and records exchange stock-out', async () => {
    const soldProductId = await createProduct('Produk Asal', 0);
    const replacementId = await createProduct('Produk Pengganti', 4, 80);
    const transactionId = await createTransaction(soldProductId, 1);
    const sourceItem = await db.transactionItems.where('transactionId').equals(transactionId).first();
    await createSalesReturn({
      ...salesInput(transactionId, sourceItem!.id!, 1),
      resolution: 'exchange',
      items: [{
        transactionItemId: sourceItem!.id!, quantity: 1, condition: 'damaged',
        exchangeProductId: replacementId, exchangeQuantity: 1,
      }],
    });

    expect((await db.products.get(soldProductId))?.stock).toBe(0);
    expect((await db.products.get(replacementId))?.stock).toBe(3);
    expect((await db.stockOuts.toArray())[0]).toMatchObject({ movementType: 'exchange', quantity: 1 });
    expect((await db.salesReturns.toCollection().first())?.refundValue).toBe(20);
  });

  it('does not reserve already-confirmed exchange stock and prevents reversal chains', async () => {
    const soldProductId = await createProduct('Produk Asal', 0);
    const replacementId = await createProduct('Produk Pengganti', 3, 40);
    const transactionId = await createTransaction(soldProductId, 2);
    const sourceItem = await db.transactionItems.where('transactionId').equals(transactionId).first();
    const exchangeInput = (quantity: number, exchangeQuantity: number) => ({
      ...salesInput(transactionId, sourceItem!.id!, quantity),
      resolution: 'exchange' as const,
      items: [{
        transactionItemId: sourceItem!.id!, quantity, condition: 'damaged' as const,
        exchangeProductId: replacementId, exchangeQuantity,
      }],
    });

    const firstId = await createSalesReturn(exchangeInput(1, 2));
    await createSalesReturn(exchangeInput(1, 1));
    expect((await db.products.get(replacementId))?.stock).toBe(0);

    const reversalId = await reverseSalesReturn(firstId, 1, 'Owner');
    expect((await db.products.get(replacementId))?.stock).toBe(2);
    await expect(reverseSalesReturn(reversalId, 1, 'Owner')).rejects.toThrow('tidak dapat dibalik kembali');
    await expect(reverseSalesReturn(firstId, 1, 'Owner')).rejects.toThrow('sudah dibuat');
  });

  it('reverses purchase and sales returns with compensating stock movements', async () => {
    const productId = await createProduct('Sabun', 5);
    const { supplierId } = await createReceiving(productId, 2);
    const purchaseId = await createPurchaseReturn(purchaseInput(supplierId, productId, 1));
    expect((await db.products.get(productId))?.stock).toBe(4);
    const purchaseReversalId = await reversePurchaseReturn(purchaseId, 1, 'Owner');
    expect((await db.products.get(productId))?.stock).toBe(5);
    await expect(reversePurchaseReturn(purchaseReversalId, 1, 'Owner'))
      .rejects.toThrow('tidak dapat dibalik kembali');

    const transactionId = await createTransaction(productId, 1);
    const sourceItem = await db.transactionItems.where('transactionId').equals(transactionId).first();
    const salesId = await createSalesReturn(salesInput(transactionId, sourceItem!.id!, 1));
    expect((await db.products.get(productId))?.stock).toBe(6);
    const salesReversalId = await reverseSalesReturn(salesId, 1, 'Owner');
    expect((await db.products.get(productId))?.stock).toBe(5);
    await expect(reverseSalesReturn(salesReversalId, 1, 'Owner'))
      .rejects.toThrow('tidak dapat dibalik kembali');
  });

  it('writes separate purchase-return and sales-return movements into the stock card', async () => {
    const productId = await createProduct('Sereal', 6);
    await db.stockIns.add({
      productId, supplierId: 0, movementType: 'opening_stock', quantity: 6,
      buyPrice: 40, totalPrice: 240, date, notes: 'Opening',
    });
    const { supplierId } = await createReceiving(productId, 2);
    await createPurchaseReturn(purchaseInput(supplierId, productId, 1));
    const transactionId = await createTransaction(productId, 1);
    await applySaleStockDelta({
      productId, delta: 1, quantity: 1, transactionId, referenceNumber: 'TX-001', date,
    });
    const sourceItem = await db.transactionItems.where('transactionId').equals(transactionId).first();
    await createSalesReturn(salesInput(transactionId, sourceItem!.id!, 1));

    const card = await getStockCardMovements((await db.products.get(productId))!);
    expect(card.map(item => item.type)).toContain('purchase_return');
    expect(card.map(item => item.type)).toContain('sales_return');
    const daily = getDailyStockCardSummaries(card);
    expect(daily.at(-1)?.closingStock).toBe((await db.products.get(productId))?.stock);
  });

  it('calculates gross and net return report totals using confirmed returns only', () => {
    const totals = getReturnReportTotals(
      [{ total: 500 }],
      [{ totalValue: 300 }],
      [
        { status: 'confirmed', totalValue: 50, refundValue: 50 },
        { status: 'pending_approval', totalValue: 100, refundValue: 100 },
      ],
      [{ status: 'confirmed', totalValue: 40 }, { status: 'pending_approval', totalValue: 10 }],
    );
    expect(totals).toEqual({
      grossSales: 500, salesReturns: 50, netSales: 450,
      grossPurchases: 300, purchaseReturns: 40, netPurchases: 260,
    });
  });

  it('renders receipt markup for thermal 58 mm, 80 mm, and A4 return documents', () => {
    const data: ReturnPrintData = {
      title: 'Retur Penjualan', number: 'SR-001', date, user: 'Kasir',
      partyLabel: 'Pelanggan', partyName: 'Customer A', notes: 'Catatan',
      total: 100, rows: [{ name: 'Produk', sku: 'SKU-1', quantity: 1, unit: 'pcs', value: 100 }],
    };
    const settings = { storeName: 'SISMart', address: '', phone: '' } as never;

    const { rerender } = render(<ReturnPrint data={data} storeSettings={settings} size="58mm" />);
    expect(document.querySelector('.return-print-58')?.textContent).toContain('SR-001');
    expect(screen.getByText('Produk')).toBeTruthy();

    rerender(<ReturnPrint data={data} storeSettings={settings} size="80mm" />);
    expect(document.querySelector('.return-print-80')?.textContent).toContain('SR-001');

    rerender(<ReturnPrint data={data} storeSettings={settings} size="A4" />);
    expect(document.querySelector('.return-print-A4')?.textContent).toContain('SISMart');
  });
});

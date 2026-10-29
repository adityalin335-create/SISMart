import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { buildBackupData, restoreFromBackupData, BACKUP_VERSION, backupFileName } from '@/lib/backup';

describe('Backup and Restore Logic', () => {
  it('uses the SISMart brand for new backup file names', () => {
    expect(backupFileName(new Date('2026-10-26T16:17:44.022Z'))).toBe('sismart-backup-2026-10-26.json');
  });

  beforeEach(async () => {
    // Clear tables before each test
    await db.categories.clear();
    await db.products.clear();
    await db.stockOpnames.clear();
    await db.stockOpnameItems.clear();
    await db.purchaseReturns.clear();
    await db.purchaseReturnItems.clear();
    await db.salesReturns.clear();
    await db.salesReturnItems.clear();
  });

  afterEach(async () => {
    await db.categories.clear();
    await db.products.clear();
    await db.stockOpnames.clear();
    await db.stockOpnameItems.clear();
    await db.purchaseReturns.clear();
    await db.purchaseReturnItems.clear();
    await db.salesReturns.clear();
    await db.salesReturnItems.clear();
  });

  it('should include stockOpnames and stockOpnameItems in buildBackupData', async () => {
    // Add dummy data to tables
    await db.categories.add({ id: 1, name: 'Category 1', isDeleted: 0 });
    await db.products.add({ id: 1, name: 'Product 1', sku: 'P1', categoryId: 1, isDeleted: 0 });
    
    // Add stock opname data
    await db.stockOpnames.add({
      id: 1,
      date: new Date(),
      status: 'completed',
      createdBy: 'user1',
      notes: 'Test Opname'
    });
    await db.stockOpnameItems.add({
      id: 1,
      opnameId: 1,
      productId: 1,
      systemStock: 10,
      actualStock: 8,
      difference: -2,
      notes: 'Shrinkage'
    });

    const backup = await buildBackupData();

    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.categories).toHaveLength(1);
    expect(backup.products).toHaveLength(1);
    expect(backup.stockOpnames).toHaveLength(1);
    expect(backup.stockOpnameItems).toHaveLength(1);
    expect(backup.stockOpnames[0].notes).toBe('Test Opname');
    expect(backup.stockOpnameItems[0].difference).toBe(-2);
  });

  it('should restore stockOpnames and stockOpnameItems successfully', async () => {
    const mockBackup = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      categories: [{ id: 2, name: 'Category 2', isDeleted: 0 }],
      products: [{ id: 2, name: 'Product 2', sku: 'P2', categoryId: 2, isDeleted: 0 }],
      stockOpnames: [{ id: 5, date: new Date().toISOString(), status: 'draft', createdBy: 'user2', notes: 'Draft Opname' }],
      stockOpnameItems: [{ id: 5, opnameId: 5, productId: 2, systemStock: 5, actualStock: 5, difference: 0 }],
    };

    await restoreFromBackupData(mockBackup);

    const categories = await db.categories.toArray();
    const products = await db.products.toArray();
    const stockOpnames = await db.stockOpnames.toArray();
    const stockOpnameItems = await db.stockOpnameItems.toArray();

    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe('Category 2');
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('Product 2');
    expect(stockOpnames).toHaveLength(1);
    expect(stockOpnames[0].notes).toBe('Draft Opname');
    expect(stockOpnames[0].date).toBeInstanceOf(Date);
    expect(stockOpnameItems).toHaveLength(1);
    expect(stockOpnameItems[0].difference).toBe(0);
  });

  it('clears local return records when restoring a legacy backup without return tables', async () => {
    await db.purchaseReturns.add({
      returnNumber: 'PR-LOCAL', supplierId: 1, supplierName: 'Supplier',
      date: new Date(), status: 'confirmed', reason: 'other', notes: '',
      totalValue: 10, createdByName: 'Owner', createdAt: new Date(),
    });
    await db.salesReturns.add({
      returnNumber: 'SR-LOCAL', transactionId: 1, receiptNumber: 'TX-1',
      customerName: 'Customer', date: new Date(), status: 'confirmed', reason: 'other',
      notes: '', resolution: 'refund', totalValue: 10, refundValue: 10,
      createdByName: 'Owner', createdAt: new Date(),
    });

    await restoreFromBackupData({
      version: 9,
      exportedAt: new Date().toISOString(),
      categories: [{ id: 8, name: 'Legacy', isDeleted: 0 }],
      products: [],
    });

    expect(await db.purchaseReturns.count()).toBe(0);
    expect(await db.salesReturns.count()).toBe(0);
  });

  it('restores return audit dates as Date values', async () => {
    const timestamp = '2026-10-29T10:00:00.000Z';
    await restoreFromBackupData({
      version: BACKUP_VERSION,
      exportedAt: timestamp,
      categories: [{ id: 9, name: 'Return test', isDeleted: 0 }],
      products: [],
      purchaseReturns: [{
        id: 20, returnNumber: 'PR-20', supplierId: 1, supplierName: 'Supplier',
        date: timestamp, status: 'confirmed', reason: 'other', notes: '', totalValue: 20,
        createdByName: 'Owner', createdAt: timestamp, approvedAt: timestamp,
      }],
      salesReturns: [{
        id: 30, returnNumber: 'SR-30', transactionId: 1, receiptNumber: 'TX-1',
        customerName: 'Customer', date: timestamp, status: 'confirmed', reason: 'other',
        notes: '', resolution: 'refund', totalValue: 10, refundValue: 10,
        createdByName: 'Owner', createdAt: timestamp, approvedAt: timestamp,
      }],
    });

    expect((await db.purchaseReturns.get(20))?.date).toBeInstanceOf(Date);
    expect((await db.purchaseReturns.get(20))?.approvedAt).toBeInstanceOf(Date);
    expect((await db.salesReturns.get(30))?.createdAt).toBeInstanceOf(Date);
  });
});

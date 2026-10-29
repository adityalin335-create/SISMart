import { db, isStockManaged, type Debt, type Transaction, type TransactionItemRecord } from '@/lib/db';
import { applySaleStockDelta } from '@/lib/stock-movements';

type NewTransaction = Omit<Transaction, 'id'>;
type NewTransactionItem = Omit<TransactionItemRecord, 'id' | 'transactionId'>;
type NewDebt = Omit<Debt, 'id' | 'transactionId'>;

export async function createSaleWithItems(input: {
  transaction: NewTransaction;
  items: NewTransactionItem[];
  debt?: NewDebt;
  createdBy?: number;
}): Promise<number> {
  if (input.items.length === 0) throw new Error('Keranjang transaksi kosong.');
  if (new Set(input.items.map(item => item.productId)).size !== input.items.length) {
    throw new Error('Produk yang sama tidak boleh ditambahkan lebih dari sekali.');
  }
  if (input.items.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    throw new Error('Kuantitas penjualan tidak valid.');
  }

  return db.transaction(
    'rw',
    [db.transactions, db.transactionItems, db.products, db.stockIns, db.stockOuts, db.debts],
    async () => {
      const transactionId = await db.transactions.add(input.transaction);
      await db.transactionItems.bulkAdd(
        input.items.map(item => ({ ...item, transactionId })),
      );

      for (const item of input.items) {
        const product = await db.products.get(item.productId);
        if (!product || product.isDeleted) {
          throw new Error('Produk tidak ditemukan atau sudah tidak aktif.');
        }
        if (!isStockManaged(product)) continue;
        await applySaleStockDelta({
          productId: item.productId,
          delta: item.quantity,
          quantity: item.quantity,
          transactionId,
          referenceNumber: input.transaction.receiptNumber,
          date: input.transaction.date,
          createdBy: input.createdBy,
        });
      }

      if (input.debt) {
        await db.debts.add({ ...input.debt, transactionId });
      }
      return transactionId;
    },
  );
}

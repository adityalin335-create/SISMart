import type { Transaction, TransactionItemRecord } from '@/lib/db';

export interface ProductSalesSummary {
  name: string;
  qty: number;
  revenue: number;
  profit: number;
}

export function calculateProductSales(
  items: TransactionItemRecord[],
  transactions: Transaction[],
): ProductSalesSummary[] {
  const transactionById = new Map(transactions.map(transaction => [transaction.id, transaction]));
  const sales: Record<string, ProductSalesSummary> = {};

  for (const item of items) {
    const transaction = transactionById.get(item.transactionId);
    if (!transaction) continue;
    const summary = sales[item.productName] ??= {
      name: item.productName,
      qty: 0,
      revenue: 0,
      profit: 0,
    };
    const transactionDiscount = transaction.subtotal > 0
      ? transaction.discountAmount * item.subtotal / transaction.subtotal
      : 0;
    summary.qty += item.quantity;
    summary.revenue += item.subtotal;
    summary.profit += item.subtotal - transactionDiscount - item.hpp * item.quantity;
  }

  return Object.values(sales);
}

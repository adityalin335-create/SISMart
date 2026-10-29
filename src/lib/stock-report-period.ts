import { endOfDay, startOfDay, subDays } from 'date-fns';
import { isStockManaged, type Product } from '@/lib/db';

export function getStockReportPeriod(now: Date, days: number): { start: Date; end: Date } {
  if (!Number.isInteger(days) || days < 1) throw new Error('Periode laporan stok tidak valid.');
  return {
    start: startOfDay(subDays(now, days - 1)),
    end: endOfDay(now),
  };
}

export function getTrackedStockProducts(
  products: Pick<Product, 'isDeleted' | 'trackStock' | 'stock'>[],
): Pick<Product, 'isDeleted' | 'trackStock' | 'stock'>[] {
  return products.filter(product => product.isDeleted === 0 && isStockManaged(product));
}

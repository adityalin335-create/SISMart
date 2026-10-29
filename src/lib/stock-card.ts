import { db, type Product } from '@/lib/db';

export type StockMovementType =
  | 'opening_stock'
  | 'receiving'
  | 'sale'
  | 'stock_adjustment'
  | 'stock_opname'
  | 'return'
  | 'purchase_return'
  | 'sales_return'
  | 'exchange';

export interface StockCardMovement {
  id: string;
  date: Date;
  referenceNumber: string;
  type: StockMovementType;
  stockIn: number;
  stockOut: number;
  balance: number;
}

export interface DailyStockCardSummary {
  dateKey: string;
  date: Date;
  openingStock: number;
  receiving: number;
  sales: number;
  returns: number;
  stockOpnameAdjustment: number;
  reconciliationAdjustment: number;
  closingStock: number;
  isConsistent: boolean;
  movements: StockCardMovement[];
}

interface MovementSource {
  id: string;
  date: Date;
  referenceNumber: string;
  type: StockMovementType;
  delta: number;
}

function opnameReference(notes: string, fallbackId: number): string {
  const match = notes.match(/(?:sesi\s*#|opname[-\s#]*)(\d+)/i);
  return match ? `OPNAME-${match[1]}` : `OPNAME-${fallbackId}`;
}

function typeForStockIn(stockIn: {
  id?: number;
  receivingId?: number;
  supplierId: number;
  notes: string;
  movementType?: StockMovementType;
}): StockMovementType {
  if (stockIn.movementType) return stockIn.movementType;
  if (stockIn.receivingId !== undefined) return 'receiving';
  if (/opname/i.test(stockIn.notes)) return 'stock_opname';
  if (/retur|return/i.test(stockIn.notes)) return 'return';
  return 'stock_adjustment';
}

export async function getStockCardMovements(product: Product): Promise<StockCardMovement[]> {
  if (product.id === undefined) throw new Error('Produk tidak memiliki ID.');

  const [stockIns, stockOuts] = await Promise.all([
    db.stockIns.where('productId').equals(product.id).toArray(),
    db.stockOuts.where('productId').equals(product.id).toArray(),
  ]);
  const receivingIds = [...new Set(stockIns
    .map(stockIn => stockIn.receivingId)
    .filter((id): id is number => id !== undefined))];
  const receivings = receivingIds.length
    ? await db.receivings.bulkGet(receivingIds)
    : [];
  const receivingById = new Map(
    receivings.filter((receiving): receiving is NonNullable<typeof receiving> => receiving !== undefined)
      .map(receiving => [receiving.id, receiving]),
  );

  const movements: MovementSource[] = [];
  for (const stockIn of stockIns) {
    const type = typeForStockIn(stockIn);
    const receiving = stockIn.receivingId === undefined
      ? undefined
      : receivingById.get(stockIn.receivingId);
    movements.push({
      id: `stock-in-${stockIn.id}`,
      date: new Date(stockIn.date),
      referenceNumber: receiving?.receivingNumber ??
        stockIn.referenceNumber ??
        (type === 'opening_stock'
          ? `OPENING-${product.sku || product.id}`
          : type === 'stock_opname'
          ? opnameReference(stockIn.notes, stockIn.id ?? 0)
          : type === 'receiving'
            ? `RECEIVING-${stockIn.receivingId}`
            : `STOCK-IN-${stockIn.id}`),
      type,
      delta: stockIn.quantity,
    });
  }

  for (const stockOut of stockOuts) {
    const isOpname = stockOut.movementType === 'stock_opname' || stockOut.reason === 'opname' || /opname/i.test(stockOut.notes);
    const isOpening = stockOut.movementType === 'opening_stock';
    const isSale = stockOut.movementType === 'sale' || stockOut.reason === 'sales';
    const isPurchaseReturn = stockOut.movementType === 'purchase_return';
    const isSalesReturn = stockOut.movementType === 'sales_return';
    const isExchange = stockOut.movementType === 'exchange';
    const isReturn = stockOut.movementType === 'return' || /retur|return/i.test(stockOut.reason);
    movements.push({
      id: `stock-out-${stockOut.id}`,
      date: new Date(stockOut.date),
      referenceNumber: stockOut.referenceNumber ?? (isOpening
        ? `OPENING-${product.sku || product.id}`
        : isOpname
        ? opnameReference(stockOut.notes, stockOut.id ?? 0)
        : `STOCK-OUT-${stockOut.id}`),
      type: isOpening ? 'opening_stock' : isSale ? 'sale' : isOpname ? 'stock_opname' :
        isPurchaseReturn ? 'purchase_return' : isSalesReturn ? 'sales_return' :
          isExchange ? 'exchange' : isReturn ? 'return' : 'stock_adjustment',
      delta: -stockOut.quantity,
    });
  }

  movements.sort((left, right) => {
    if (left.type === 'opening_stock' && right.type !== 'opening_stock') return -1;
    if (left.type !== 'opening_stock' && right.type === 'opening_stock') return 1;
    return left.date.getTime() - right.date.getTime() || left.id.localeCompare(right.id);
  });

  let balance = 0;
  const card: StockCardMovement[] = [];
  for (const movement of movements) {
    balance = Math.round((balance + movement.delta) * 1e6) / 1e6;
    card.push({
      id: movement.id,
      date: movement.date,
      referenceNumber: movement.referenceNumber,
      type: movement.type,
      stockIn: movement.delta > 0 ? movement.delta : 0,
      stockOut: movement.delta < 0 ? Math.abs(movement.delta) : 0,
      balance,
    });
  }

  return card;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function roundStock(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function getDailyStockCardSummaries(
  movements: StockCardMovement[],
): DailyStockCardSummary[] {
  const grouped = new Map<string, StockCardMovement[]>();
  for (const movement of movements) {
    const dateKey = localDateKey(movement.date);
    const dayMovements = grouped.get(dateKey) ?? [];
    dayMovements.push(movement);
    grouped.set(dateKey, dayMovements);
  }

  const summaries: DailyStockCardSummary[] = [];
  let previousClosing: number | undefined;
  for (const [dateKey, dayMovements] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const firstMovement = dayMovements[0];
    const lastMovement = dayMovements[dayMovements.length - 1];
    const openingMovements = dayMovements.filter(movement => movement.type === 'opening_stock');
    const openingMovementTotal = roundStock(openingMovements.reduce(
      (total, movement) => total + movement.stockIn - movement.stockOut,
      0,
    ));
    const openingStock = previousClosing ??
      (openingMovements.length > 0
        ? openingMovementTotal
        : roundStock(firstMovement.balance - firstMovement.stockIn + firstMovement.stockOut));
    const sumDelta = (types: StockMovementType[]) => roundStock(dayMovements
      .filter(movement => types.includes(movement.type))
      .reduce((total, movement) => total + movement.stockIn - movement.stockOut, 0));
    const receiving = sumDelta(['receiving']);
    const sales = roundStock(dayMovements
      .filter(movement => movement.type === 'sale')
      .reduce((total, movement) => total + movement.stockOut - movement.stockIn, 0));
    const returns = sumDelta(['return', 'purchase_return', 'sales_return']);
    const stockOpnameAdjustment = sumDelta(['stock_opname']);
    const reconciliationAdjustment = sumDelta(['stock_adjustment', 'exchange']);
    const closingStock = roundStock(
      openingStock + receiving + returns + stockOpnameAdjustment - sales + reconciliationAdjustment,
    );
    const movementClosingStock = roundStock(
      openingStock + dayMovements
        .filter(movement => movement.type !== 'opening_stock')
        .reduce((total, movement) => total + movement.stockIn - movement.stockOut, 0),
    );
    const summary: DailyStockCardSummary = {
      dateKey,
      date: firstMovement.date,
      openingStock: roundStock(openingStock),
      receiving,
      sales,
      returns,
      stockOpnameAdjustment,
      reconciliationAdjustment,
      closingStock,
      isConsistent: closingStock === movementClosingStock &&
        movementClosingStock === roundStock(lastMovement.balance),
      movements: dayMovements,
    };
    summaries.push(summary);
    previousClosing = summary.closingStock;
  }

  return summaries;
}

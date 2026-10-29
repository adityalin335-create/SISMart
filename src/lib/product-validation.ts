export function hasValidProductAmounts(price: number, costPrice: number, stock: number): boolean {
  return [price, costPrice, stock].every(value => Number.isFinite(value) && value >= 0);
}

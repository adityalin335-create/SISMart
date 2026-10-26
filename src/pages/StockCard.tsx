import { Fragment, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import LockedPage from '@/components/LockedPage';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';
import { db, isStockManaged } from '@/lib/db';
import { getDailyStockCardSummaries, getStockCardMovements } from '@/lib/stock-card';

const LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

export default function StockCardPage() {
  const { id: routeId } = useParams();
  const productId = routeId ? Number(routeId) : NaN;
  const { can } = useAuth();
  const { t, i18n } = useTranslation('products');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    if (!Number.isSafeInteger(productId) || productId <= 0) return null;
    const product = await db.products.get(productId);
    if (!product) return null;
    return { product, movements: await getStockCardMovements(product) };
  }, [productId]);
  const locale = LOCALES[i18n.language] ?? 'id-ID';
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeStyle: 'short' }),
    [locale],
  );
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }), [locale]);

  if (!can('manage_stock_inout') && !can('view_reports')) {
    return <LockedPage title={t('stockCard.title')} permissionLabel={t('stockCard.permission')} />;
  }
  if (data === undefined) {
    return <p className="p-6 text-sm text-muted-foreground">{t('stockCard.loading')}</p>;
  }
  if (!data) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <p className="text-sm text-muted-foreground">{t('stockCard.notFound')}</p>
        <Button asChild variant="outline"><Link to="/products">{t('stockCard.backToProducts')}</Link></Button>
      </div>
    );
  }

  const { product, movements } = data;
  const dailySummaries = getDailyStockCardSummaries(movements);
  const ledgerClosingStock = dailySummaries[dailySummaries.length - 1]?.closingStock ?? 0;
  const hasStockMismatch = isStockManaged(product) &&
    Math.round(ledgerClosingStock * 1e6) !== Math.round(product.stock * 1e6);
  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to="/products" aria-label={t('stockCard.backToProducts')}><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">{t('stockCard.title')}</h1>
          <p className="text-xs text-muted-foreground truncate">{product.name} · {product.sku}</p>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('stockCard.currentStock')}</p>
            <p className="text-2xl font-bold">
              {numberFormatter.format(product.stock)} <span className="text-sm font-medium">{product.unit}</span>
            </p>
          </div>
          {!isStockManaged(product) && <Badge variant="secondary">{t('card.stockUnmanaged')}</Badge>}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {hasStockMismatch && (
            <p role="alert" className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {t('stockCard.balanceMismatch', {
                ledger: numberFormatter.format(ledgerClosingStock),
                stock: numberFormatter.format(product.stock),
              })}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">{t('stockCard.columns.date')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t('stockCard.columns.opening')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t('stockCard.columns.receiving')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t('stockCard.columns.sales')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t('stockCard.columns.returns')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t('stockCard.columns.stockOpname')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t('stockCard.columns.otherAdjustment')}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{t('stockCard.columns.closing')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailySummaries.map(summary => {
                  const isExpanded = expandedDate === summary.dateKey;
                  return (
                    <Fragment key={summary.dateKey}>
                      <TableRow data-state={isExpanded ? 'selected' : undefined}>
                        <TableCell className="whitespace-nowrap p-0">
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedDate(isExpanded ? null : summary.dateKey)}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 shrink-0" />
                              : <ChevronRight className="h-4 w-4 shrink-0" />}
                            {dateFormatter.format(summary.date)}
                          </button>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{numberFormatter.format(summary.openingStock)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numberFormatter.format(summary.receiving)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numberFormatter.format(summary.sales)}</TableCell>
                        <TableCell className="text-right tabular-nums">{numberFormatter.format(summary.returns)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {summary.stockOpnameAdjustment > 0 && <ArrowUp className="mr-1 inline h-3 w-3 text-green-600" />}
                          {summary.stockOpnameAdjustment < 0 && <ArrowDown className="mr-1 inline h-3 w-3 text-destructive" />}
                          {numberFormatter.format(summary.stockOpnameAdjustment)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{numberFormatter.format(summary.otherAdjustment)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{numberFormatter.format(summary.closingStock)}</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30 p-2 sm:p-4">
                            <div className="overflow-x-auto rounded-md border bg-background">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="whitespace-nowrap">{t('stockCard.detail.time')}</TableHead>
                                    <TableHead className="whitespace-nowrap">{t('stockCard.detail.type')}</TableHead>
                                    <TableHead className="whitespace-nowrap">{t('stockCard.detail.reference')}</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">{t('stockCard.detail.in')}</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">{t('stockCard.detail.out')}</TableHead>
                                    <TableHead className="text-right whitespace-nowrap">{t('stockCard.detail.balance')}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {summary.movements.map(movement => (
                                    <TableRow key={movement.id}>
                                      <TableCell className="whitespace-nowrap text-xs">{timeFormatter.format(movement.date)}</TableCell>
                                      <TableCell className="whitespace-nowrap text-xs">{t(`stockCard.types.${movement.type}`)}</TableCell>
                                      <TableCell className="whitespace-nowrap text-xs font-medium">{movement.referenceNumber}</TableCell>
                                      <TableCell className="text-right tabular-nums">{numberFormatter.format(movement.stockIn)}</TableCell>
                                      <TableCell className="text-right tabular-nums">{numberFormatter.format(movement.stockOut)}</TableCell>
                                      <TableCell className="text-right font-semibold tabular-nums">{numberFormatter.format(movement.balance)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {dailySummaries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-28 text-center text-sm text-muted-foreground">
                      <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      {t('stockCard.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

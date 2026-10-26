import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, Building2, CalendarDays, Pencil, Printer, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import LockedPage from '@/components/LockedPage';
import { db } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';
import PurchaseOrderPrint from '@/components/PurchaseOrderPrint';

const LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

export default function PurchaseOrderDetailPage() {
  const { id: routeId } = useParams();
  const orderId = routeId ? Number(routeId) : NaN;
  const { can } = useAuth();
  const { t, i18n } = useTranslation('settings');
  const details = useLiveQuery(async () => {
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
    const order = await db.purchaseOrders.get(orderId);
    if (!order) return null;
    const items = await db.purchaseOrderItems.where('purchaseOrderId').equals(orderId).toArray();
    return { order, items };
  }, [orderId]);
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const numberLocale = LOCALES[i18n.language] ?? 'id-ID';
  const currency = useMemo(
    () => new Intl.NumberFormat(numberLocale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }),
    [numberLocale],
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(numberLocale, { dateStyle: 'medium' }),
    [numberLocale],
  );

  if (!can('manage_stock_inout')) {
    return <LockedPage title={t('purchaseOrders.locked.title')} permissionLabel={t('purchaseOrders.locked.permission')} />;
  }
  if (details === undefined) {
    return <p className="p-6 text-sm text-muted-foreground">{t('purchaseOrders.loading')}</p>;
  }
  if (!details) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <p className="text-sm text-muted-foreground">{t('purchaseOrders.notFound')}</p>
        <Button asChild variant="outline"><Link to="/purchase-orders">{t('purchaseOrders.backToList')}</Link></Button>
      </div>
    );
  }

  const { order, items } = details;
  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to="/purchase-orders" aria-label={t('purchaseOrders.backToList')}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">{order.poNumber}</h1>
          <p className="text-xs text-muted-foreground">{t('purchaseOrders.detailTitle')}</p>
        </div>
        <Badge variant={order.status !== 'draft' ? 'default' : 'secondary'}>
          {t(`purchaseOrders.status.${order.status}`)}
        </Badge>
      </div>

      <Button type="button" variant="outline" className="w-full sm:w-auto print:hidden" onClick={() => window.print()}>
        <Printer className="w-4 h-4 mr-2" />{t('purchaseOrders.print.button')}
      </Button>

      {order.status === 'draft' && (
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to={`/purchase-orders/${order.id}/edit`}><Pencil className="w-4 h-4 mr-2" />{t('purchaseOrders.editDraft')}</Link>
        </Button>
      )}
      {['submitted', 'partially_received'].includes(order.status) && (
        <Button asChild className="w-full sm:w-auto">
          <Link to={`/receivings/new?purchaseOrderId=${order.id}`}>
            <ArrowDownToLine className="w-4 h-4 mr-2" />{t('receivings.createFromPo')}
          </Link>
        </Button>
      )}

      <Card className="border-0 shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />{order.supplierName}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-1 space-y-2 text-sm">
          {order.supplierPhone && <p className="text-muted-foreground">{order.supplierPhone}</p>}
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="w-4 h-4" />
            <span>{t('purchaseOrders.form.orderDate')}: {dateFormatter.format(new Date(order.orderDate))}</span>
          </div>
          {order.expectedDate && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="w-4 h-4" />
              <span>{t('purchaseOrders.form.expectedDate')}: {dateFormatter.format(new Date(order.expectedDate))}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('purchaseOrders.createdBy', { name: order.createdByName })}
          </p>
          {order.submittedAt && (
            <p className="text-xs text-muted-foreground">
              {t('purchaseOrders.submittedAt', { date: dateFormatter.format(new Date(order.submittedAt)) })}
            </p>
          )}
          {order.notes && <p className="pt-2 border-t">{order.notes}</p>}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">{t('purchaseOrders.itemsTitle', { count: items.length })}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {items.map(item => (
              <div key={item.id} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">{item.sku} · {item.quantity} {item.unit}</p>
                  <p className="text-xs text-muted-foreground">{currency.format(item.unitCost)} / {item.unit}</p>
                </div>
                <p className="text-sm font-semibold shrink-0">{currency.format(item.lineTotal)}</p>
              </div>
            ))}
          </div>
          <div className="border-t p-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t('purchaseOrders.form.estimatedTotal')}</span>
            <span className="text-lg font-bold">{currency.format(order.subtotal)}</span>
          </div>
        </CardContent>
      </Card>

      {order.status === 'submitted' && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start gap-2">
          <Send className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <p className="text-xs text-muted-foreground">{t('receivings.createFromPoHint')}</p>
        </div>
      )}

      <PurchaseOrderPrint order={order} items={items} storeSettings={storeSettings} />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Printer, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { db, type PurchaseReturn, type SalesReturn } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReturnPrint, { type PrintSize, type ReturnPrintData } from '@/components/ReturnPrint';
import {
  approvePurchaseReturn,
  approveSalesReturn,
  createPurchaseReturn,
  createSalesReturn,
  getPurchaseReturnableProducts,
  getSalesReturnableItems,
  reversePurchaseReturn,
  reverseSalesReturn,
} from '@/lib/returns';
import DateRangeFilter, { type DateRange } from '@/components/DateRangeFilter';
import { formatRetailDate, getDateRangeBounds } from '@/lib/date-range';

type Reason = 'damaged' | 'expired' | 'wrong_item' | 'quality' | 'other';
type Condition = 'resellable' | 'damaged';
const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
}).format(amount);

export default function ReturnsPage() {
  const { t } = useTranslation('settings');
  const { can, currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState(searchParams.get('txId')
    ? 'sales'
    : ['purchase', 'sales', 'approval'].includes(requestedTab ?? '') ? requestedTab! : 'purchase');
  const [supplierId, setSupplierId] = useState('');
  const [purchaseQuantities, setPurchaseQuantities] = useState<Record<number, string>>({});
  const [transactionId, setTransactionId] = useState(searchParams.get('txId') ?? '');
  const [salesQuantities, setSalesQuantities] = useState<Record<number, string>>({});
  const [conditions, setConditions] = useState<Record<number, Condition>>({});
  const [exchangeProducts, setExchangeProducts] = useState<Record<number, string>>({});
  const [exchangeQuantities, setExchangeQuantities] = useState<Record<number, string>>({});
  const [resolution, setResolution] = useState<'refund' | 'exchange'>('refund');
  const [reason, setReason] = useState<Reason>('damaged');
  const [notes, setNotes] = useState('');
  const [printData, setPrintData] = useState<ReturnPrintData | null>(null);
  const [printSize, setPrintSize] = useState<PrintSize>('A4');
  const [returnToReverse, setReturnToReverse] = useState<{
    record: PurchaseReturn | SalesReturn;
    type: 'purchase' | 'sales';
  } | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>({});
  const bounds = useMemo(() => getDateRangeBounds(dateRange), [dateRange]);

  const suppliers = useLiveQuery(() => db.suppliers.where('isDeleted').equals(0).toArray());
  const purchaseable = useLiveQuery(
    () => supplierId ? getPurchaseReturnableProducts(Number(supplierId)) : Promise.resolve([]),
    [supplierId],
  );
  const transactions = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray());
  const salesItems = useLiveQuery(
    () => transactionId ? getSalesReturnableItems(Number(transactionId)) : Promise.resolve([]),
    [transactionId],
  );
  const products = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const purchaseReturns = useLiveQuery(() => {
    if (bounds.start && bounds.end) {
      return db.purchaseReturns.where('date').between(bounds.start, bounds.end, true, true).toArray()
        .then(records => records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    }
    if (bounds.start) {
      return db.purchaseReturns.where('date').aboveOrEqual(bounds.start).toArray()
        .then(records => records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    }
    if (bounds.end) return db.purchaseReturns.where('date').belowOrEqual(bounds.end).reverse().toArray();
    return db.purchaseReturns.orderBy('date').reverse().toArray();
  }, [bounds.start?.getTime(), bounds.end?.getTime()]);
  const purchaseReturnItems = useLiveQuery(async () => {
    const ids = (purchaseReturns ?? []).map(record => record.id!).filter(Boolean);
    return ids.length ? db.purchaseReturnItems.where('purchaseReturnId').anyOf(ids).toArray() : [];
  }, [purchaseReturns]);
  const salesReturns = useLiveQuery(() => {
    if (bounds.start && bounds.end) {
      return db.salesReturns.where('date').between(bounds.start, bounds.end, true, true).toArray()
        .then(records => records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    }
    if (bounds.start) {
      return db.salesReturns.where('date').aboveOrEqual(bounds.start).toArray()
        .then(records => records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    }
    if (bounds.end) return db.salesReturns.where('date').belowOrEqual(bounds.end).reverse().toArray();
    return db.salesReturns.orderBy('date').reverse().toArray();
  }, [bounds.start?.getTime(), bounds.end?.getTime()]);
  const salesReturnItems = useLiveQuery(async () => {
    const ids = (salesReturns ?? []).map(record => record.id!).filter(Boolean);
    return ids.length ? db.salesReturnItems.where('salesReturnId').anyOf(ids).toArray() : [];
  }, [salesReturns]);
  const returnableTransactions = (transactions ?? []).filter(tx => tx.status === 'completed');
  const selectedTransaction = returnableTransactions.find(tx => String(tx.id) === transactionId);

  useEffect(() => {
    const txParam = searchParams.get('txId');
    if (txParam) {
      setTransactionId(txParam);
      setTab('sales');
    } else if (['purchase', 'sales', 'approval'].includes(requestedTab ?? '')) {
      setTab(requestedTab!);
    }
  }, [searchParams, requestedTab]);

  const pendingPurchaseReturns = (purchaseReturns ?? []).filter(row => row.status === 'pending_approval');
  const pendingSalesReturns = (salesReturns ?? []).filter(row => row.status === 'pending_approval');
  const returnItemsByPurchaseId = useMemo(() => {
    const map = new Map<number, typeof purchaseReturnItems>();
    for (const item of purchaseReturnItems ?? []) {
      const current = map.get(item.purchaseReturnId) ?? [];
      current.push(item);
      map.set(item.purchaseReturnId, current);
    }
    return map;
  }, [purchaseReturnItems]);
  const returnItemsBySalesId = useMemo(() => {
    const map = new Map<number, typeof salesReturnItems>();
    for (const item of salesReturnItems ?? []) {
      const current = map.get(item.salesReturnId) ?? [];
      current.push(item);
      map.set(item.salesReturnId, current);
    }
    return map;
  }, [salesReturnItems]);

  const hasPurchaseAccess = can('create_purchase_return') || can('approve_purchase_return');
  const hasSalesAccess = can('create_sales_return') || can('approve_sales_return');
  if (!hasPurchaseAccess && !hasSalesAccess) {
    return <div className="p-6 text-center text-sm text-muted-foreground">{t('returns.noPermission')}</div>;
  }

  const beginPrint = (record: PurchaseReturn | SalesReturn, type: 'purchase' | 'sales') => {
    const rows = type === 'purchase'
      ? (returnItemsByPurchaseId.get(record.id!) ?? []).map(item => ({
          name: item.productName, sku: item.sku, quantity: item.quantity, unit: item.unit, value: item.totalValue,
        }))
      : (returnItemsBySalesId.get(record.id!) ?? []).map(item => ({
          name: item.productName, sku: item.sku, quantity: item.quantity, unit: item.unit, value: item.totalValue,
        }));
    setPrintData({
      title: t(type === 'purchase' ? 'returns.purchaseTitle' : 'returns.salesTitle'),
      number: record.returnNumber,
      date: new Date(record.date),
      user: record.createdByName,
      partyLabel: type === 'purchase' ? t('returns.supplier') : t('returns.customer'),
      partyName: type === 'purchase' ? (record as PurchaseReturn).supplierName : (record as SalesReturn).customerName,
      reason: reasonLabel(record.reason),
      notes: type === 'purchase'
        ? record.notes
        : `${record.notes}${(record as SalesReturn).resolution === 'exchange' ? ` · ${t('returns.exchange')}` : ` · ${t('returns.refund')}: ${formatCurrency((record as SalesReturn).refundValue)}`}`,
      total: type === 'purchase' ? (record as PurchaseReturn).totalValue : (record as SalesReturn).totalValue,
      rows,
    });
    window.setTimeout(() => window.print(), 50);
  };

  const handlePurchaseSubmit = async () => {
    if (!can('create_purchase_return')) return;
    const quantities = Object.entries(purchaseQuantities)
      .map(([productId, value]) => ({ productId: Number(productId), quantity: Number(value) }))
      .filter(item => item.quantity > 0);
    try {
      const id = await createPurchaseReturn({
        supplierId: Number(supplierId),
        quantities,
        reason,
        notes,
        createdBy: currentUser?.id,
        createdByName: currentUser?.name ?? t('returns.legacyUser'),
      });
      toast.success(t('returns.created', { number: (await db.purchaseReturns.get(id))?.returnNumber }));
      setPurchaseQuantities({});
      setNotes('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('returns.saveFailed'));
    }
  };

  const handleSalesSubmit = async () => {
    if (!can('create_sales_return')) return;
    const items = (salesItems ?? []).map(item => ({
      transactionItemId: item.transactionItemId,
      quantity: Number(salesQuantities[item.transactionItemId] ?? 0),
      condition: conditions[item.transactionItemId] ?? 'resellable',
      exchangeProductId: exchangeProducts[item.transactionItemId]
        ? Number(exchangeProducts[item.transactionItemId]) : undefined,
      exchangeQuantity: Number(exchangeQuantities[item.transactionItemId] ?? 0) || undefined,
    })).filter(item => item.quantity > 0);
    try {
      const id = await createSalesReturn({
        transactionId: Number(transactionId),
        items,
        reason,
        resolution,
        notes,
        createdBy: currentUser?.id,
        createdByName: currentUser?.name ?? t('returns.legacyUser'),
      });
      toast.success(t('returns.created', { number: (await db.salesReturns.get(id))?.returnNumber }));
      setSalesQuantities({});
      setNotes('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('returns.saveFailed'));
    }
  };

  const handleApprove = async (id: number, type: 'purchase' | 'sales') => {
    const permitted = type === 'purchase' ? can('approve_purchase_return') : can('approve_sales_return');
    if (!permitted) return;
    try {
      if (type === 'purchase') await approvePurchaseReturn(id, currentUser?.id, currentUser?.name ?? '');
      else await approveSalesReturn(id, currentUser?.id, currentUser?.name ?? '');
      toast.success(t('returns.approved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('returns.approveFailed'));
    }
  };

  const handleReverse = (record: PurchaseReturn | SalesReturn, type: 'purchase' | 'sales') => {
    setReturnToReverse({ record, type });
  };

  const confirmReverse = async () => {
    if (!returnToReverse) return;
    try {
      const { record, type } = returnToReverse;
      if (type === 'purchase') await reversePurchaseReturn(record.id!, currentUser?.id, currentUser?.name ?? '');
      else await reverseSalesReturn(record.id!, currentUser?.id, currentUser?.name ?? '');
      toast.success(t('returns.reversalCreated'));
      setReturnToReverse(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('returns.saveFailed'));
    }
  };

  const reasonLabel = (value: Reason) => t(`returns.reasons.${value}`);
  const statusLabel = (status: string) => t(`returns.status.${status}`);

  return (
    <div className="px-4 pt-6 pb-24 space-y-4">
      <ReturnPrint data={printData} storeSettings={storeSettings} size={printSize} />
      <AlertDialog open={returnToReverse !== null} onOpenChange={open => !open && setReturnToReverse(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('returns.cancelReturnTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{t('returns.cancelReturnDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('returns.cancelReturnCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReverse}>{t('returns.cancelReturnContinue')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 print:hidden" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <RotateCcw className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">{t('returns.title')}</h1>
      </div>
      <div className="flex items-center gap-2 print:hidden">
        <Label htmlFor="return-print-size" className="text-xs">{t('returns.printSize')}</Label>
        <select id="return-print-size" value={printSize} onChange={event => setPrintSize(event.target.value as PrintSize)}
          className="h-9 rounded-md border bg-background px-2 text-sm">
          <option value="58mm">58 mm</option><option value="80mm">80 mm</option><option value="A4">A4</option>
        </select>
      </div>
      <div className="print:hidden">
        <DateRangeFilter value={dateRange} onApply={setDateRange} onReset={() => setDateRange({})} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 print:hidden">
          <TabsTrigger value="purchase">{t('returns.purchaseTab')}</TabsTrigger>
          <TabsTrigger value="sales">{t('returns.salesTab')}</TabsTrigger>
          <TabsTrigger value="approval">{t('returns.approvals')}</TabsTrigger>
        </TabsList>
        <TabsContent value="purchase" className="space-y-3">
          {can('create_purchase_return') && (
            <Card>
              <CardHeader><CardTitle className="text-base">{t('returns.purchaseTitle')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Label>{t('returns.supplier')}</Label>
                <select value={supplierId} onChange={event => { setSupplierId(event.target.value); setPurchaseQuantities({}); }}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{t('returns.selectSupplier')}</option>
                  {(suppliers ?? []).map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
                {purchaseable?.map(item => (
                  <div key={item.productId} className="grid grid-cols-[1fr_90px] gap-2 items-center border-b pb-2">
                    <div><p className="text-sm font-medium">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">{item.sku} · {t('returns.available', { count: item.availableQuantity })} · {formatCurrency(item.returnValue)}</p></div>
                    <Input aria-label={t('returns.quantity')} type="number" min="0" max={item.availableQuantity}
                      value={purchaseQuantities[item.productId] ?? ''}
                      onChange={event => setPurchaseQuantities(current => ({ ...current, [item.productId]: event.target.value }))} />
                  </div>
                ))}
                <div className="grid gap-2 sm:grid-cols-2">
                  <select value={reason} onChange={event => setReason(event.target.value as Reason)} className="h-10 rounded-md border bg-background px-3 text-sm">
                    {(['damaged', 'expired', 'wrong_item', 'quality', 'other'] as Reason[]).map(value => <option key={value} value={value}>{reasonLabel(value)}</option>)}
                  </select>
                  <Input placeholder={t('returns.notes')} value={notes} onChange={event => setNotes(event.target.value)} />
                </div>
                <Button className="w-full" disabled={!supplierId || !Object.values(purchaseQuantities).some(value => Number(value) > 0)} onClick={handlePurchaseSubmit}>
                  <Send className="mr-2 h-4 w-4" />{t('returns.submit')}
                </Button>
              </CardContent>
            </Card>
          )}
          <Card><CardHeader><CardTitle className="text-base">{t('returns.history')}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(purchaseReturns ?? []).map(record => (
                <div key={record.id} className="flex items-center justify-between gap-2 border-b py-2">
                  <div><p className="text-sm font-semibold">{record.returnNumber} · {record.supplierName}</p>
                    <p className="text-xs text-muted-foreground">{formatRetailDate(new Date(record.date))} · {statusLabel(record.status)} · {reasonLabel(record.reason)} · {formatCurrency(record.totalValue)}</p>
                    <p className="text-[10px] text-muted-foreground">{record.createdByName}{record.approvedByName ? ` · ${t('returns.approvedBy')}: ${record.approvedByName}` : ''}</p></div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => beginPrint(record, 'purchase')}><Printer className="h-4 w-4" /></Button>
                    {record.status === 'confirmed' && !record.reversalOfId && can('create_purchase_return') &&
                      <Button variant="outline" size="sm" onClick={() => handleReverse(record, 'purchase')}>{t('returns.reverse')}</Button>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="space-y-3">
          {can('create_sales_return') && (
            <Card>
              <CardHeader><CardTitle className="text-base">{t('returns.salesTitle')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Label>{t('returns.transaction')}</Label>
                <select value={transactionId} onChange={event => { setTransactionId(event.target.value); setSalesQuantities({}); }}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{t('returns.selectTransaction')}</option>
                  {returnableTransactions.map(tx => <option key={tx.id} value={tx.id}>{tx.receiptNumber} · {formatCurrency(tx.total)}</option>)}
                </select>
                {selectedTransaction && <p className="text-xs text-muted-foreground">{selectedTransaction.customerName || t('returns.walkIn')} · {new Date(selectedTransaction.date).toLocaleString()}</p>}
                <Label>{t('returns.resolution')}</Label>
                <select value={resolution} onChange={event => setResolution(event.target.value as 'refund' | 'exchange')}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="refund">{t('returns.refund')}</option><option value="exchange">{t('returns.exchange')}</option>
                </select>
                {(salesItems ?? []).map(item => (
                  <div key={item.transactionItemId} className="space-y-2 border-b pb-3">
                    <div className="flex justify-between gap-2"><p className="text-sm font-medium">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">{t('returns.remaining', { count: item.availableQuantity })} · {formatCurrency(item.unitPrice)} / {t('returns.unit')}</p></div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input aria-label={t('returns.quantity')} type="number" min="0" max={item.availableQuantity}
                        value={salesQuantities[item.transactionItemId] ?? ''}
                        onChange={event => setSalesQuantities(current => ({ ...current, [item.transactionItemId]: event.target.value }))} />
                      <select value={conditions[item.transactionItemId] ?? 'resellable'}
                        onChange={event => setConditions(current => ({ ...current, [item.transactionItemId]: event.target.value as Condition }))}
                        className="h-10 rounded-md border bg-background px-2 text-sm">
                        <option value="resellable">{t('returns.resellable')}</option><option value="damaged">{t('returns.damaged')}</option>
                      </select>
                    </div>
                    {resolution === 'exchange' && Number(salesQuantities[item.transactionItemId] ?? 0) > 0 && (
                      <div className="grid grid-cols-[1fr_90px] gap-2">
                        <select value={exchangeProducts[item.transactionItemId] ?? ''}
                          onChange={event => setExchangeProducts(current => ({ ...current, [item.transactionItemId]: event.target.value }))}
                          className="h-10 rounded-md border bg-background px-2 text-sm">
                          <option value="">{t('returns.replacementProduct')}</option>
                          {(products ?? []).map(product => <option key={product.id} value={product.id}>{product.name} · {formatCurrency(product.price)}</option>)}
                        </select>
                        <Input aria-label={t('returns.replacementQuantity')} type="number" min="1"
                          value={exchangeQuantities[item.transactionItemId] ?? '1'}
                          onChange={event => setExchangeQuantities(current => ({ ...current, [item.transactionItemId]: event.target.value }))} />
                      </div>
                    )}
                  </div>
                ))}
                <div className="grid gap-2 sm:grid-cols-2">
                  <select value={reason} onChange={event => setReason(event.target.value as Reason)} className="h-10 rounded-md border bg-background px-3 text-sm">
                    {(['damaged', 'expired', 'wrong_item', 'quality', 'other'] as Reason[]).map(value => <option key={value} value={value}>{reasonLabel(value)}</option>)}
                  </select>
                  <Input placeholder={t('returns.notes')} value={notes} onChange={event => setNotes(event.target.value)} />
                </div>
                <Button className="w-full" disabled={!transactionId || !Object.values(salesQuantities).some(value => Number(value) > 0)} onClick={handleSalesSubmit}>
                  <Send className="mr-2 h-4 w-4" />{t('returns.submit')}
                </Button>
              </CardContent>
            </Card>
          )}
          <Card><CardHeader><CardTitle className="text-base">{t('returns.history')}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(salesReturns ?? []).map(record => (
                <div key={record.id} className="flex items-center justify-between gap-2 border-b py-2">
                  <div><p className="text-sm font-semibold">{record.returnNumber} · {record.receiptNumber}</p>
                    <p className="text-xs text-muted-foreground">{formatRetailDate(new Date(record.date))} · {record.customerName || t('returns.walkIn')} · {statusLabel(record.status)} · {reasonLabel(record.reason)} · {formatCurrency(record.refundValue)}</p>
                    <p className="text-[10px] text-muted-foreground">{record.createdByName}{record.approvedByName ? ` · ${t('returns.approvedBy')}: ${record.approvedByName}` : ''}</p></div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => beginPrint(record, 'sales')}><Printer className="h-4 w-4" /></Button>
                    {record.status === 'confirmed' && !record.reversalOfId && can('create_sales_return') &&
                      <Button variant="outline" size="sm" onClick={() => handleReverse(record, 'sales')}>{t('returns.reverse')}</Button>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approval" className="space-y-3">
          <Card><CardHeader><CardTitle className="text-base">{t('returns.pendingApprovals')}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {pendingPurchaseReturns.map(record => (
                <div key={`p-${record.id}`} className="flex items-center justify-between gap-2 border-b py-2">
                  <div><p className="text-sm font-semibold">{record.returnNumber} · {record.supplierName}</p><p className="text-xs text-muted-foreground">{formatCurrency(record.totalValue)}</p></div>
                  {can('approve_purchase_return') && <Button size="sm" onClick={() => handleApprove(record.id!, 'purchase')}><Check className="mr-1 h-4 w-4" />{t('returns.approve')}</Button>}
                </div>
              ))}
              {pendingSalesReturns.map(record => (
                <div key={`s-${record.id}`} className="flex items-center justify-between gap-2 border-b py-2">
                  <div><p className="text-sm font-semibold">{record.returnNumber} · {record.receiptNumber}</p><p className="text-xs text-muted-foreground">{formatCurrency(record.refundValue)}</p></div>
                  {can('approve_sales_return') && <Button size="sm" onClick={() => handleApprove(record.id!, 'sales')}><Check className="mr-1 h-4 w-4" />{t('returns.approve')}</Button>}
                </div>
              ))}
              {pendingPurchaseReturns.length + pendingSalesReturns.length === 0 && <p className="py-5 text-center text-sm text-muted-foreground">{t('returns.noPending')}</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

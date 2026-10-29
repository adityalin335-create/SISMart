import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ClipboardList, PackageCheck, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LockedPage from '@/components/LockedPage';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/db';
import { confirmReceiving, getReceivingFormData, saveReceivingDraft } from '@/lib/receivings';
import ReturnPrint, { type PrintSize } from '@/components/ReturnPrint';
import type { ReturnPrintData } from '@/components/ReturnPrint';

interface ItemValues {
  quantityReceived: string;
  quantityDamaged: string;
  actualUnitCost: string;
}

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ReceivingFormPage() {
  const { id: routeId } = useParams();
  const receivingId = routeId ? Number(routeId) : undefined;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { can, currentUser } = useAuth();
  const { t, i18n } = useTranslation('settings');
  const existing = useLiveQuery(async () => {
    if (receivingId === undefined || !Number.isSafeInteger(receivingId) || receivingId <= 0) return null;
    const receiving = await db.receivings.get(receivingId);
    if (!receiving) return null;
    const items = await db.receivingItems.where('receivingId').equals(receivingId).toArray();
    return { receiving, items };
  }, [receivingId]);
  const purchaseOrders = useLiveQuery(() => db.purchaseOrders.toArray());
  const [purchaseOrderId, setPurchaseOrderId] = useState(() => searchParams.get('purchaseOrderId') ?? '');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [receivedDate, setReceivedDate] = useState(localDateValue(new Date()));
  const [notes, setNotes] = useState('');
  const [values, setValues] = useState<Record<number, ItemValues>>({});
  const [saving, setSaving] = useState(false);
  const [printSize, setPrintSize] = useState<PrintSize>('A4');
  const [printData, setPrintData] = useState<ReturnPrintData | null>(null);
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const formData = useLiveQuery(
    () => purchaseOrderId ? getReceivingFormData(Number(purchaseOrderId)) : Promise.resolve(null),
    [purchaseOrderId],
  );
  const numberLocale = ({ id: 'id-ID', en: 'en-US', ms: 'ms-MY' } as Record<string, string>)[i18n.language] ?? 'id-ID';
  const currency = useMemo(
    () => new Intl.NumberFormat(numberLocale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }),
    [numberLocale],
  );
  const readOnly = existing?.receiving.status === 'confirmed';

  useEffect(() => {
    if (!existing) return;
    setPurchaseOrderId(String(existing.receiving.purchaseOrderId));
    setDeliveryNote(existing.receiving.supplierDeliveryNoteNumber);
    setReceivedDate(localDateValue(new Date(existing.receiving.receivedAt)));
    setNotes(existing.receiving.notes);
    setValues(Object.fromEntries(existing.items.map(item => [item.purchaseOrderItemId, {
      quantityReceived: String(item.quantityReceived),
      quantityDamaged: String(item.quantityDamaged),
      actualUnitCost: String(item.actualUnitCost),
    }])));
  }, [existing]);

  if (!can('manage_stock_inout')) {
    return <LockedPage title={t('receivings.locked.title')} permissionLabel={t('receivings.locked.permission')} />;
  }
  if (receivingId !== undefined && existing === undefined) {
    return <p className="p-6 text-sm text-muted-foreground">{t('receivings.loading')}</p>;
  }
  if (receivingId !== undefined && !existing) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <p className="text-sm text-muted-foreground">{t('receivings.notFound')}</p>
        <Button asChild variant="outline"><Link to="/receivings">{t('receivings.backToList')}</Link></Button>
      </div>
    );
  }

  const availableOrders = (purchaseOrders ?? []).filter(order =>
    ['submitted', 'partially_received'].includes(order.status),
  );
  const updateItem = (id: number, field: keyof ItemValues, value: string) => {
    setValues(current => ({
      ...current,
      [id]: { quantityReceived: '0', quantityDamaged: '0', actualUnitCost: '0', ...current[id], [field]: value },
    }));
  };

  const handleSave = async (confirm: boolean) => {
    if (!formData || !purchaseOrderId) {
      toast.error(t('receivings.toast.selectPo'));
      return;
    }
    const input = {
      purchaseOrderId: Number(purchaseOrderId),
      supplierDeliveryNoteNumber: deliveryNote,
      receivedAt: new Date(`${receivedDate}T12:00:00`),
      notes,
      createdBy: currentUser?.id,
      createdByName: currentUser?.name ?? t('purchaseOrders.ownerName'),
      items: formData.items.map(item => {
        const itemValue = values[item.id!] ?? {
          quantityReceived: '0',
          quantityDamaged: '0',
          actualUnitCost: String(item.unitCost),
        };
        return {
          purchaseOrderItemId: item.id!,
          quantityReceived: Number(itemValue.quantityReceived),
          quantityDamaged: Number(itemValue.quantityDamaged),
          actualUnitCost: Number(itemValue.actualUnitCost),
        };
      }),
    };
    setSaving(true);
    try {
      const id = await saveReceivingDraft(input, { id: receivingId });
      if (confirm) {
        await confirmReceiving(id, currentUser?.id, currentUser?.name ?? t('purchaseOrders.ownerName'));
        toast.success(t('receivings.toast.confirmed'));
      } else {
        toast.success(t('receivings.toast.saved'));
      }
      navigate(`/receivings/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('receivings.toast.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const isEditable = !existing || existing.receiving.status === 'draft';
  const printReceiving = () => {
    if (!existing) return;
    const acceptedItems = existing.items.map(item => ({
      name: item.productName + (item.quantityDamaged > 0 ? ` (${t('receivings.damaged')}: ${item.quantityDamaged})` : ''),
      sku: item.sku,
      quantity: item.quantityReceived - item.quantityDamaged,
      unit: item.unit,
      value: (item.quantityReceived - item.quantityDamaged) * item.actualUnitCost,
    }));
    setPrintData({
      title: t('receivings.title'),
      number: existing.receiving.receivingNumber,
      date: new Date(existing.receiving.receivedAt),
      user: existing.receiving.createdByName,
      partyLabel: t('returns.supplier'),
      partyName: existing.receiving.supplierName,
      notes: existing.receiving.notes,
      total: acceptedItems.reduce((sum, item) => sum + item.value, 0),
      rows: acceptedItems,
    });
    window.setTimeout(() => window.print(), 50);
  };
  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <ReturnPrint data={printData} storeSettings={storeSettings} size={printSize} />
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to="/receivings" aria-label={t('receivings.backToList')}><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">
            {existing ? existing.receiving.receivingNumber : t('receivings.createTitle')}
          </h1>
          {existing && <p className="text-xs text-muted-foreground">{t('receivings.detailTitle')}</p>}
        </div>
        {existing && (
          <Badge variant={existing.receiving.status === 'confirmed' ? 'default' : 'secondary'}>
            {t(`receivings.status.${existing.receiving.status}`)}
          </Badge>
        )}
        {existing?.receiving.status === 'confirmed' && (
          <div className="flex items-center gap-1 print:hidden">
            <select value={printSize} onChange={event => setPrintSize(event.target.value as PrintSize)}
              aria-label={t('returns.printSize')} className="h-9 rounded-md border bg-background px-2 text-xs">
              <option value="58mm">58 mm</option><option value="80mm">80 mm</option><option value="A4">A4</option>
            </select>
            <Button type="button" size="sm" variant="outline" onClick={printReceiving}>
              <Printer className="mr-1 h-4 w-4" />{t('purchaseOrders.print.button')}
            </Button>
          </div>
        )}
      </div>

      {!existing && (
        <div className="space-y-1.5">
          <Label htmlFor="receiving-po">{t('receivings.purchaseOrder')}</Label>
          <select
            id="receiving-po"
            value={purchaseOrderId}
            onChange={event => {
              setPurchaseOrderId(event.target.value);
              setValues({});
            }}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t('receivings.selectPo')}</option>
            {availableOrders.map(order => (
              <option key={order.id} value={order.id}>{order.poNumber} · {order.supplierName}</option>
            ))}
          </select>
          {availableOrders.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('receivings.noOpenPo')}</p>
          )}
        </div>
      )}

      {formData && (
        <>
          <Card className="border-0 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-primary" />{formData.order.poNumber} · {formData.order.supplierName}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-2 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="receiving-delivery-note">{t('receivings.deliveryNote')}</Label>
                <Input
                  id="receiving-delivery-note"
                  value={deliveryNote}
                  onChange={event => setDeliveryNote(event.target.value)}
                  disabled={!isEditable}
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="receiving-date">{t('receivings.receivedDate')}</Label>
                <Input
                  id="receiving-date"
                  type="date"
                  value={receivedDate}
                  onChange={event => setReceivedDate(event.target.value)}
                  disabled={!isEditable}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="receiving-notes">{t('receivings.notes')}</Label>
                <Input
                  id="receiving-notes"
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  disabled={!isEditable}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">{t('receivings.itemsTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y">
              {formData.items.map(item => {
                const current = values[item.id!] ?? {
                  quantityReceived: existing ? '0' : '0',
                  quantityDamaged: '0',
                  actualUnitCost: String(item.unitCost),
                };
                const effective = existing?.items.find(row => row.purchaseOrderItemId === item.id);
                const shown = existing?.receiving.status === 'confirmed' && effective ? {
                  quantityReceived: String(effective.quantityReceived),
                  quantityDamaged: String(effective.quantityDamaged),
                  actualUnitCost: String(effective.actualUnitCost),
                } : current;
                return (
                  <div key={item.id} className="p-4 space-y-3">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.sku} · {t('receivings.ordered')}: {item.quantity} · {t('receivings.receivedToDate')}: {item.receivedToDate} · {t('receivings.remaining')}: {item.remaining} {item.unit}
                        </p>
                      </div>
                      <PackageCheck className="w-4 h-4 text-primary shrink-0" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor={`received-${item.id}`} className="text-xs">{t('receivings.quantityReceived')}</Label>
                        <Input id={`received-${item.id}`} type="number" min="0" step="any" value={shown.quantityReceived}
                          disabled={!isEditable} onChange={event => updateItem(item.id!, 'quantityReceived', event.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`damaged-${item.id}`} className="text-xs">{t('receivings.quantityDamaged')}</Label>
                        <Input id={`damaged-${item.id}`} type="number" min="0" step="any" value={shown.quantityDamaged}
                          disabled={!isEditable} onChange={event => updateItem(item.id!, 'quantityDamaged', event.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`cost-${item.id}`} className="text-xs">{t('receivings.actualUnitCost')} ({currency.format(item.unitCost)})</Label>
                        <Input id={`cost-${item.id}`} type="number" min="0" step="any" value={shown.actualUnitCost}
                          disabled={!isEditable} onChange={event => updateItem(item.id!, 'actualUnitCost', event.target.value)} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('receivings.quantityAccepted')}: {Math.max(0, Number(shown.quantityReceived) - Number(shown.quantityDamaged))} {item.unit}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {isEditable ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => void handleSave(false)}>
                {t('receivings.saveDraft')}
              </Button>
              <Button type="button" disabled={saving} onClick={() => void handleSave(true)}>
                <Check className="w-4 h-4 mr-2" />{saving ? t('receivings.saving') : t('receivings.confirm')}
              </Button>
            </div>
          ) : existing && (
            <p className="text-xs text-muted-foreground text-center">
              {t('receivings.confirmedBy', { name: existing.receiving.confirmedByName ?? '-', date: existing.receiving.confirmedAt ? new Intl.DateTimeFormat(numberLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(existing.receiving.confirmedAt)) : '-' })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

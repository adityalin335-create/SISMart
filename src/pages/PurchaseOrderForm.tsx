import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NumberInput from '@/components/NumberInput';
import ProductPicker from '@/components/ProductPicker';
import SearchableSelect from '@/components/SearchableSelect';
import LockedPage from '@/components/LockedPage';
import { db, isStockManaged, type Product } from '@/lib/db';
import { savePurchaseOrder, type PurchaseOrderItemInput } from '@/lib/purchase-orders';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';

const LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };
const INDONESIA_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const toDateInput = (date: Date) => {
  const parts = Object.fromEntries(INDONESIA_DATE_FORMATTER.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const fromDateInput = (date: string) => new Date(`${date}T00:00:00+07:00`);

interface DraftItem extends PurchaseOrderItemInput {
  productName: string;
  sku: string;
  unit: string;
}

export default function PurchaseOrderFormPage() {
  const { id: routeId } = useParams();
  const orderId = routeId ? Number(routeId) : undefined;
  const isEditing = orderId !== undefined;
  const navigate = useNavigate();
  const { currentUser, can } = useAuth();
  const { t, i18n } = useTranslation('settings');
  const suppliers = useLiveQuery(() => db.suppliers.where('isDeleted').equals(0).toArray());
  const products = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const loadedOrder = useLiveQuery(async () => {
    if (orderId === undefined) return undefined;
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return { order: null, items: [] };
    const savedOrder = await db.purchaseOrders.get(orderId);
    return {
      order: savedOrder ?? null,
      items: savedOrder
        ? await db.purchaseOrderItems.where('purchaseOrderId').equals(orderId).toArray()
        : [],
    };
  }, [orderId]);
  const order = loadedOrder?.order ?? undefined;
  const savedItems = loadedOrder?.items;
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(toDateInput(new Date()));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const numberLocale = LOCALES[i18n.language] ?? 'id-ID';
  const currency = useMemo(
    () => new Intl.NumberFormat(numberLocale, { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }),
    [numberLocale],
  );

  useEffect(() => {
    if (!isEditing || !order || !savedItems || initialized) return;
    setSupplierId(String(order.supplierId));
    setOrderDate(toDateInput(new Date(order.orderDate)));
    setExpectedDate(order.expectedDate ? toDateInput(new Date(order.expectedDate)) : '');
    setNotes(order.notes);
    setItems(savedItems.map(item => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      unit: item.unit,
      quantity: item.quantity,
      unitCost: item.unitCost,
    })));
    setInitialized(true);
  }, [initialized, isEditing, order, savedItems]);

  if (!can('manage_stock_inout')) {
    return <LockedPage title={t('purchaseOrders.locked.title')} permissionLabel={t('purchaseOrders.locked.permission')} />;
  }

  if (isEditing && loadedOrder === undefined) {
    return <p className="p-6 text-sm text-muted-foreground">{t('purchaseOrders.loading')}</p>;
  }
  if (isEditing && loadedOrder?.order === null) {
    return <p className="p-6 text-sm text-muted-foreground">{t('purchaseOrders.notFound')}</p>;
  }
  if (isEditing && order && order.status !== 'draft') {
    return (
      <div className="px-4 pt-6 space-y-4">
        <p className="text-sm text-muted-foreground">{t('purchaseOrders.editDraftOnly')}</p>
        <Button asChild variant="outline"><Link to={`/purchase-orders/${order.id}`}>{t('purchaseOrders.backToDetail')}</Link></Button>
      </div>
    );
  }
  if (suppliers === undefined || products === undefined || (isEditing && (!order || savedItems === undefined))) {
    return <p className="p-6 text-sm text-muted-foreground">{t('purchaseOrders.loading')}</p>;
  }

  const availableProducts = products.filter(isStockManaged);
  const selectedSupplier = suppliers.find(supplier => supplier.id === Number(supplierId));
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const existingProductIds = new Set(items.map(item => item.productId));

  const handleAddProduct = (value: string) => {
    const product = availableProducts.find(candidate => candidate.id === Number(value));
    if (!product) return;
    if (existingProductIds.has(product.id!)) {
      toast.error(t('purchaseOrders.toast.duplicateProduct'));
      return;
    }
    setItems(current => [...current, {
      productId: product.id!,
      productName: product.name,
      sku: product.sku,
      unit: product.unit,
      quantity: 1,
      unitCost: product.hpp,
    }]);
  };

  const handleSave = async (submit: boolean) => {
    if (saving) return;
    if (!selectedSupplier) {
      toast.error(t('purchaseOrders.toast.selectSupplier'));
      return;
    }
    if (items.length === 0) {
      toast.error(t('purchaseOrders.toast.addItem'));
      return;
    }
    if (expectedDate && expectedDate < orderDate) {
      toast.error(t('purchaseOrders.toast.expectedDateBeforeOrderDate'));
      return;
    }

    setSaving(true);
    try {
      const savedId = await savePurchaseOrder({
        supplierId: selectedSupplier.id!,
        orderDate: fromDateInput(orderDate),
        expectedDate: expectedDate ? fromDateInput(expectedDate) : undefined,
        notes,
        items,
        createdBy: currentUser?.id,
        createdByName: currentUser?.name ?? t('purchaseOrders.ownerName'),
      }, { id: orderId, submit });
      toast.success(t(submit ? 'purchaseOrders.toast.submitted' : 'purchaseOrders.toast.saved'));
      navigate(`/purchase-orders/${savedId}`, { replace: true });
    } catch (error) {
      console.error('[PurchaseOrders] Gagal menyimpan PO:', error);
      toast.error(error instanceof Error ? error.message : t('purchaseOrders.toast.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to={isEditing ? `/purchase-orders/${orderId}` : '/purchase-orders'} aria-label={t('purchaseOrders.back')}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t(isEditing ? 'purchaseOrders.editTitle' : 'purchaseOrders.createTitle')}</h1>
          {order?.poNumber && <p className="text-xs text-muted-foreground">{order.poNumber}</p>}
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label>{t('purchaseOrders.form.supplier')}</Label>
            <SearchableSelect
              value={supplierId}
              onChange={setSupplierId}
              placeholder={t('purchaseOrders.form.selectSupplier')}
              options={suppliers.map(supplier => ({ value: String(supplier.id), label: supplier.name }))}
            />
          </div>
          {selectedSupplier && (
            <p className="text-xs text-muted-foreground">{selectedSupplier.phone || t('purchaseOrders.form.noSupplierPhone')}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="po-order-date">{t('purchaseOrders.form.orderDate')}</Label>
              <Input id="po-order-date" type="date" value={orderDate} onChange={event => setOrderDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-expected-date">{t('purchaseOrders.form.expectedDate')}</Label>
              <Input id="po-expected-date" type="date" value={expectedDate} onChange={event => setExpectedDate(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('purchaseOrders.form.addProduct')}</Label>
            <ProductPicker
              products={availableProducts}
              value=""
              onChange={handleAddProduct}
              placeholder={t('purchaseOrders.form.searchProduct')}
              showHpp
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {items.map((item, index) => (
          <Card key={item.productId} className="border-0 shadow-sm">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">{item.sku} · {item.unit}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive shrink-0"
                  onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={t('purchaseOrders.form.removeItem', { product: item.productName })}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t('purchaseOrders.form.quantity')}</Label>
                  <NumberInput
                    value={String(item.quantity)}
                    onChange={value => setItems(current => current.map((currentItem, itemIndex) =>
                      itemIndex === index ? { ...currentItem, quantity: Number(value) || 0 } : currentItem
                    ))}
                    decimal
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('purchaseOrders.form.unitCost')}</Label>
                  <NumberInput
                    value={String(item.unitCost)}
                    onChange={value => setItems(current => current.map((currentItem, itemIndex) =>
                      itemIndex === index ? { ...currentItem, unitCost: Number(value) || 0 } : currentItem
                    ))}
                  />
                </div>
              </div>
              <p className="text-right text-sm font-semibold">{currency.format(item.quantity * item.unitCost)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="po-notes">{t('purchaseOrders.form.notes')}</Label>
        <Input id="po-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} />
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('purchaseOrders.form.estimatedTotal')}</span>
          <span className="text-lg font-bold">{currency.format(subtotal)}</span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={() => void handleSave(false)}>
          {saving ? t('purchaseOrders.saving') : t('purchaseOrders.saveDraft')}
        </Button>
        <Button type="button" disabled={saving} onClick={() => void handleSave(true)}>
          <Plus className="w-4 h-4 mr-1" />{saving ? t('purchaseOrders.saving') : t('purchaseOrders.submit')}
        </Button>
      </div>
    </div>
  );
}

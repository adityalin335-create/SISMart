import type { PurchaseOrder, PurchaseOrderItem, StoreSettings } from '@/lib/db';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { PrintSize } from '@/components/ReturnPrint';

const LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

interface PurchaseOrderPrintProps {
  order: PurchaseOrder;
  items: PurchaseOrderItem[];
  storeSettings?: StoreSettings;
  size?: PrintSize;
}

export default function PurchaseOrderPrint({ order, items, storeSettings, size = 'A4' }: PurchaseOrderPrintProps) {
  const { t, i18n } = useTranslation('settings');
  const locale = LOCALES[i18n.language] ?? 'id-ID';
  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });

  return createPortal(
    <article className={`po-print-document po-print-${size.replace('mm', '')}`} aria-hidden="true">
      <header className="po-print-header">
        <h1>{storeSettings?.storeName || t('purchaseOrders.print.storeFallback')}</h1>
        {storeSettings?.address && <p>{storeSettings.address}</p>}
        {storeSettings?.phone && <p>{storeSettings.phone}</p>}
      </header>

      <div className="po-print-title">
        <h2>{t('purchaseOrders.print.title')}</h2>
        <p>{order.poNumber}</p>
      </div>

      <section className="po-print-meta">
        <div>
          <span>{t('purchaseOrders.print.poDate')}</span>
          <strong>{date.format(new Date(order.orderDate))}</strong>
        </div>
        <div>
          <span>{t('purchaseOrders.print.supplier')}</span>
          <strong>{order.supplierName}</strong>
        </div>
      </section>

      <table className="po-print-table">
        <thead>
          <tr>
            <th className="po-print-number">{t('purchaseOrders.print.number')}</th>
            <th>{t('purchaseOrders.print.item')}</th>
            <th className="po-print-number">{t('purchaseOrders.print.quantity')}</th>
            <th className="po-print-number">{t('purchaseOrders.print.unitPrice')}</th>
            <th className="po-print-number">{t('purchaseOrders.print.subtotal')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id}>
              <td className="po-print-number">{item.sku}</td>
              <td>{item.productName}</td>
              <td className="po-print-number">{item.quantity} {item.unit}</td>
              <td className="po-print-number">{currency.format(item.unitCost)}</td>
              <td className="po-print-number">{currency.format(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={4}>{t('purchaseOrders.print.subtotal')}</th>
            <th className="po-print-number">{currency.format(order.subtotal)}</th>
          </tr>
          <tr className="po-print-grand-total">
            <th colSpan={4}>{t('purchaseOrders.print.grandTotal')}</th>
            <th className="po-print-number">{currency.format(order.subtotal)}</th>
          </tr>
        </tfoot>
      </table>

      <section className="po-print-notes">
        <h3>{t('purchaseOrders.print.notes')}</h3>
        <p>{order.notes || t('purchaseOrders.print.noNotes')}</p>
      </section>
      <footer className="po-print-signatures">
        <span>{t('returns.createdBy')}</span>
        <span>{t('returns.approvedBy')}</span>
      </footer>
    </article>,
    document.body,
  );
}

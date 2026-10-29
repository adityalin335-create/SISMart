import { createPortal } from 'react-dom';
import type { StoreSettings } from '@/lib/db';

export interface ReturnPrintData {
  title: string;
  number: string;
  date: Date;
  user: string;
  partyLabel: string;
  partyName: string;
  reason?: string;
  notes: string;
  total: number;
  rows: Array<{ name: string; sku: string; quantity: number; unit: string; value: number }>;
}

export type PrintSize = '58mm' | '80mm' | 'A4';

export default function ReturnPrint({
  data,
  storeSettings,
  size,
}: {
  data: ReturnPrintData | null;
  storeSettings?: StoreSettings;
  size: PrintSize;
}) {
  if (!data) return null;
  const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

  return createPortal(
    <article className={`return-print-document return-print-${size.replace('mm', '')}`} aria-hidden="true">
      <header>
        <h1>{storeSettings?.storeName || 'SISMart'}</h1>
        {storeSettings?.address && <p>{storeSettings.address}</p>}
        {storeSettings?.phone && <p>{storeSettings.phone}</p>}
      </header>
      <h2>{data.title}</h2>
      <p className="return-print-number">{data.number}</p>
      <dl>
        <div><dt>Tanggal</dt><dd>{date.format(new Date(data.date))}</dd></div>
        <div><dt>Pengguna</dt><dd>{data.user}</dd></div>
        <div><dt>{data.partyLabel}</dt><dd>{data.partyName || '-'}</dd></div>
      </dl>
      {data.reason && <p><strong>Alasan:</strong> {data.reason}</p>}
      <table>
        <thead><tr><th>Barang</th><th>Qty</th><th>Nilai</th></tr></thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr key={`${row.sku}-${index}`}>
              <td>{row.name}<small>{row.sku}</small></td>
              <td>{row.quantity} {row.unit}</td>
              <td>{currency.format(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="return-print-total"><strong>Total</strong><strong>{currency.format(data.total)}</strong></p>
      <section><strong>Catatan</strong><p>{data.notes || '-'}</p></section>
      {size === 'A4' && <footer><span>Dibuat oleh</span><span>Disetujui oleh</span></footer>}
    </article>,
    document.body,
  );
}

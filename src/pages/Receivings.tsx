import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import LockedPage from '@/components/LockedPage';
import { db } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';

const LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

export default function ReceivingsPage() {
  const { can } = useAuth();
  const { t, i18n } = useTranslation('settings');
  const [search, setSearch] = useState('');
  const receivings = useLiveQuery(async () => {
    const records = await db.receivings.orderBy('receivedAt').reverse().toArray();
    const orders = await db.purchaseOrders.bulkGet(records.map(record => record.purchaseOrderId));
    return records.map((record, index) => ({ record, poNumber: orders[index]?.poNumber ?? '' }));
  });
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(LOCALES[i18n.language] ?? 'id-ID', { dateStyle: 'medium' }),
    [i18n.language],
  );

  if (!can('manage_stock_inout')) {
    return <LockedPage title={t('receivings.locked.title')} permissionLabel={t('receivings.locked.permission')} />;
  }

  const query = search.trim().toLowerCase();
  const filtered = (receivings ?? []).filter(({ record, poNumber }) =>
    [record.receivingNumber, record.supplierName, record.supplierDeliveryNoteNumber, poNumber]
      .some(value => value.toLowerCase().includes(query)),
  );

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ArrowDownToLine className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-xl font-bold truncate">{t('receivings.title')}</h1>
        </div>
        <Button asChild size="sm" className="h-9 gap-1.5 shrink-0">
          <Link to="/receivings/new"><Plus className="w-4 h-4" />{t('receivings.create')}</Link>
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={t('receivings.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {receivings === undefined ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('receivings.loading')}</p>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <ArrowDownToLine className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">{query ? t('receivings.noResults') : t('receivings.empty')}</p>
          {!query && (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/receivings/new"><Plus className="w-4 h-4 mr-1" />{t('receivings.create')}</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ record, poNumber }) => (
            <Link key={record.id} to={`/receivings/${record.id}`} className="block">
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{record.receivingNumber}</p>
                      <Badge variant={record.status === 'confirmed' ? 'default' : 'secondary'}>
                        {t(`receivings.status.${record.status}`)}
                      </Badge>
                    </div>
                    <p className="text-sm mt-1 truncate">{record.supplierName} · {poNumber}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {record.supplierDeliveryNoteNumber || t('receivings.noDeliveryNote')} · {dateFormatter.format(new Date(record.receivedAt))}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

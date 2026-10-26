import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LockedPage from '@/components/LockedPage';
import { db, type PurchaseOrderStatus } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';

const LOCALES: Record<string, string> = { id: 'id-ID', en: 'en-US', ms: 'ms-MY' };

export default function PurchaseOrdersPage() {
  const { can } = useAuth();
  const { t, i18n } = useTranslation('settings');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PurchaseOrderStatus>('all');

  const orders = useLiveQuery(() => db.purchaseOrders.orderBy('orderDate').reverse().toArray());
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

  const query = search.trim().toLowerCase();
  const filteredOrders = (orders ?? []).filter(order => {
    const matchesSearch = order.poNumber.toLowerCase().includes(query) ||
      order.supplierName.toLowerCase().includes(query);
    return matchesSearch && (statusFilter === 'all' || order.status === statusFilter);
  });

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-xl font-bold truncate">{t('purchaseOrders.title')}</h1>
        </div>
        <Button asChild size="sm" className="h-9 gap-1.5 shrink-0">
          <Link to="/purchase-orders/new"><Plus className="w-4 h-4" />{t('purchaseOrders.create')}</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_190px] gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t('purchaseOrders.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={value => setStatusFilter(value as typeof statusFilter)}>
          <SelectTrigger aria-label={t('purchaseOrders.filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('purchaseOrders.status.all')}</SelectItem>
            <SelectItem value="draft">{t('purchaseOrders.status.draft')}</SelectItem>
            <SelectItem value="submitted">{t('purchaseOrders.status.submitted')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {orders === undefined ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('purchaseOrders.loading')}</p>
      ) : filteredOrders.length === 0 ? (
        <div className="py-12 text-center">
          <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">{query || statusFilter !== 'all' ? t('purchaseOrders.noResults') : t('purchaseOrders.empty')}</p>
          {!query && statusFilter === 'all' && (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/purchase-orders/new"><Plus className="w-4 h-4 mr-1" />{t('purchaseOrders.create')}</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredOrders.map(order => (
            <Link key={order.id} to={`/purchase-orders/${order.id}`} className="block">
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{order.poNumber}</p>
                      <Badge variant={order.status === 'submitted' ? 'default' : 'secondary'}>
                        {t(`purchaseOrders.status.${order.status}`)}
                      </Badge>
                    </div>
                    <p className="text-sm mt-1 truncate">{order.supplierName}</p>
                    <p className="text-xs text-muted-foreground mt-1">{dateFormatter.format(new Date(order.orderDate))}</p>
                  </div>
                  <p className="text-sm font-bold text-right shrink-0">{currency.format(order.subtotal)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

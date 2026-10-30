import { Home, Boxes, BarChart3, MoreHorizontal, ShoppingCart } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const navItems = [
  { to: '/', icon: Home, key: 'nav.home' as const },
  { to: '/cashier-workspace', icon: ShoppingCart, key: 'nav.cashier' as const },
  { to: '/inventory', icon: Boxes, key: 'nav.inventory' as const },
  { to: '/reports', icon: BarChart3, key: 'nav.reports' as const },
  { to: '/more', icon: MoreHorizontal, key: 'nav.more' as const },
];

export default function BottomNav() {
  const { t } = useTranslation('common');
  const location = useLocation();

  const sectionActive = (to: string) => {
    const { pathname, search } = location;
    if (to === '/') return pathname === '/';
    if (to === '/cashier-workspace') {
      return ['/cashier-workspace', '/cashier', '/history'].includes(pathname) ||
        (pathname === '/returns' && new URLSearchParams(search).get('tab') === 'sales');
    }
    if (to === '/inventory') {
      return pathname === '/inventory' || pathname.startsWith('/purchase-orders') ||
        pathname.startsWith('/receivings') || pathname === '/stock-report' ||
        pathname === '/stock-opname' || pathname === '/settings/stock-opname' ||
        (pathname === '/returns' && new URLSearchParams(search).get('tab') !== 'sales') ||
        /^\/products\/\d+\/stock-card$/.test(pathname);
    }
    if (to === '/reports') return pathname === '/reports';
    return pathname === '/more' || pathname === '/settings' ||
      (pathname.startsWith('/settings/') && pathname !== '/settings/stock-opname') ||
      pathname === '/users' || pathname === '/products' || pathname === '/supplier';
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-end justify-around h-16 max-w-lg md:max-w-6xl mx-auto px-2 md:px-4">
        {navItems.map(({ to, icon: Icon, key, isCta }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-w-[52px] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition-colors',
                isActive || sectionActive(to) ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            {({ isActive }) => {
              const active = isActive || sectionActive(to);
              return <>
                <div className={cn(
                  'flex h-7 w-10 items-center justify-center rounded-full transition-colors',
                  active && 'bg-primary/10',
                )}>
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                </div>
                <span className="text-[10px] font-semibold leading-tight">{t(key)}</span>
              </>;
            }}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

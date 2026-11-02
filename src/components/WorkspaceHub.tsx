import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import type { PermissionKey } from '@/lib/db';

export interface WorkspaceItem {
  key: string;
  descriptionKey: string;
  to: string;
  icon: LucideIcon;
  permission?: PermissionKey;
  anyPermissions?: PermissionKey[];
  ownerOnly?: boolean;
}

export interface WorkspaceGroup {
  key: string;
  items: WorkspaceItem[];
}

export default function WorkspaceHub({
  titleKey,
  descriptionKey,
  groups,
}: {
  titleKey: string;
  descriptionKey: string;
  groups: WorkspaceGroup[];
}) {
  const { t } = useTranslation('common');
  const { can, isOwner } = useAuth();

  return (
    <div className="px-4 pt-6 pb-24 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t(titleKey)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(descriptionKey)}</p>
      </header>
      {groups.map(group => {
        const items = group.items.filter(item =>
          (!item.permission || can(item.permission)) &&
          (!item.anyPermissions || item.anyPermissions.some(permission => can(permission))) &&
          (!item.ownerOnly || isOwner),
        );
        if (items.length === 0) return null;

        return (
          <section key={group.key} aria-labelledby={`workspace-${group.key}`}>
            <div className="mb-3 flex items-center gap-3">
              <h2 id={`workspace-${group.key}`} className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`workspaces.groups.${group.key}`)}
              </h2>
              <div aria-hidden="true" className="h-px flex-1 bg-border/70" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {items.map(item => {
                const Icon = item.icon;
                return (
                  <Link key={item.key} to={item.to} className="group min-w-0">
                    <Card className="h-full border-0 shadow-sm transition-shadow group-hover:shadow-md">
                      <CardContent className="flex h-full min-h-32 flex-col items-start p-4">
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex w-full items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-snug">{t(`workspaces.items.${item.key}`)}</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(item.descriptionKey)}</p>
                          </div>
                          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

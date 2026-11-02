import { ArchiveRestore, Cloud, Package, Printer, Settings, Tags, Truck, UserRound, Users } from 'lucide-react';
import WorkspaceHub from '@/components/WorkspaceHub';

export default function MoreWorkspace() {
  return (
    <WorkspaceHub
      titleKey="workspaces.more.title"
      descriptionKey="workspaces.more.description"
      groups={[
        {
          key: 'masterData',
          items: [
            { key: 'products', descriptionKey: 'workspaces.descriptions.products', to: '/products', icon: Package, permission: 'manage_products' },
            { key: 'categories', descriptionKey: 'workspaces.descriptions.categories', to: '/settings/product-category', icon: Tags, permission: 'manage_categories_payments' },
          ],
        },
        {
          key: 'businessRelations',
          items: [
            { key: 'suppliers', descriptionKey: 'workspaces.descriptions.suppliers', to: '/supplier', icon: Truck, permission: 'manage_supplier' },
            { key: 'customers', descriptionKey: 'workspaces.descriptions.customers', to: '/customers', icon: UserRound, permission: 'manage_customers' },
          ],
        },
        {
          key: 'administration',
          items: [
            { key: 'users', descriptionKey: 'workspaces.descriptions.users', to: '/users', icon: Users, ownerOnly: true },
            { key: 'backupRestore', descriptionKey: 'workspaces.descriptions.backupRestore', to: '/settings/backup', icon: ArchiveRestore, permission: 'manage_backup' },
            { key: 'cloudBackup', descriptionKey: 'workspaces.descriptions.cloudBackup', to: '/settings/cloud-backup', icon: Cloud, permission: 'manage_backup' },
          ],
        },
        {
          key: 'settings',
          items: [
            { key: 'storeSettings', descriptionKey: 'workspaces.descriptions.storeSettings', to: '/settings#store-settings', icon: Settings, permission: 'manage_store_settings' },
            { key: 'printer', descriptionKey: 'workspaces.descriptions.printer', to: '/settings/receipt', icon: Printer, permission: 'manage_store_settings' },
            { key: 'system', descriptionKey: 'workspaces.descriptions.system', to: '/settings#system-settings', icon: Settings, permission: 'manage_store_settings' },
          ],
        },
      ]}
    />
  );
}

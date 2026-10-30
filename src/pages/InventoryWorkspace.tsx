import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, ClipboardList, Package, PackageCheck, RotateCcw, TrendingUp } from 'lucide-react';
import WorkspaceHub from '@/components/WorkspaceHub';

export default function InventoryWorkspace() {
  return (
    <WorkspaceHub
      titleKey="workspaces.inventory.title"
      descriptionKey="workspaces.inventory.description"
      groups={[{
        key: 'inventory',
        items: [
          { key: 'purchaseOrders', descriptionKey: 'workspaces.descriptions.purchaseOrders', to: '/purchase-orders', icon: ClipboardList, permission: 'manage_stock_inout' },
          { key: 'receivings', descriptionKey: 'workspaces.descriptions.receivings', to: '/receivings', icon: PackageCheck, permission: 'manage_stock_inout' },
          { key: 'purchaseReturn', descriptionKey: 'workspaces.descriptions.purchaseReturn', to: '/returns?tab=purchase', icon: RotateCcw, anyPermissions: ['create_purchase_return', 'approve_purchase_return'] },
          { key: 'stockCard', descriptionKey: 'workspaces.descriptions.stockCard', to: '/products', icon: Package, anyPermissions: ['manage_stock_inout', 'view_reports'] },
          { key: 'stockIn', descriptionKey: 'workspaces.descriptions.stockIn', to: '/stock-in', icon: ArrowDownToLine, permission: 'manage_stock_inout' },
          { key: 'stockOut', descriptionKey: 'workspaces.descriptions.stockOut', to: '/stock-out', icon: ArrowUpFromLine, permission: 'manage_stock_inout' },
          { key: 'stockOpname', descriptionKey: 'workspaces.descriptions.stockOpname', to: '/stock-opname', icon: ClipboardCheck, permission: 'manage_stock_inout' },
          { key: 'stockReport', descriptionKey: 'workspaces.descriptions.stockReport', to: '/stock-report', icon: TrendingUp, permission: 'view_reports' },
        ],
      }]}
    />
  );
}

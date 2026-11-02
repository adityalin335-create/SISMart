import { HandCoins, Receipt, RotateCcw, ShoppingCart } from 'lucide-react';
import WorkspaceHub from '@/components/WorkspaceHub';

export default function CashierWorkspace() {
  return (
    <WorkspaceHub
      titleKey="workspaces.cashier.title"
      descriptionKey="workspaces.cashier.description"
      groups={[
        {
          key: 'sales',
          items: [
            { key: 'cashier', descriptionKey: 'workspaces.descriptions.cashier', to: '/cashier', icon: ShoppingCart, permission: 'create_transaction' },
            { key: 'transactionHistory', descriptionKey: 'workspaces.descriptions.transactionHistory', to: '/history', icon: Receipt },
          ],
        },
        {
          key: 'customerService',
          items: [
            { key: 'salesReturn', descriptionKey: 'workspaces.descriptions.salesReturn', to: '/returns?tab=sales', icon: RotateCcw, anyPermissions: ['create_sales_return', 'approve_sales_return'] },
            { key: 'debts', descriptionKey: 'workspaces.descriptions.debts', to: '/debts', icon: HandCoins, permission: 'manage_customers' },
          ],
        },
      ]}
    />
  );
}

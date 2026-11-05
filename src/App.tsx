import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, useEffect } from "react";
import { initAnalytics } from "@/lib/analytics";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { useAppUpdate } from "@/hooks/use-app-update";
import { AuthProvider } from "@/hooks/use-auth";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { CloudAuthProvider } from "@/hooks/use-cloud-auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import AppLayout from "./components/layout/AppLayout";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Cashier = lazy(() => import("./pages/Cashier"));
const Products = lazy(() => import("./pages/Products"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const SupplierPage = lazy(() => import("./pages/Supplier"));
const CustomersPage = lazy(() => import("./pages/Customers"));
const StockInPage = lazy(() => import("./pages/StockIn"));
const StockOutPage = lazy(() => import("./pages/StockOut"));
const TransactionHistory = lazy(() => import("./pages/TransactionHistory"));
const StockReport = lazy(() => import("./pages/StockReport"));
const UsersPage = lazy(() => import("./pages/Users"));
const ExpensesPage = lazy(() => import("./pages/Expenses"));
const DebtsPage = lazy(() => import("./pages/Debts"));
const PaymentMethodsSettings = lazy(() => import("./pages/settings/PaymentMethodsSettings"));
const ProductCategoriesSettings = lazy(() => import("./pages/settings/ProductCategoriesSettings"));
const ExpenseCategoriesSettings = lazy(() => import("./pages/settings/ExpenseCategoriesSettings"));
const UnitsSettings = lazy(() => import("./pages/settings/UnitsSettings"));
const ThemeSettings = lazy(() => import("./pages/settings/ThemeSettings"));
const ReceiptSettings = lazy(() => import("./pages/settings/ReceiptSettings"));
const IssueReport = lazy(() => import("./pages/settings/IssueReport"));
const StockOpname = lazy(() => import("./pages/settings/StockOpname"));
const PurchaseOrdersPage = lazy(() => import("./pages/PurchaseOrders"));
const PurchaseOrderFormPage = lazy(() => import("./pages/PurchaseOrderForm"));
const PurchaseOrderDetailPage = lazy(() => import("./pages/PurchaseOrderDetail"));
const ReceivingsPage = lazy(() => import("./pages/Receivings"));
const ReceivingFormPage = lazy(() => import("./pages/ReceivingForm"));
const StockCardPage = lazy(() => import("./pages/StockCard"));
const ReturnsPage = lazy(() => import("./pages/Returns"));
const BackupRestoreSettings = lazy(() => import("./pages/settings/BackupRestoreSettings"));
const CashierWorkspace = lazy(() => import("./pages/CashierWorkspace"));
const InventoryWorkspace = lazy(() => import("./pages/InventoryWorkspace"));
const MoreWorkspace = lazy(() => import("./pages/MoreWorkspace"));
const CloudBackupSettings = lazy(() => import("./pages/settings/CloudBackupSettings"));
const CloudStoreSettings = lazy(() => import("./pages/settings/CloudStoreSettings"));
const CloudOnlineStoreSettings = lazy(() => import("./pages/settings/CloudOnlineStoreSettings"));
const CloudAutoBackupSettings = lazy(() => import("./pages/settings/CloudAutoBackupSettings"));
const CloudHistorySettings = lazy(() => import("./pages/settings/CloudHistorySettings"));

const queryClient = new QueryClient();
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

const App = () => {
  // Aktifkan pengecekan & unduhan update otomatis untuk Android
  useAppUpdate();

  useEffect(() => {
    try {
      initAnalytics();
    } catch (err) {
      console.error("[Analytics] Initialization failed:", err);
    }

    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(err => {
        console.warn("Gagal mengatur StatusBar overlay:", err);
      });
      document.documentElement.classList.add('is-native');
    }

    // Pemicu awal background sync saat startup
    void import('@/lib/sync').then(({ triggerBackgroundSync }) => {
      triggerBackgroundSync();
    }).catch(error => {
      console.error('[Sync] Failed to initialize background sync:', error);
    });

    const handleOnline = () => {
      console.log('[Sync] Jaringan kembali online, memicu sync...');
      void import('@/lib/sync').then(({ triggerBackgroundSync }) => {
        triggerBackgroundSync();
      }).catch(error => {
        console.error('[Sync] Failed to start background sync:', error);
      });
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
               <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <CloudAuthProvider>
                <AnalyticsTracker />
              <Routes>
                <Route element={<AppLayout />}>
                  <Route
                    path="/cashier-workspace"
                    element={
                      <ErrorBoundary>
                        <CashierWorkspace />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/inventory"
                    element={
                      <ErrorBoundary>
                        <InventoryWorkspace />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/more"
                    element={
                      <ErrorBoundary>
                        <MoreWorkspace />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/"
                    element={
                      <ErrorBoundary>
                        <Dashboard />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/cashier"
                    element={
                      <ErrorBoundary>
                        <Cashier />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/products"
                    element={
                      <ErrorBoundary>
                        <Products />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/products/:id/stock-card"
                    element={
                      <ErrorBoundary>
                        <StockCardPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/reports"
                    element={
                      <ErrorBoundary>
                        <Reports />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <ErrorBoundary>
                        <Settings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/supplier"
                    element={
                      <ErrorBoundary>
                        <SupplierPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/customers"
                    element={
                      <ErrorBoundary>
                        <CustomersPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/stock-in"
                    element={
                      <ErrorBoundary>
                        <StockInPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/stock-out"
                    element={
                      <ErrorBoundary>
                        <StockOutPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/history"
                    element={
                      <ErrorBoundary>
                        <TransactionHistory />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/returns"
                    element={
                      <ErrorBoundary>
                        <ReturnsPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/stock-report"
                    element={
                      <ErrorBoundary>
                        <StockReport />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/stock-opname"
                    element={
                      <ErrorBoundary>
                        <StockOpname />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/purchase-orders"
                    element={
                      <ErrorBoundary>
                        <PurchaseOrdersPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/purchase-orders/new"
                    element={
                      <ErrorBoundary>
                        <PurchaseOrderFormPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/purchase-orders/:id/edit"
                    element={
                      <ErrorBoundary>
                        <PurchaseOrderFormPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/purchase-orders/:id"
                    element={
                      <ErrorBoundary>
                        <PurchaseOrderDetailPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/receivings"
                    element={
                      <ErrorBoundary>
                        <ReceivingsPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/receivings/new"
                    element={
                      <ErrorBoundary>
                        <ReceivingFormPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/receivings/:id"
                    element={
                      <ErrorBoundary>
                        <ReceivingFormPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/users"
                    element={
                      <ErrorBoundary>
                        <UsersPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/expenses"
                    element={
                      <ErrorBoundary>
                        <ExpensesPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/debts"
                    element={
                      <ErrorBoundary>
                        <DebtsPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/payment-methods"
                    element={
                      <ErrorBoundary>
                        <PaymentMethodsSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/product-category"
                    element={
                      <ErrorBoundary>
                        <ProductCategoriesSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/expense-category"
                    element={
                      <ErrorBoundary>
                        <ExpenseCategoriesSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/units"
                    element={
                      <ErrorBoundary>
                        <UnitsSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/theme"
                    element={
                      <ErrorBoundary>
                        <ThemeSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/receipt"
                    element={
                      <ErrorBoundary>
                        <ReceiptSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/report-issue"
                    element={
                      <ErrorBoundary>
                        <IssueReport />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/stock-opname"
                    element={
                      <ErrorBoundary>
                        <StockOpname />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/backup"
                    element={
                      <ErrorBoundary>
                        <BackupRestoreSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/cloud-backup"
                    element={
                      <ErrorBoundary>
                        <CloudBackupSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/cloud-backup/stores"
                    element={
                      <ErrorBoundary>
                        <CloudStoreSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/cloud-backup/online-store"
                    element={
                      <ErrorBoundary>
                        <CloudOnlineStoreSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/cloud-backup/auto"
                    element={
                      <ErrorBoundary>
                        <CloudAutoBackupSettings />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/cloud-backup/history"
                    element={
                      <ErrorBoundary>
                        <CloudHistorySettings />
                      </ErrorBoundary>
                    }
                  />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
              </CloudAuthProvider>
             </GoogleOAuthProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
    </I18nextProvider>
  );
};

export default App;

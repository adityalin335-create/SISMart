import { useLiveQuery } from 'dexie-react-hooks';
import { db, isStockManaged, type Product, type Transaction, type TransactionItemRecord } from '@/lib/db';
import { applySaleStockDelta } from '@/lib/stock-movements';
import { createSaleWithItems } from '@/lib/sales';
import { useState, useRef, useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Plus, Minus, ShoppingCart, Percent, Tag, CreditCard, Banknote, Check, List, ClipboardList, Save, User, Trash2, Barcode } from 'lucide-react';
import Receipt from '@/components/Receipt';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id, enUS, ms } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { trackEvent } from '@/lib/analytics';
import CustomerPicker from '@/components/CustomerPicker';
import LockedPage from '@/components/LockedPage';
import { useLocation, useNavigate } from 'react-router-dom';

interface CartItem {
  product: Product;
  qty: number;
  discountType: 'percentage' | 'nominal' | null;
  discountValue: number;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  id: 'Rp',
  en: '$',
  ms: 'Rp',
};

const NUMBER_LOCALES: Record<string, string> = {
  id: 'id-ID',
  en: 'en-US',
  ms: 'ms-MY',
};

const LOCALES: Record<string, Locale> = {
  id,
  en: enUS,
  ms,
};

export default function Kasir() {
  const { currentUser, can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('settings');

  const lang = i18n.language?.split('-')[0] || 'id';
  const dateLocale = LOCALES[lang] || id;
  const numberLocale = NUMBER_LOCALES[lang] || 'id-ID';
  const currencySymbol = CURRENCY_SYMBOL[lang] || 'Rp';
  const rp = (n: number) => `${currencySymbol} ${n.toLocaleString(numberLocale)}`;

  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const checkoutHistoryEntryRef = useRef(false);
  const checkoutHistoryStateRef = useRef<unknown>(null);
  const checkoutHistoryUrlRef = useRef('');
  const [txDiscountType, setTxDiscountType] = useState<'percentage' | 'nominal' | null>(null);
  const [txDiscountValue, setTxDiscountValue] = useState('');
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [tempDiscountType, setTempDiscountType] = useState<'percentage' | 'nominal'>('nominal');
  const [tempDiscountValue, setTempDiscountValue] = useState('');
  // Item-level discount dialog state
  const [itemDiscountTargetId, setItemDiscountTargetId] = useState<number | null>(null);
  const [itemDiscountType, setItemDiscountType] = useState<'percentage' | 'nominal'>('nominal');
  const [itemDiscountValue, setItemDiscountValue] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [useDebt, setUseDebt] = useState(false);
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<Transaction | null>(null);
  const [lastTxItems, setLastTxItems] = useState<TransactionItemRecord[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState<number | undefined>(undefined);
  const [remarks, setRemarks] = useState('');
  const [draftReceiptNumber, setDraftReceiptNumber] = useState('');
  const [productListOpen, setProductListOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [openBillsOpen, setOpenBillsOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTargetTx, setCancelTargetTx] = useState<Transaction | null>(null);
  const [scanInput, setScanInput] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);


  const products = useLiveQuery(() => db.products.where('isDeleted').equals(0).toArray());
  const paymentMethods = useLiveQuery(() => db.paymentMethods.toArray());
  const storeSettings = useLiveQuery(() => db.storeSettings.toCollection().first());
  const openBills = useLiveQuery(() => db.transactions.where('status').equals('open').reverse().sortBy('date'));
  const allUsers = useLiveQuery(() => db.users.toArray());
  const customers = useLiveQuery(() => db.customers.where('isDeleted').equals(0).toArray());
  const activeCashierName = currentUser?.name || allUsers?.find(user => user.isActive === 1)?.name || t('cashier.defaultCashier');
  const productQuery = productSearch.trim().toLowerCase();
  const selectableProducts = (products ?? []).filter(product =>
    !productQuery ||
    product.name.toLowerCase().includes(productQuery) ||
    product.sku?.toLowerCase().includes(productQuery) ||
    product.barcode?.toLowerCase().includes(productQuery)
  );

  // Permission gate — kept render-side (not redirect) so the bottom nav stays
  // intact. All hooks above run unconditionally; we just swap the rendered tree.
  const allowed = can('create_transaction');

  const doFullReset = () => {
    setCart([]);
    setEditingTxId(null);
    setTxDiscountType(null);
    setTxDiscountValue('');
    setPaymentMethodId('');
    setPaymentAmount('');
    setUseDebt(false);
    setCustomerName('');
    setCustomerId(undefined);
    setRemarks('');
    setDraftReceiptNumber('');
    setIsQuickAdding(false);
  };

  // === Cart Operations ===

  const addToCart = (product: Product) => {
    setDraftReceiptNumber(current => current || `TX${Date.now()}`);
    setCart(prev => {
      const existing = prev.find(c => c.product.id === product.id);
      if (existing) {
        if (isStockManaged(product) && existing.qty >= product.stock) {
          toast.error(t('cashier.toast.stockLow'));
          return prev;
        }
        return prev.map(c => c.product.id === product.id ? { ...c, qty: c.qty + 1 } : c);
      }
      return [...prev, { product, qty: 1, discountType: null, discountValue: 0 }];
    });
  };

  const updateQty = (productId: number, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.product.id !== productId) return c;
      const newQty = c.qty + delta;
      if (newQty <= 0) return c;
      if (isStockManaged(c.product) && newQty > c.product.stock) { toast.error(t('cashier.toast.stockLow')); return c; }
      return { ...c, qty: newQty };
    }));
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(c => c.product.id !== productId));
  };

  const openItemDiscount = (item: CartItem) => {
    setItemDiscountTargetId(item.product.id!);
    if (item.discountType) {
      setItemDiscountType(item.discountType);
      setItemDiscountValue(String(item.discountValue));
    } else {
      setItemDiscountType('nominal');
      setItemDiscountValue('');
    }
  };

  const saveItemDiscount = () => {
    if (itemDiscountTargetId == null) return;
    const raw = Number(itemDiscountValue) || 0;
    setCart(prev => prev.map(c => {
      if (c.product.id !== itemDiscountTargetId) return c;
      if (raw <= 0) {
        return { ...c, discountType: null, discountValue: 0 };
      }
      const base = c.product.price * c.qty;
      const clamped = itemDiscountType === 'percentage'
        ? Math.min(100, raw)
        : Math.min(base, raw);
      return { ...c, discountType: itemDiscountType, discountValue: clamped };
    }));
    setItemDiscountTargetId(null);
  };

  const clearItemDiscount = () => {
    if (itemDiscountTargetId == null) return;
    setCart(prev => prev.map(c =>
      c.product.id === itemDiscountTargetId
        ? { ...c, discountType: null, discountValue: 0 }
        : c
    ));
    setItemDiscountTargetId(null);
  };

  const getItemDiscountAmount = (item: CartItem) => {
    const base = item.product.price * item.qty;
    if (item.discountType === 'percentage') {
      const pct = Math.min(100, Math.max(0, item.discountValue));
      return base * pct / 100;
    }
    if (item.discountType === 'nominal') {
      return Math.min(base, Math.max(0, item.discountValue));
    }
    return 0;
  };

  const getItemSubtotal = (item: CartItem) => {
    const base = item.product.price * item.qty;
    return Math.max(0, base - getItemDiscountAmount(item));
  };

  const subtotal = cart.reduce((sum, item) => sum + getItemSubtotal(item), 0);
  const txDiscountAmount = txDiscountType === 'percentage'
    ? subtotal * Math.min(100, Math.max(0, Number(txDiscountValue) || 0)) / 100
    : txDiscountType === 'nominal'
      ? Math.min(subtotal, Math.max(0, Number(txDiscountValue) || 0))
      : 0;
  const total = Math.max(0, subtotal - txDiscountAmount);
  const paidAmount = Number(paymentAmount) || 0;
  const checkoutPaidAmount = useDebt ? Math.min(total, Math.max(0, paidAmount)) : paidAmount;
  const debtAmount = useDebt ? Math.max(0, total - checkoutPaidAmount) : 0;
  const change = useDebt ? 0 : paidAmount - total;
  const totalItemDiscount = cart.reduce((sum, item) => sum + getItemDiscountAmount(item), 0);
  const totalProfit = cart.reduce((sum, item) => sum + (item.product.price - item.product.hpp) * item.qty, 0) - totalItemDiscount - txDiscountAmount;

  const openCheckout = () => {
    if (!checkoutHistoryEntryRef.current) {
      const checkoutPath = `${location.pathname}${location.search}${location.hash}`;
      navigate(checkoutPath, { state: { ...(location.state ?? {}), checkoutDialog: true } });
      checkoutHistoryStateRef.current = window.history.state;
      checkoutHistoryUrlRef.current = window.location.href;
      checkoutHistoryEntryRef.current = true;
    }
    setUseDebt(false);
    setPaymentMethodId(paymentMethods?.[0]?.id?.toString() ?? '');
    setPaymentAmount(total.toString());
    setIsQuickAdding(false);
    setCheckoutOpen(true);
  };

  // === Open Bill Operations ===

  const saveOpenBill = async () => {
    if (cart.length === 0) { toast.error(t('cashier.toast.cartEmpty')); return; }

    const now = new Date();
    const itemRecords: Omit<TransactionItemRecord, 'id' | 'transactionId'>[] = cart.map(c => ({
      productId: c.product.id!,
      productName: c.product.name,
      quantity: c.qty,
      price: c.product.price,
      hpp: c.product.hpp,
      discountType: c.discountType,
      discountValue: c.discountValue,
      discountAmount: getItemDiscountAmount(c),
      subtotal: getItemSubtotal(c),
    }));

    try {
      if (editingTxId) {
        const receiptNumber = await db.transaction(
          'rw',
          [db.transactions, db.transactionItems, db.products, db.stockIns, db.stockOuts],
          async () => {
            const oldItems = await db.transactionItems.where('transactionId').equals(editingTxId).toArray();
            const currentTx = await db.transactions.get(editingTxId);
            if (!currentTx) throw new Error('Tagihan tidak ditemukan.');
            await db.transactions.update(editingTxId, {
              subtotal,
              discountType: txDiscountType,
              discountValue: Number(txDiscountValue) || 0,
              discountAmount: txDiscountAmount,
              total,
              customerId,
              customerName: customerName.trim() || undefined,
              remarks: remarks.trim() || undefined,
              date: now,
            });
            await db.transactionItems.where('transactionId').equals(editingTxId).delete();
            await db.transactionItems.bulkAdd(itemRecords.map(item => ({ ...item, transactionId: editingTxId })));

            for (const cartItem of cart) {
              const oldQty = oldItems.find(item => item.productId === cartItem.product.id)?.quantity ?? 0;
              const delta = cartItem.qty - oldQty;
              if (delta !== 0) {
                await applySaleStockDelta({
                  productId: cartItem.product.id!,
                  delta,
                  quantity: Math.abs(delta),
                  transactionId: editingTxId,
                  referenceNumber: currentTx.receiptNumber,
                  date: now,
                  createdBy: currentUser?.id,
                });
              }
            }
            for (const oldItem of oldItems) {
              if (cart.some(item => item.product.id === oldItem.productId)) continue;
              await applySaleStockDelta({
                productId: oldItem.productId,
                delta: -oldItem.quantity,
                quantity: oldItem.quantity,
                transactionId: editingTxId,
                referenceNumber: currentTx.receiptNumber,
                date: now,
                createdBy: currentUser?.id,
              });
            }
            return currentTx.receiptNumber;
          },
        );
        toast.success(t('cashier.toast.billUpdated', { receiptNumber }));
      } else {
        const receiptNumber = draftReceiptNumber || `TX${Date.now()}`;
        setDraftReceiptNumber(receiptNumber);
        const txData: Transaction = {
          subtotal,
          discountType: txDiscountType,
          discountValue: Number(txDiscountValue) || 0,
          discountAmount: txDiscountAmount,
          total,
          paymentMethodId: 0,
          paymentAmount: 0,
          change: 0,
          profit: 0,
          date: now,
          receiptNumber,
          status: 'open',
          customerId,
          customerName: customerName.trim() || undefined,
          remarks: remarks.trim() || undefined,
          openedAt: now,
          createdBy: currentUser?.id,
        };
        await createSaleWithItems({
          transaction: txData,
          items: itemRecords,
          createdBy: currentUser?.id,
        });
        toast.success(t('cashier.toast.billSaved', { receiptNumber }));
      }
      doFullReset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal menyimpan tagihan.');
    }
  };

  const loadOpenBill = async (tx: Transaction) => {
    if (!tx.id) return;
    const items = await db.transactionItems.where('transactionId').equals(tx.id).toArray();
    const allProducts = await db.products.where('isDeleted').equals(0).toArray();

    const cartItems: CartItem[] = items.map(item => {
      const product = allProducts.find(p => p.id === item.productId);
      if (!product) throw new Error(t('cashier.toast.productNotFoundLoadBill', { name: item.productName }));
      return {
        product,
        qty: item.quantity,
        discountType: item.discountType as 'percentage' | 'nominal' | null,
        discountValue: item.discountValue,
      };
    });

    setCart(cartItems);
    setDraftReceiptNumber(tx.receiptNumber);
    setEditingTxId(tx.id);
    setTxDiscountType(tx.discountType);
    setTxDiscountValue(tx.discountType ? String(tx.discountValue) : '');
    setCustomerName(tx.customerName || '');
    setCustomerId(tx.customerId);
    setRemarks(tx.remarks || '');
    setOpenBillsOpen(false);
  };

  const cancelOpenBill = async (tx: Transaction) => {
    if (!tx.id) return;
    try {
      await db.transaction(
        'rw',
        [db.transactions, db.transactionItems, db.products, db.stockIns, db.stockOuts],
        async () => {
          const items = await db.transactionItems.where('transactionId').equals(tx.id!).toArray();
          for (const item of items) {
            const product = await db.products.get(item.productId);
            if (product && isStockManaged(product)) {
              await applySaleStockDelta({
                productId: item.productId,
                delta: -item.quantity,
                quantity: item.quantity,
                transactionId: tx.id!,
                referenceNumber: tx.receiptNumber,
                date: new Date(),
                createdBy: currentUser?.id,
              });
            }
          }
          await db.transactionItems.where('transactionId').equals(tx.id!).delete();
          await db.transactions.delete(tx.id!);
        },
      );
      toast.success(t('cashier.toast.billCancelled', { receiptNumber: tx.receiptNumber }));
      setCancelDialogOpen(false);
      setCancelTargetTx(null);
      if (editingTxId === tx.id) doFullReset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gagal membatalkan tagihan.');
    }
  };

  const handleCancelFromCart = () => {
    const tx = openBills?.find(b => b.id === editingTxId);
    if (tx) {
      setCancelTargetTx(tx);
      setCancelDialogOpen(true);
    }
  };

  const handleCancelFromList = (bill: Transaction) => {
    setCancelTargetTx(bill);
    setCancelDialogOpen(true);
  };

  // === Checkout ===

  const handleCheckout = async () => {
    if (useDebt) {
      if (!storeSettings?.allowDebt) return;
      if (!customerId) {
        toast.error(t('cashier.toast.selectCustomerForDebt'));
        return;
      }
      if (paidAmount < 0 || paidAmount > total) {
        toast.error(t('cashier.toast.paymentAmountRange', { symbol: currencySymbol }));
        return;
      }
      if (checkoutPaidAmount > 0 && !paymentMethodId) {
        toast.error(t('cashier.toast.selectPaymentMethod'));
        return;
      }
    } else if (!paymentMethodId || paidAmount < total) {
      return;
    }

    const completedAt = new Date();
    try {
    if (editingTxId) {
      const { updatedTx, itemRecords } = await db.transaction(
        'rw',
        [db.transactions, db.transactionItems, db.products, db.stockIns, db.stockOuts, db.debts],
        async () => {
          // Update existing open bill → paid
          const oldItems = await db.transactionItems.where('transactionId').equals(editingTxId).toArray();
          const existingTx = await db.transactions.get(editingTxId);
          if (!existingTx || existingTx.status !== 'open') {
            throw new Error('Transaksi tertunda tidak ditemukan atau sudah ditutup.');
          }
          await db.transactions.update(editingTxId, {
            status: 'completed',
            subtotal,
            discountType: txDiscountType,
            discountValue: Number(txDiscountValue) || 0,
            discountAmount: txDiscountAmount,
            total,
            paymentMethodId: checkoutPaidAmount > 0 ? Number(paymentMethodId) : 0,
            paymentAmount: checkoutPaidAmount,
            change,
            profit: totalProfit,
            date: completedAt,
            customerId,
            customerName: customerName.trim() || undefined,
            remarks: remarks.trim() || undefined,
            cashierName: activeCashierName,
            closedAt: completedAt,
            debtAmount,
          });

          if (debtAmount > 0) {
            await db.debts.add({
              transactionId: editingTxId,
              customerId: customerId!,
              customerName: customerName.trim(),
              originalAmount: debtAmount,
              remainingAmount: debtAmount,
              status: checkoutPaidAmount > 0 ? 'partial' : 'unpaid',
              createdAt: new Date(),
              settledAt: null,
            });
          }

          await db.transactionItems.where('transactionId').equals(editingTxId).delete();
          const records: TransactionItemRecord[] = cart.map(c => ({
            transactionId: editingTxId,
            productId: c.product.id!,
            productName: c.product.name,
            quantity: c.qty,
            price: c.product.price,
            hpp: c.product.hpp,
            discountType: c.discountType,
            discountValue: c.discountValue,
            discountAmount: getItemDiscountAmount(c),
            subtotal: getItemSubtotal(c),
          }));
          await db.transactionItems.bulkAdd(records);

          for (const cartItem of cart) {
            const oldItem = oldItems.find(oi => oi.productId === cartItem.product.id);
            const delta = cartItem.qty - (oldItem?.quantity ?? 0);
            if (delta !== 0) {
              await applySaleStockDelta({
                productId: cartItem.product.id!,
                delta,
                quantity: Math.abs(delta),
                transactionId: editingTxId,
                referenceNumber: existingTx.receiptNumber,
                date: completedAt,
                createdBy: currentUser?.id,
              });
            }
          }
          for (const oldItem of oldItems) {
            if (cart.some(c => c.product.id === oldItem.productId)) continue;
            await applySaleStockDelta({
              productId: oldItem.productId,
              delta: -oldItem.quantity,
              quantity: oldItem.quantity,
              transactionId: editingTxId,
              referenceNumber: existingTx.receiptNumber,
              date: completedAt,
              createdBy: currentUser?.id,
            });
          }

          return {
            updatedTx: await db.transactions.get(editingTxId),
            itemRecords: records,
          };
        },
      );
      toast.success(t('cashier.toast.transactionSuccess', { receiptNumber: updatedTx?.receiptNumber }));
      trackEvent('create_transaction');
      setLastTransaction(updatedTx || null);
      setLastTxItems(itemRecords);
      setReceiptOpen(true);
    } else {
      const receiptNumber = draftReceiptNumber || `TX${Date.now()}`;

      const txData: Transaction = {
        subtotal,
        discountType: txDiscountType,
        discountValue: Number(txDiscountValue) || 0,
        discountAmount: txDiscountAmount,
        total,
        paymentMethodId: checkoutPaidAmount > 0 ? Number(paymentMethodId) : 0,
        paymentAmount: checkoutPaidAmount,
        change,
        profit: totalProfit,
        date: completedAt,
        receiptNumber,
        status: 'completed',
        customerId,
        customerName: customerName.trim() || undefined,
        remarks: remarks.trim() || undefined,
        createdBy: currentUser?.id,
        cashierName: activeCashierName,
        debtAmount,
      };

      const itemRecords = cart.map(c => ({
        productId: c.product.id!,
        productName: c.product.name,
        quantity: c.qty,
        price: c.product.price,
        hpp: c.product.hpp,
        discountType: c.discountType,
        discountValue: c.discountValue,
        discountAmount: getItemDiscountAmount(c),
        subtotal: getItemSubtotal(c),
      }));
      const txId = await createSaleWithItems({
        transaction: txData,
        items: itemRecords,
        debt: debtAmount > 0 ? {
          customerId: customerId!,
          customerName: customerName.trim(),
          originalAmount: debtAmount,
          remainingAmount: debtAmount,
          status: checkoutPaidAmount > 0 ? 'partial' : 'unpaid',
          createdAt: new Date(),
          settledAt: null,
        } : undefined,
        createdBy: currentUser?.id,
      });

      toast.success(t('cashier.toast.transactionSuccess', { receiptNumber }));
      trackEvent('create_transaction');
      setLastTransaction({ ...txData, id: txId });
      setLastTxItems(itemRecords.map(item => ({ ...item, transactionId: txId })));
      setReceiptOpen(true);
    }
    } catch (error) {
      console.error('[Cashier] Gagal menyelesaikan transaksi:', error);
      toast.error(t('cashier.toast.checkoutFailed'));
      return;
    }

    doFullReset();
    setCheckoutOpen(false);
  };

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const openBillsCount = openBills?.length ?? 0;

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && scanInput.trim()) {
      const code = scanInput.trim();
      setScanInput('');
      const product = products?.find(p => p.sku === code || p.barcode === code);
      if (product) {
        if (isStockManaged(product) && product.stock <= 0) {
          toast.error(t('cashier.toast.productOutOfStock', { name: product.name }));
          return;
        }
        addToCart(product);
        toast.success(t('cashier.toast.addedToCart', { name: product.name }));
      } else {
        toast.error(t('cashier.toast.productNotFound', { code }));
      }
    }
  };

  // Auto-focus scan input after it clears
  useEffect(() => {
    if (scanInput === '' && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [scanInput]);

  useEffect(() => {
    if (!checkoutOpen || !checkoutHistoryEntryRef.current) return;

    const handleBrowserBack = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      window.history.pushState(checkoutHistoryStateRef.current, '', checkoutHistoryUrlRef.current);
      setCheckoutOpen(false);
    };

    window.addEventListener('popstate', handleBrowserBack, true);
    return () => window.removeEventListener('popstate', handleBrowserBack, true);
  }, [checkoutOpen]);

  useEffect(() => {
    if (!checkoutOpen || !Capacitor.isNativePlatform()) return;

    let active = true;
    let removeBackButtonListener: (() => void) | undefined;
    void CapacitorApp.addListener('backButton', () => setCheckoutOpen(false)).then(handle => {
      if (active) {
        removeBackButtonListener = () => { void handle.remove(); };
      } else {
        void handle.remove();
      }
    });

    return () => {
      active = false;
      removeBackButtonListener?.();
    };
  }, [checkoutOpen]);

  // Open the Open Bills sheet when navigated here from the dashboard
  useEffect(() => {
    if ((location.state as { openBills?: boolean } | null)?.openBills) {
      setOpenBillsOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  // After all hooks: if user can't create transactions, render the locked
  // placeholder instead of the kasir UI. Bottom nav stays visible.
  if (!allowed) {
    return <LockedPage title={t('cashier.locked.title')} permissionLabel={t('cashier.locked.permissionLabel')} />;
  }

  return (
    <div className="px-4 pt-4 pb-4 h-[calc(100vh-4rem)] overflow-hidden">
      <div className="flex flex-col lg:flex-row gap-4 h-full min-h-0">
        <section className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
          <div className="shrink-0">
            <div className="flex items-center mb-4 pt-1">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-primary" />
                {t('cashier.title')}
                {editingTxId && (
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    {t('cashier.editingBill')}
                  </Badge>
                )}
              </h1>
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {t('receipt.cashierLabel')}: <strong className="text-foreground">{activeCashierName}</strong>
              </span>
              <span>
                {t('receipt.no')}: <strong className="text-foreground">{draftReceiptNumber || '—'}</strong>
              </span>
            </div>

            <div className="flex gap-2 px-1">
              <div className="relative flex-1">
                <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  ref={scanInputRef}
                  placeholder={t('cashier.scanPlaceholder')}
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  onKeyDown={handleScanKeyDown}
                  className="pl-12 h-16 text-lg"
                />
              </div>
              <Button variant="outline" size="icon" aria-label={t('cashier.productList.title')} title={t('cashier.productList.title')} className="h-16 w-16 shrink-0" onClick={() => setProductListOpen(true)}>
                <List className="w-6 h-6" />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-4">
            {cart.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">{t('cashier.cart.empty')}</p>
              </div>
            ) : (
              <table className="w-full min-w-[650px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t('cashier.cartTable.item')}</th>
                    <th className="px-3 py-2 text-center font-medium">{t('cashier.cartTable.quantity')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('cashier.cartTable.unitPrice')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('cashier.cartTable.subtotal')}</th>
                    <th className="w-12 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map(item => (
                    <tr key={item.product.id} className="border-b last:border-0">
                      <td className="px-3 py-3">
                        <p className="font-semibold">{item.product.name}</p>
                        {item.discountType && getItemDiscountAmount(item) > 0 && (
                          <p className="text-xs text-destructive">
                            {t('cashier.cartDiscount.label')}: {item.discountType === 'percentage' ? `${item.discountValue}%` : rp(item.discountValue)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="outline" size="icon" aria-label={`Kurangi ${item.product.name}`} title={`Kurangi ${item.product.name}`} className="h-8 w-8" onClick={() => updateQty(item.product.id!, -1)}>
                            <Minus className="w-3.5 h-3.5" />
                          </Button>
                          <span className="w-8 text-center font-semibold">{item.qty}</span>
                          <Button variant="outline" size="icon" aria-label={`Tambah ${item.product.name}`} title={`Tambah ${item.product.name}`} className="h-8 w-8" onClick={() => updateQty(item.product.id!, 1)}>
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">{rp(item.product.price)}</td>
                      <td className="px-3 py-3 text-right font-semibold">{rp(getItemSubtotal(item))}</td>
                      <td className="px-2 py-3 text-right">
                        <Button variant="ghost" size="icon" aria-label={`Hapus ${item.product.name}`} title={`Hapus ${item.product.name}`} className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeFromCart(item.product.id!)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="flex max-h-[42%] min-h-[220px] shrink-0 flex-col overflow-hidden border border-border bg-card lg:max-h-none lg:h-full lg:w-80">
          <div className="shrink-0 border-b border-border p-4">
            <h2 className="text-base font-bold flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              {t('cashier.cart.title', { count: cartCount })}
              {editingTxId && <span className="text-xs font-normal text-muted-foreground">{t('cashier.cart.editLabel')}</span>}
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('cashier.cartDiscount.subtotal')}</span>
              <span>{rp(subtotal)}</span>
            </div>
            {txDiscountAmount > 0 && (
              <div className="flex justify-between text-sm text-destructive">
                <span>{t('cashier.cartDiscount.discount')}</span>
                <span>-{rp(txDiscountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between rounded-lg bg-primary/5 p-3 text-lg font-bold">
              <span>{t('cashier.cartDiscount.total')}</span>
              <span className="text-primary">{rp(total)}</span>
            </div>

            {txDiscountAmount > 0 ? (
              <button
                onClick={() => { setTempDiscountType(txDiscountType!); setTempDiscountValue(txDiscountValue); setDiscountDialogOpen(true); }}
                className="flex items-center gap-1.5 text-xs text-destructive font-medium"
              >
                <Tag className="w-3.5 h-3.5" />
                {t('cashier.cartDiscount.label')}: {txDiscountType === 'percentage' ? `${txDiscountValue}%` : rp(Number(txDiscountValue))}
                <span className="text-[10px] underline ml-1">{t('cashier.cartDiscount.change')}</span>
              </button>
            ) : (
              <button
                onClick={() => { setTempDiscountType('nominal'); setTempDiscountValue(''); setDiscountDialogOpen(true); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Tag className="w-3.5 h-3.5" />
                <span>{t('cashier.cartDiscount.add')}</span>
              </button>
            )}

            <Button variant="outline" className="w-full h-11 text-sm font-semibold" onClick={() => void saveOpenBill()} disabled={cart.length === 0}>
              <Save className="w-4 h-4 mr-2" />
              {t('cashier.buttons.saveBill')}
            </Button>
            <Button
              className="w-full h-12 text-sm font-semibold"
              onClick={openCheckout}
              disabled={cart.length === 0}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              {t('cashier.buttons.continuePayment')}
            </Button>

            {editingTxId && can('delete_transaction') && (
              <Button variant="ghost" className="w-full h-10 text-xs text-destructive hover:bg-destructive/5" onClick={handleCancelFromCart}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {t('cashier.buttons.cancelBill')}
              </Button>
            )}
          </div>
        </aside>
      </div>

      <Sheet open={productListOpen} onOpenChange={setProductListOpen}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
          <SheetHeader className="p-5 pb-3">
            <SheetTitle>{t('cashier.productList.title')}</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-4">
            <Input
              autoFocus
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter' || !productQuery) return;
                const product = products?.find(item =>
                  item.sku?.toLowerCase() === productQuery || item.barcode?.toLowerCase() === productQuery
                );
                if (!product) return;
                e.preventDefault();
                if (isStockManaged(product) && product.stock <= 0) {
                  toast.error(t('cashier.toast.productOutOfStock', { name: product.name }));
                  return;
                }
                addToCart(product);
                setProductSearch('');
              }}
              placeholder={t('cashier.productList.search')}
              aria-label={t('cashier.productList.search')}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border-t">
            {selectableProducts.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">{t('cashier.productList.empty')}</p>
            ) : (
              selectableProducts.map(product => {
                const cartItem = cart.find(item => item.product.id === product.id);
                const outOfStock = isStockManaged(product) && product.stock <= 0;
                const stockLimitReached = isStockManaged(product) && (cartItem?.qty ?? 0) >= product.stock;
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={outOfStock || stockLimitReached}
                    onClick={() => {
                      addToCart(product);
                      setProductSearch('');
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b px-5 py-4 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{product.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[product.sku, product.barcode].filter(Boolean).join(' · ') || t('cashier.productList.noCode')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-semibold">{rp(product.price)}</span>
                      {cartItem && <span className="text-xs font-medium text-primary">{t('cashier.productList.inCart', { count: cartItem.qty })}</span>}
                      <span className={cn('text-xs', outOfStock || stockLimitReached ? 'text-destructive' : 'text-muted-foreground')}>
                        {outOfStock
                          ? t('cashier.productList.outOfStock')
                          : isStockManaged(product)
                            ? t('cashier.productList.stock', { stock: product.stock, unit: product.unit })
                            : t('cashier.productList.unmanagedStock')}
                      </span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Open Bills Sheet */}
      <Sheet open={openBillsOpen} onOpenChange={setOpenBillsOpen}>
        <SheetContent side="bottom" className="h-[80vh] rounded-t-2xl max-w-lg md:max-w-xl mx-auto flex flex-col">
          <SheetHeader>
            <SheetTitle className="text-left flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-primary" />
              {t('cashier.openBillsSheet.title', { count: openBillsCount })}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex-1 min-h-0 overflow-y-auto pb-6 space-y-2">
            {!openBills || openBills.length === 0 ? (
              <div className="text-center py-12">
                <ClipboardList className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">{t('cashier.openBillsSheet.empty')}</p>
              </div>
            ) : (
              openBills.map(bill => (
                <Card key={bill.id} className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">{bill.receiptNumber}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {bill.openedAt ? format(new Date(bill.openedAt), 'dd/MM HH:mm', { locale: dateLocale }) : ''}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-primary">{rp(bill.total)}</span>
                    </div>
                    <div className="flex gap-1.5 text-[10px] text-muted-foreground mb-2">
                      {bill.customerName && <span>👤 {bill.customerName}</span>}
                      {bill.remarks && <span className="truncate max-w-[120px]">📝 {bill.remarks}</span>}
                    </div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Button size="sm" className="h-8 text-xs flex-1" onClick={() => loadOpenBill(bill)}>
                          {t('cashier.openBillsSheet.continue')}
                        </Button>
                        {can('delete_transaction') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-destructive border-destructive/30"
                            onClick={() => handleCancelFromList(bill)}
                          >
                            {t('cashier.openBillsSheet.cancel')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Checkout Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-6xl rounded-xl max-h-[92vh] h-[92vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2 shrink-0">
            <DialogTitle>{t('cashier.checkout.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] overflow-hidden">
            <div className="min-h-0 overflow-y-auto bg-muted/40 p-4 md:p-6">
              <div className="mx-auto max-w-[380px] bg-white text-black p-5 shadow-sm" style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                <div className="border-b border-dashed border-gray-400 pb-3 text-center">
                  {storeSettings?.logo && <img src={storeSettings.logo} alt="" className="mx-auto mb-2 h-12 w-12 object-contain" />}
                  <p className="text-base font-bold">{storeSettings?.storeName || t('receipt.storeFallback')}</p>
                  {storeSettings?.address && <p className="mt-1 text-[10px]">{storeSettings.address}</p>}
                  {storeSettings?.phone && <p className="text-[10px]">{storeSettings.phone}</p>}
                  <p className="mt-2 text-[10px]">{t('receipt.no')}: {draftReceiptNumber || '—'}</p>
                  <p className="text-[10px]">{t('receipt.cashierLabel')}: {activeCashierName}</p>
                  <p className="text-[10px]">{t('receipt.dateTime')}: {format(new Date(), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}</p>
                </div>
                <div className="space-y-3 py-3">
                  {cart.map(item => (
                    <div key={item.product.id}>
                      <p className="font-semibold">{item.product.name}</p>
                      <div className="flex justify-between text-[10px]">
                        <span>{item.qty} x {rp(item.product.price)}</span>
                        <span>{rp(getItemSubtotal(item))}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 border-t border-dashed border-gray-400 py-3 text-[11px]">
                  <div className="flex justify-between"><span>{t('cashier.cartDiscount.subtotal')}</span><span>{rp(subtotal)}</span></div>
                  {txDiscountAmount > 0 && <div className="flex justify-between"><span>{t('cashier.cartDiscount.discount')}</span><span>-{rp(txDiscountAmount)}</span></div>}
                  <div className="flex justify-between border-t border-dashed border-gray-400 pt-2 text-sm font-bold"><span>{t('cashier.cartDiscount.total')}</span><span>{rp(total)}</span></div>
                  <div className="flex justify-between pt-1"><span>{t('cashier.checkout.amountLabel.full')}</span><span>{rp(checkoutPaidAmount)}</span></div>
                  {useDebt && debtAmount > 0 ? (
                    <div className="flex justify-between font-semibold"><span>{t('cashier.checkout.remainingDebt')}</span><span>{rp(debtAmount)}</span></div>
                  ) : (
                    <div className="flex justify-between"><span>{t('cashier.checkout.changeLabel')}</span><span>{rp(change)}</span></div>
                  )}
                  <div className="flex justify-between pt-1"><span>{t('cashier.checkout.paymentMethod')}</span><span>{paymentMethods?.find(pm => pm.id?.toString() === paymentMethodId)?.name || '-'}</span></div>
                </div>
                <div className="border-t border-dashed border-gray-400 pt-3 text-[10px]">
                  <span className="font-bold">{t('cashier.checkout.notes')}:</span> {remarks.trim() || '-'}
                </div>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto p-4 md:p-6 space-y-4">
            <div className="text-center py-3 bg-primary/5 rounded-xl">
              <p className="text-sm text-muted-foreground">{t('cashier.checkout.totalLabel')}</p>
              <p className="text-3xl font-bold text-primary">{rp(total)}</p>
            </div>

            {storeSettings?.allowDebt && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-semibold">{t('cashier.checkout.debtLabel')}</p>
                  <p className="text-[10px] text-muted-foreground">{t('cashier.checkout.debtDesc')}</p>
                </div>
                <Switch
                  checked={useDebt}
                  onCheckedChange={(checked) => {
                    setUseDebt(checked);
                    setPaymentAmount(checked ? '0' : total.toString());
                    setIsQuickAdding(false);
                  }}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('cashier.checkout.paymentMethod')}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {paymentMethods?.map(pm => (
                  <button key={pm.id} onClick={() => setPaymentMethodId(pm.id!.toString())} className={cn('p-3 rounded-xl text-xs font-semibold border-2 transition-colors', paymentMethodId === pm.id!.toString() ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}>
                    {pm.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{useDebt ? t('cashier.checkout.amountLabel.debt') : t('cashier.checkout.amountLabel.full')}</p>
              <Input
                type="number"
                inputMode="numeric"
                value={paymentAmount === '0' ? '' : paymentAmount}
                onChange={e => { setPaymentAmount(e.target.value || '0'); setIsQuickAdding(true); }}
                placeholder={t('cashier.checkout.amountPlaceholder')}
                className="h-12 text-lg font-bold text-center"
              />
              <div className="flex flex-wrap gap-1.5">
                {[1000, 2000, 5000, 10000, 20000, 50000, 100000].map(nom => (
                  <button
                    key={nom}
                    onClick={() => {
                      if (!isQuickAdding) {
                        setPaymentAmount(String(nom));
                        setIsQuickAdding(true);
                      } else {
                        setPaymentAmount(prev => String((Number(prev) || 0) + nom));
                      }
                    }}
                    className="flex-1 min-w-[calc(25%-6px)] h-9 rounded-lg border border-border bg-muted/50 text-xs font-semibold text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary active:scale-95 transition-all"
                  >
                    {nom >= 1000 ? `${(nom / 1000)}K` : nom}
                  </button>
                ))}
                <button
                  onClick={() => { setPaymentAmount(total.toString()); setIsQuickAdding(false); }}
                  className="flex-1 min-w-[calc(25%-6px)] h-9 rounded-lg border border-primary/30 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10 active:scale-95 transition-all"
                >
                  {t('cashier.checkout.exactMoney')}
                </button>
              </div>
              <button
                onClick={() => { setPaymentAmount('0'); setIsQuickAdding(false); }}
                className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
              >
                {t('cashier.checkout.reset')}
              </button>
            </div>

            <div className="space-y-2">
              <CustomerPicker
                customers={customers ?? []}
                value={customerName}
                customerId={customerId}
                onChange={(name, id) => { setCustomerName(name); setCustomerId(id); }}
                className="w-full [&_input]:h-10 [&_input]:text-sm"
              />
              <Input
                placeholder={t('cashier.checkout.notes')}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                className="h-10"
              />
            </div>

            {useDebt && debtAmount > 0 && (
              <div className="flex justify-between items-center bg-warning/10 p-3 rounded-lg">
                <div>
                  <p className="text-sm font-medium">{t('cashier.checkout.remainingDebt')}</p>
                  <p className="text-[10px] text-muted-foreground">{t('cashier.checkout.remainingDebtHint')}</p>
                </div>
                <span className="text-lg font-bold text-warning">{rp(debtAmount)}</span>
              </div>
            )}

            {paidAmount >= total && (
              <div className="flex justify-between items-center bg-success/10 p-3 rounded-xl">
                <span className="text-sm font-medium">{t('cashier.checkout.changeLabel')}</span>
                <span className="text-lg font-bold text-success">{rp(change)}</span>
              </div>
            )}

            <Button
              className="w-full h-12 text-base font-semibold shrink-0"
              onClick={handleCheckout}
              disabled={
                useDebt
                  ? !customerId || paidAmount < 0 || paidAmount > total || (checkoutPaidAmount > 0 && !paymentMethodId)
                  : !paymentMethodId || paidAmount < total
              }
            >
              <Check className="w-5 h-5 mr-2" />
              {t('cashier.checkout.confirmButton')}
            </Button>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Discount Dialog */}
      <Dialog open={discountDialogOpen} onOpenChange={setDiscountDialogOpen}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('cashier.discountDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('cashier.discountDialog.typeLabel')}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTempDiscountType('nominal')}
                  className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', tempDiscountType === 'nominal' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                >
                  {t('cashier.discountDialog.type.nominal', { symbol: currencySymbol })}
                </button>
                <button
                  onClick={() => setTempDiscountType('percentage')}
                  className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', tempDiscountType === 'percentage' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                >
                  {t('cashier.discountDialog.type.percentage')}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">{tempDiscountType === 'percentage' ? t('cashier.discountDialog.amountLabel.percentage') : t('cashier.discountDialog.amountLabel.nominal')}</p>
              <Input
                type="number"
                value={tempDiscountValue}
                onChange={e => setTempDiscountValue(e.target.value)}
                placeholder={tempDiscountType === 'percentage' ? t('cashier.discountDialog.placeholder.percentage') : t('cashier.discountDialog.placeholder.nominal')}
                className="h-12 text-lg font-bold text-center"
              />
              {tempDiscountType === 'percentage' && Number(tempDiscountValue) > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  {t('cashier.discountDialog.percentPreview', { symbol: currencySymbol, amount: (subtotal * Number(tempDiscountValue) / 100).toLocaleString(numberLocale), subtotal: subtotal.toLocaleString(numberLocale) })}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              {txDiscountType && (
                <Button variant="outline" className="h-11 text-destructive border-destructive/30" onClick={() => {
                  setTxDiscountType(null);
                  setTxDiscountValue('');
                  setDiscountDialogOpen(false);
                }}>
                  {t('cashier.discountDialog.delete')}
                </Button>
              )}
              <Button className="flex-1 h-11 font-semibold" onClick={() => {
                if (Number(tempDiscountValue) > 0) {
                  setTxDiscountType(tempDiscountType);
                  setTxDiscountValue(tempDiscountValue);
                } else {
                  setTxDiscountType(null);
                  setTxDiscountValue('');
                }
                setDiscountDialogOpen(false);
              }}>
                {t('cashier.discountDialog.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Discount Dialog */}
      <Dialog open={itemDiscountTargetId !== null} onOpenChange={(open) => { if (!open) setItemDiscountTargetId(null); }}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('cashier.itemDiscountDialog.title')}</DialogTitle>
          </DialogHeader>
          {(() => {
            const target = cart.find(c => c.product.id === itemDiscountTargetId);
            if (!target) return null;
            const base = target.product.price * target.qty;
            const rawValue = Number(itemDiscountValue) || 0;
            const previewAmount = itemDiscountType === 'percentage'
              ? base * Math.min(100, Math.max(0, rawValue)) / 100
              : Math.min(base, Math.max(0, rawValue));
            const exceedsCap = itemDiscountType === 'percentage' ? rawValue > 100 : rawValue > base;
            return (
              <div className="space-y-4 mt-2">
                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">{t('cashier.itemDiscountDialog.itemLabel')}</p>
                  <p className="text-sm font-semibold">{target.product.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rp(target.product.price)} × {target.qty} = {rp(base)}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t('cashier.itemDiscountDialog.typeLabel')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setItemDiscountType('nominal')}
                      className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', itemDiscountType === 'nominal' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                    >
                      {t('cashier.itemDiscountDialog.type.nominal', { symbol: currencySymbol })}
                    </button>
                    <button
                      onClick={() => setItemDiscountType('percentage')}
                      className={cn('p-3 rounded-xl text-sm font-semibold border-2 transition-colors', itemDiscountType === 'percentage' ? 'border-primary bg-primary/5 text-primary' : 'border-muted bg-muted/50 text-muted-foreground')}
                    >
                      {t('cashier.itemDiscountDialog.type.percentage')}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{itemDiscountType === 'percentage' ? t('cashier.itemDiscountDialog.amountLabel.percentage') : t('cashier.itemDiscountDialog.amountLabel.nominal')}</p>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={itemDiscountValue}
                    onChange={e => setItemDiscountValue(e.target.value)}
                    placeholder={itemDiscountType === 'percentage' ? t('cashier.itemDiscountDialog.placeholder.percentage') : t('cashier.itemDiscountDialog.placeholder.nominal')}
                    className="h-12 text-lg font-bold text-center"
                    autoFocus
                  />
                  {rawValue > 0 && (
                    <p className={cn('text-xs text-center', exceedsCap ? 'text-destructive' : 'text-muted-foreground')}>
                      {exceedsCap
                        ? t('cashier.itemDiscountDialog.cappedPreview.exceeds', { cap: itemDiscountType === 'percentage' ? '100%' : rp(base) })
                        : t('cashier.itemDiscountDialog.cappedPreview.normal', { amount: rp(previewAmount), subtotal: rp(Math.max(0, base - previewAmount)) })}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  {target.discountType && (
                    <Button
                      variant="outline"
                      className="h-11 text-destructive border-destructive/30"
                      onClick={clearItemDiscount}
                    >
                      {t('cashier.itemDiscountDialog.delete')}
                    </Button>
                  )}
                  <Button className="flex-1 h-11 font-semibold" onClick={saveItemDiscount}>
                    {t('cashier.itemDiscountDialog.save')}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      {lastTransaction && (
        <Receipt
          open={receiptOpen}
          onClose={() => setReceiptOpen(false)}
          transaction={lastTransaction}
          items={lastTxItems}
          storeSettings={storeSettings}
          paymentMethodName={
            lastTransaction.debtAmount
              ? (lastTransaction.paymentAmount > 0
                  ? `${paymentMethods?.find(pm => pm.id === lastTransaction.paymentMethodId)?.name || t('cashier.paymentMethod.initialPayment')} + ${t('cashier.paymentMethod.debt')}`
                  : t('cashier.paymentMethod.debt'))
              : paymentMethods?.find(pm => pm.id === lastTransaction.paymentMethodId)?.name || t('cashier.paymentMethod.cash')
          }
          cashierName={lastTransaction.cashierName || (lastTransaction.createdBy ? allUsers?.find(u => u.id === lastTransaction.createdBy)?.name : undefined) || activeCashierName}
        />
      )}

      {/* Cancel Open Bill Confirmation */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent className="max-w-[90vw] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cashier.cancelDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cashier.cancelDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelTargetTx(null)}>{t('cashier.cancelDialog.no')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelTargetTx && cancelOpenBill(cancelTargetTx)}
            >
              {t('cashier.cancelDialog.yes')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

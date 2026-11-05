import { describe, it, expect } from 'vitest';
import { getDailyReportESCPOSData, getESCPOSData, getPrinterMode, setPrinterMode } from '../lib/printer';
import type { Transaction, StoreSettings, TransactionItemRecord } from '../lib/db';

describe('getESCPOSData formatting', () => {
  it('defaults to Bluetooth mode and persists the selected internal printer mode', () => {
    const previousMode = localStorage.getItem('kg_printer_mode');
    try {
      localStorage.removeItem('kg_printer_mode');
      expect(getPrinterMode()).toBe('bluetooth');

      setPrinterMode('masung-usb');
      expect(getPrinterMode()).toBe('masung-usb');

      localStorage.setItem('kg_printer_mode', 'unknown');
      expect(getPrinterMode()).toBe('bluetooth');
    } finally {
      if (previousMode === null) {
        localStorage.removeItem('kg_printer_mode');
      } else {
        localStorage.setItem('kg_printer_mode', previousMode);
      }
    }
  });

  it('should format item lines and totals to be exactly 32 characters wide, aligning numbers to the right', () => {
    const mockTransaction: Transaction = {
      subtotal: 65000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      total: 65000,
      paymentMethodId: 1,
      paymentAmount: 65000,
      change: 0,
      profit: 30000,
      date: new Date('2026-06-30T18:39:00Z'),
      receiptNumber: 'TX1782819574018',
      status: 'completed',
    };

    const mockItems: TransactionItemRecord[] = [
      {
        transactionId: 1,
        productId: 101,
        productName: 'Beras Premium 5 kg',
        quantity: 1,
        price: 15000,
        hpp: 10000,
        discountType: null,
        discountValue: 0,
        discountAmount: 0,
        subtotal: 15000,
      }
    ];

    const mockStoreSettings: StoreSettings = {
      storeName: 'Toko Maju Jaya',
      address: 'Tangerang',
      phone: '081208120812',
      receiptFooter: 'Terima kasih atas kunjungan Anda!',
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'test-device',
    };

    const output = getESCPOSData({
      transaction: mockTransaction,
      items: mockItems,
      storeSettings: mockStoreSettings,
      paymentMethodName: 'Tunai',
      cashierName: 'Joko',
    });

    const lines = output
      .replaceAll('\x1B\x45\x01', '')
      .replaceAll('\x1B\x45\x00', '')
      .replaceAll('\x1D\x21\x11', '')
      .replaceAll('\x1D\x21\x10', '')
      .replaceAll('\x1D\x21\x01', '')
      .replaceAll('\x1D\x21\x00', '')
      .replaceAll('\x1B\x61\x01', '')
      .replaceAll('\x1B\x61\x00', '')
      .split('\n');

    // Quantity and unit price stay left-aligned while the item subtotal stays right-aligned.
    const itemLine = lines.find(line => line.includes('1 x 15.000'));
    expect(itemLine).toBeDefined();
    expect(itemLine?.length).toBe(32); // Must be exactly 32 characters
    expect(itemLine?.endsWith('15.000')).toBe(true);

    // Monetary totals occupy the right edge of the receipt.
    const subtotalLine = lines.find(line => line.startsWith('Subtotal:'));
    expect(subtotalLine).toBeDefined();
    expect(subtotalLine?.length).toBe(32);
    expect(subtotalLine?.endsWith('65.000')).toBe(true);

    const totalLine = lines.find(line => line.startsWith('TOTAL'));
    expect(totalLine).toBeDefined();
    expect(totalLine?.trim()).toBe('TOTAL');
    expect(lines[lines.indexOf(totalLine!) + 1]).toBe('65.000');

    const paymentMethodLine = lines.find(line => line.startsWith('Metode:'));
    expect(paymentMethodLine).toBeDefined();
    expect(paymentMethodLine).toContain('Tunai');

    const bayarLine = lines.find(line => line.startsWith('Bayar:'));
    expect(bayarLine).toBeDefined();
    expect(bayarLine?.length).toBe(32);
    expect(bayarLine?.endsWith('65.000')).toBe(true);

    const kembaliLine = lines.find(line => line.startsWith('KEMBALI'));
    expect(kembaliLine).toBeDefined();
    expect(kembaliLine?.length).toBe(32);
    expect(kembaliLine?.endsWith('0')).toBe(true);
    expect(output.endsWith('\n\n\n\x1D\x56\x00')).toBe(true);
    expect(output).toContain('\x1B\x45\x01\x1D\x21\x11');
    expect(output).toContain('\x1B\x61\x01\x1B\x45\x01\x1D\x21\x11TOTAL');
  });

  const baseTransaction: Transaction = {
    subtotal: 10000,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    total: 10000,
    paymentMethodId: 1,
    paymentAmount: 10000,
    change: 0,
    profit: 5000,
    date: new Date('2026-06-30T18:39:00Z'),
    receiptNumber: 'TXTEST123',
    status: 'completed',
  };

  const baseItems: TransactionItemRecord[] = [
    {
      transactionId: 1,
      productId: 101,
      productName: 'Kopi',
      quantity: 1,
      price: 10000,
      hpp: 5000,
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
      subtotal: 10000,
    }
  ];

  it('should print the watermark by default when cloudStoreId and hideWatermark are not active', () => {
    const mockStoreSettings: StoreSettings = {
      storeName: 'Toko Test',
      address: 'Alamat',
      phone: '123',
      receiptFooter: 'Terima kasih!',
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'test-device',
    };

    const output = getESCPOSData({
      transaction: baseTransaction,
      items: baseItems,
      storeSettings: mockStoreSettings,
      paymentMethodName: 'Tunai',
    });

    expect(output).toContain('Dicetak Dari Aplikasi');
    expect(output).toContain('SISMart');
  });

  it('should hide the watermark when hideWatermark is true', () => {
    const mockStoreSettings: StoreSettings = {
      storeName: 'Toko Test',
      address: 'Alamat',
      phone: '123',
      receiptFooter: 'Terima kasih!',
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'test-device',
      cloudStoreId: 'active-cloud-store',
      hideWatermark: true,
    };

    const output = getESCPOSData({
      transaction: baseTransaction,
      items: baseItems,
      storeSettings: mockStoreSettings,
      paymentMethodName: 'Tunai',
    });

    expect(output).not.toContain('Dicetak Dari Aplikasi');
    expect(output).not.toContain('SISMart');
  });

  it('should apply the watermark setting to daily report receipts without cloud access', () => {
    const output = getDailyReportESCPOSData({
      dateStr: '2026-06-30',
      periodStr: '00:00 - 23:59',
      txCount: 0,
      itemCount: 0,
      grossSales: 0,
      discount: 0,
      netSales: 0,
      paymentBreakdown: [],
      topProducts: [],
      storeSettings: {
        storeName: 'Toko Test',
        address: 'Alamat',
        phone: '123',
        receiptFooter: 'Terima kasih!',
        onboardingDone: true,
        lastBackupAt: null,
        deviceId: 'test-device',
        hideWatermark: true,
      },
    });

    expect(output).not.toContain('Dicetak Dari Aplikasi');
    expect(output).not.toContain('SISMart');
    expect(output.endsWith('\n\n\n\n\x1D\x56\x00')).toBe(true);
  });

  it('should hide the watermark when hideWatermark is true and no cloud store is linked', () => {
    const mockStoreSettings: StoreSettings = {
      storeName: 'Toko Test',
      address: 'Alamat',
      phone: '123',
      receiptFooter: 'Terima kasih!',
      onboardingDone: true,
      lastBackupAt: null,
      deviceId: 'test-device',
      cloudStoreId: null,
      hideWatermark: true,
    };

    const output = getESCPOSData({
      transaction: baseTransaction,
      items: baseItems,
      storeSettings: mockStoreSettings,
      paymentMethodName: 'Tunai',
    });

    expect(output).not.toContain('Dicetak Dari Aplikasi');
    expect(output).not.toContain('SISMart');
  });

  it('does not print legacy table numbers on retail receipts', () => {
    const output = getESCPOSData({
      transaction: { ...baseTransaction, tableNumber: 'TABLE-ONLY-9876' },
      items: baseItems,
      storeSettings: {
        storeName: 'Toko Test',
        address: 'Alamat',
        phone: '123',
        receiptFooter: 'Terima kasih!',
        onboardingDone: true,
        lastBackupAt: null,
        deviceId: 'test-device',
      },
      paymentMethodName: 'Tunai',
    });

    expect(output).not.toContain('Meja:');
    expect(output).not.toContain('TABLE-ONLY-9876');
  });
});

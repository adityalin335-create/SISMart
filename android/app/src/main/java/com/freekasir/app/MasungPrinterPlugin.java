package com.freekasir.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "MasungPrinter")
public class MasungPrinterPlugin extends Plugin {
    private static final int MASUNG_VENDOR_ID = 0x0519;
    private static final int MASUNG_PRODUCT_ID = 0x2013;
    private static final int TRANSFER_CHUNK_SIZE = 4096;
    private static final int TRANSFER_TIMEOUT_MS = 5000;
    private static final byte[] RECEIPT_FEED = new byte[] { 0x0A, 0x0A, 0x0A };
    private static final byte[] RECEIPT_CUT = new byte[] { 0x1D, 0x56, 0x00 };

    private final Object jobLock = new Object();
    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();
    private UsbManager usbManager;
    private BroadcastReceiver permissionReceiver;
    private PluginCall pendingCall;
    private UsbDevice pendingDevice;
    private byte[] pendingBytes;
    private boolean jobInProgress;

    @Override
    public void load() {
        usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        permissionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!permissionAction().equals(intent.getAction())) {
                    return;
                }

                PluginCall call;
                UsbDevice device;
                byte[] bytes;
                synchronized (jobLock) {
                    call = pendingCall;
                    device = pendingDevice;
                    bytes = pendingBytes;
                    pendingCall = null;
                    pendingDevice = null;
                    pendingBytes = null;
                }

                if (call == null) {
                    return;
                }

                if (!intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    finishJob(call, "Izin USB printer ditolak.");
                    return;
                }

                startPrint(call, device, bytes);
            }
        };
        IntentFilter filter = new IntentFilter(permissionAction());
        ContextCompat.registerReceiver(
            getContext(),
            permissionReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @PluginMethod
    public void getDevices(PluginCall call) {
        JSArray devices = new JSArray();
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            JSObject info = new JSObject();
            info.put("deviceName", device.getDeviceName());
            info.put("manufacturerName", device.getManufacturerName());
            info.put("productName", device.getProductName());
            info.put("vendorId", device.getVendorId());
            info.put("productId", device.getProductId());
            info.put("supported", isMasungInternalPrinter(device));
            info.put("hasPermission", usbManager.hasPermission(device));
            devices.put(info);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void print(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("Data cetak kosong.");
            return;
        }

        byte[] bytes;
        try {
            bytes = createPrintBytes(text, call.getString("imageBase64"));
        } catch (IllegalArgumentException exception) {
            call.reject("Data cetak gambar tidak valid.", exception);
            return;
        } catch (Exception exception) {
            call.reject("Gagal menyiapkan data cetak.", exception);
            return;
        }
        if (bytes.length == 0) {
            call.reject("Data cetak kosong.");
            return;
        }

        UsbDevice device = findMasungInternalPrinter();
        if (device == null) {
            call.reject("Printer internal MASUNG (VID 0x0519, PID 0x2013) tidak ditemukan.");
            return;
        }

        synchronized (jobLock) {
            if (jobInProgress) {
                call.reject("Printer sedang memproses pekerjaan cetak lain.");
                return;
            }
            jobInProgress = true;
        }
        call.setKeepAlive(true);

        if (usbManager.hasPermission(device)) {
            startPrint(call, device, bytes);
            return;
        }

        synchronized (jobLock) {
            pendingCall = call;
            pendingDevice = device;
            pendingBytes = bytes;
        }

        Intent permissionIntent = new Intent(permissionAction()).setPackage(getContext().getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent permissionPendingIntent = PendingIntent.getBroadcast(
            getContext(),
            0,
            permissionIntent,
            flags
        );
        try {
            usbManager.requestPermission(device, permissionPendingIntent);
        } catch (RuntimeException exception) {
            clearPendingJob();
            finishJob(call, "Gagal meminta izin USB printer.", exception);
        }
    }

    private byte[] createPrintBytes(String text, String imageBase64) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        output.write(new byte[] { 0x1B, 0x40, 0x1C, 0x26 });
        if (imageBase64 != null && !imageBase64.isEmpty()) {
            output.write(new byte[] { 0x1B, 0x61, 0x01 });
            output.write(Base64.decode(imageBase64, Base64.DEFAULT));
            output.write(0x0A);
        }
        byte[] textBytes = text.getBytes(Charset.forName("GB2312"));
        int textLength = textBytes.length;
        if (endsWith(textBytes, RECEIPT_CUT)) {
            textLength -= RECEIPT_CUT.length;
        }
        while (textLength > 0 && textBytes[textLength - 1] == 0x0A) {
            textLength--;
        }
        output.write(textBytes, 0, textLength);
        output.write(RECEIPT_FEED);
        output.write(RECEIPT_CUT);
        return output.toByteArray();
    }

    private boolean endsWith(byte[] value, byte[] suffix) {
        if (value.length < suffix.length) {
            return false;
        }
        int offset = value.length - suffix.length;
        for (int index = 0; index < suffix.length; index++) {
            if (value[offset + index] != suffix[index]) {
                return false;
            }
        }
        return true;
    }

    private void startPrint(PluginCall call, UsbDevice device, byte[] bytes) {
        printExecutor.execute(() -> {
            try {
                writeToPrinter(device, bytes);
                finishJob(call, null);
            } catch (Exception exception) {
                finishJob(call, exception.getMessage(), exception);
            }
        });
    }

    private void writeToPrinter(UsbDevice device, byte[] bytes) throws Exception {
        UsbDeviceConnection connection = usbManager.openDevice(device);
        if (connection == null) {
            throw new IllegalStateException("Tidak dapat membuka koneksi USB printer.");
        }

        UsbInterface claimedInterface = null;
        UsbEndpoint outputEndpoint = null;
        try {
            for (int interfaceIndex = 0; interfaceIndex < device.getInterfaceCount(); interfaceIndex++) {
                UsbInterface usbInterface = device.getInterface(interfaceIndex);
                UsbEndpoint candidateOutput = null;
                for (int endpointIndex = 0; endpointIndex < usbInterface.getEndpointCount(); endpointIndex++) {
                    UsbEndpoint endpoint = usbInterface.getEndpoint(endpointIndex);
                    if (endpoint.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK
                        && endpoint.getDirection() == UsbConstants.USB_DIR_OUT) {
                        candidateOutput = endpoint;
                        break;
                    }
                }
                if (candidateOutput != null && connection.claimInterface(usbInterface, true)) {
                    claimedInterface = usbInterface;
                    outputEndpoint = candidateOutput;
                    break;
                }
            }

            if (outputEndpoint == null) {
                throw new IllegalStateException("Printer tidak menyediakan endpoint USB bulk OUT.");
            }

            int receiptTailLength = RECEIPT_FEED.length + RECEIPT_CUT.length;
            int receiptLength = bytes.length - receiptTailLength;
            if (receiptLength < 0) {
                throw new IllegalStateException("Data struk tidak lengkap untuk dicetak.");
            }
            transferBytes(connection, outputEndpoint, bytes, 0, receiptLength);
            transferBytes(connection, outputEndpoint, RECEIPT_FEED, 0, RECEIPT_FEED.length);
            transferBytes(connection, outputEndpoint, RECEIPT_CUT, 0, RECEIPT_CUT.length);
        } finally {
            if (claimedInterface != null) {
                connection.releaseInterface(claimedInterface);
            }
            connection.close();
        }
    }

    private void transferBytes(
        UsbDeviceConnection connection,
        UsbEndpoint endpoint,
        byte[] bytes,
        int start,
        int length
    ) {
        int offset = start;
        int end = start + length;
        while (offset < end) {
            int chunkLength = Math.min(TRANSFER_CHUNK_SIZE, end - offset);
            int transferred = connection.bulkTransfer(
                endpoint,
                bytes,
                offset,
                chunkLength,
                TRANSFER_TIMEOUT_MS
            );
            if (transferred <= 0) {
                throw new IllegalStateException("Transfer data ke printer gagal.");
            }
            offset += transferred;
        }
    }

    private UsbDevice findMasungInternalPrinter() {
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            if (isMasungInternalPrinter(device)) {
                return device;
            }
        }
        return null;
    }

    private boolean isMasungInternalPrinter(UsbDevice device) {
        return device.getVendorId() == MASUNG_VENDOR_ID
            && device.getProductId() == MASUNG_PRODUCT_ID;
    }

    private String permissionAction() {
        return getContext().getPackageName() + ".MASUNG_USB_PERMISSION";
    }

    private void clearPendingJob() {
        synchronized (jobLock) {
            pendingCall = null;
            pendingDevice = null;
            pendingBytes = null;
        }
    }

    private void finishJob(PluginCall call, String error) {
        finishJob(call, error, null);
    }

    private void finishJob(PluginCall call, String error, Exception exception) {
        synchronized (jobLock) {
            jobInProgress = false;
        }
        call.setKeepAlive(false);
        if (error == null) {
            call.resolve();
        } else {
            call.reject(error, exception);
        }
        getBridge().releaseCall(call);
    }

    @Override
    protected void handleOnDestroy() {
        if (permissionReceiver != null) {
            getContext().unregisterReceiver(permissionReceiver);
            permissionReceiver = null;
        }
        printExecutor.shutdownNow();
    }
}

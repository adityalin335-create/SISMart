import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Camera, CameraOff, Flashlight, AlertCircle, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

type PermissionStatus = 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported';

/**
 * Detect the underlying error name from any error-like value.
 * html5-qrcode often wraps the original DOMException in a string,
 * so we have to look at both `error.name` and the message text.
 */
function detectErrorName(err: unknown): string {
  if (err instanceof Error && err.name) {
    // DOMException has a proper `name` like "NotAllowedError"
    if (err.name !== 'Error') return err.name;
  }
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const known = [
    'NotAllowedError',
    'NotFoundError',
    'NotReadableError',
    'OverconstrainedError',
    'SecurityError',
    'AbortError',
    'TypeError',
  ];
  for (const name of known) {
    if (msg.includes(name)) return name;
  }
  return 'UnknownError';
}

function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window.navigator as any).standalone) return true;
  // Other browsers
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

export default function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const { t } = useTranslation('products');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanningRef = useRef(false);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [permission, setPermission] = useState<PermissionStatus>('checking');
  const [errorState, setErrorState] = useState<string | null>(null);
  const scannerId = 'barcode-scanner';

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setPermission('checking');
    setErrorState(null);

    const startScanner = async () => {
      // 0. Secure context check (PWA must be HTTPS or localhost)
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        if (cancelled) return;
        setPermission('denied');
        setErrorState(t('barcodeScanner.httpsRequired'));
        return;
      }

      // 1. Check mediaDevices availability
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (cancelled) return;
        setPermission('unsupported');
        setErrorState(t('barcodeScanner.browserUnsupported'));
        return;
      }

      // 2. Pre-check permission state (best effort, not all browsers support this)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const perms = (navigator as any).permissions;
        if (perms?.query) {
          const result = await perms.query({ name: 'camera' as PermissionName });
          if (cancelled) return;
          if (result.state === 'denied') {
            setPermission('denied');
            setErrorState(
              isStandalonePWA()
                ? t('barcodeScanner.permissionDeniedNative')
                : t('barcodeScanner.permissionDeniedWeb'),
            );
            return;
          }
        }
      } catch {
        // Permissions API not supported (Safari iOS, older Android WebView). Proceed anyway.
      }

      // 3. Pre-flight getUserMedia. This forces the browser to surface the
      //    permission prompt explicitly and gives us the *real* error name
      //    before html5-qrcode wraps it.
      let preflightStream: MediaStream | null = null;
      try {
        preflightStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (err: unknown) {
        if (cancelled) {
          preflightStream?.getTracks().forEach(t => t.stop());
          return;
        }
        const name = detectErrorName(err);

        // Retry without facingMode constraint when device has no rear camera
        if (name === 'OverconstrainedError' || name === 'NotFoundError') {
          try {
            preflightStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } catch (err2: unknown) {
            if (cancelled) return;
            handlePreflightError(detectErrorName(err2));
            return;
          }
        } else {
          handlePreflightError(name);
          return;
        }
      }

      // Stop preflight stream — html5-qrcode will create its own.
      preflightStream?.getTracks().forEach(t => t.stop());
      if (cancelled) return;

      // 4. Start html5-qrcode now that permission is confirmed.
      setPermission('granted');
      try {
        const scanner = new Html5Qrcode(scannerId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        });

        scannerRef.current = scanner;
        scanningRef.current = true;

        const startWith = async (constraints: MediaTrackConstraints | { facingMode: string }) => {
          await scanner.start(
            constraints,
            { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.5 },
            decodedText => {
              onScan(decodedText);
              void handleStop();
            },
            () => {},
          );
        };

        try {
          await startWith({ facingMode: 'environment' });
        } catch (err: unknown) {
          const name = detectErrorName(err);
          if (name === 'OverconstrainedError' || name === 'NotFoundError') {
            // Fallback: list cameras and use the first available one.
            const cameras = await Html5Qrcode.getCameras();
            if (cameras.length === 0) throw err;
            await startWith({ deviceId: cameras[0].id } as MediaTrackConstraints);
          } else {
            throw err;
          }
        }

        if (cancelled) {
          void handleStop();
          return;
        }

        try {
          const caps = scanner.getRunningTrackCameraCapabilities();
          if (caps && 'torchFeature' in caps) setHasFlash(true);
        } catch {
          // capability probe failed, no flash UI
        }
      } catch (err: unknown) {
        console.error('Scanner error:', err);
        if (cancelled) return;
        handleStartError(detectErrorName(err));
      }
    };

    const handlePreflightError = (name: string) => {
      setPermission('denied');
      switch (name) {
        case 'NotAllowedError':
          setErrorState(
            isStandalonePWA()
              ? t('barcodeScanner.permissionDeniedNative')
              : t('barcodeScanner.permissionDeniedGeneric'),
          );
          break;
        case 'NotFoundError':
          setErrorState(t('barcodeScanner.noCamera'));
          break;
        case 'NotReadableError':
          setErrorState(t('barcodeScanner.cameraInUse'));
          break;
        case 'OverconstrainedError':
          setErrorState(t('barcodeScanner.cameraConfigUnsupported'));
          break;
        case 'SecurityError':
          setErrorState(t('barcodeScanner.securityBlocked'));
          break;
        default:
          setErrorState(t('barcodeScanner.accessFailed', { name }));
      }
    };

    const handleStartError = (name: string) => {
      setPermission('denied');
      setErrorState(t('barcodeScanner.startFailed', { name }));
    };

    void startScanner();

    return () => {
      cancelled = true;
      void handleStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleStop = async () => {
    if (scannerRef.current && scanningRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // Ignore errors when stopping scanner
      }
      scannerRef.current = null;
    }
    scanningRef.current = false;
    setFlashOn(false);
    setHasFlash(false);
  };

  const toggleFlash = async () => {
    if (!scannerRef.current) return;
    try {
      const track = scannerRef.current.getRunningTrackCameraCapabilities();
      if (track && 'torchFeature' in track) {
        const torch = (track as unknown as { torchFeature: () => { apply: (on: boolean) => Promise<void> } }).torchFeature();
        await torch.apply(!flashOn);
        setFlashOn(!flashOn);
      }
    } catch {
      toast.error(t('barcodeScanner.flashUnsupported'));
    }
  };

  const handleClose = async () => {
    await handleStop();
    onClose();
  };

  const showError = permission === 'denied' || permission === 'unsupported';

  return (
    <Dialog open={open} onOpenChange={v => v || handleClose()}>
      <DialogContent className="max-w-[95vw] max-h-[calc(100dvh-2rem)] rounded-xl p-0 overflow-y-auto">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            {t('barcodeScanner.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          {showError ? (
            <div className="w-full aspect-[4/3] bg-muted rounded-lg flex flex-col items-center justify-center p-6 text-center gap-3">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <p className="text-sm text-foreground font-medium">
                {errorState ?? t('barcodeScanner.cameraError')}
              </p>
              {isStandalonePWA() && permission === 'denied' && (
                <p className="text-xs text-muted-foreground">
                  {t('barcodeScanner.permissionTip')}
                </p>
              )}
            </div>
          ) : (
            <>
              <div id={scannerId} className="w-full aspect-[4/3] bg-black rounded-lg" />
              {permission === 'checking' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
                  <p className="text-white text-sm">{t('barcodeScanner.requestingPermission')}</p>
                </div>
              )}
            </>
          )}

          <div className="absolute top-3 right-3 flex gap-2">
            {hasFlash && (
              <Button
                variant="secondary"
                size="icon"
                className="h-10 w-10 rounded-full shadow-lg"
                onClick={toggleFlash}
              >
                <Flashlight className={`w-5 h-5 ${flashOn ? 'text-yellow-400' : ''}`} />
              </Button>
            )}
          </div>

          {permission === 'granted' && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
              <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full">
                <p className="text-white text-xs text-center">
                  {t('barcodeScanner.scanHint')}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 pt-2">
          <Button variant="outline" className="w-full" onClick={handleClose}>
            <CameraOff className="w-4 h-4 mr-2" />
            {showError ? t('barcodeScanner.close') : t('barcodeScanner.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

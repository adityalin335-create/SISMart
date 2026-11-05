import { Outlet } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, seedDefaultData } from '@/lib/db';
import { Suspense, useEffect, useState } from 'react';
import BottomNav from './BottomNav';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useCloudAutoBackup } from '@/hooks/use-cloud-auto-backup';
import Onboarding from '@/components/Onboarding';
import LoginScreen from '@/components/LoginScreen';
import PushPermissionModal from '@/components/PushPermissionModal';
import { useAuth } from '@/hooks/use-auth';
import { useTranslation } from 'react-i18next';

type StartupStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
type StoreSettingsStatus = 'pending' | 'found' | 'missing' | 'failed';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export default function AppLayout() {
  const { t } = useTranslation('common');
  useThemeColor(); // Apply saved theme color on mount
  useCloudAutoBackup(); // Auto cloud backup on app open (if enabled & subscribed)
  const { multiUserEnabled, currentUser, loading } = useAuth();
  const [databaseStatus, setDatabaseStatus] = useState<StartupStepStatus>('pending');
  const [seedStatus, setSeedStatus] = useState<StartupStepStatus>('pending');
  const [storeSettingsStatus, setStoreSettingsStatus] = useState<StoreSettingsStatus>('pending');
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const initializeStartup = async () => {
      setDatabaseStatus('running');
      try {
        await db.open();
        if (!active) return;
        setDatabaseStatus('success');

        setSeedStatus('running');
        await seedDefaultData();
        if (active) setSeedStatus('success');
      } catch (error) {
        console.error('[Startup] Database initialization failed:', error);
        if (active) {
          setDatabaseStatus(current => current === 'running' ? 'failed' : current);
          setSeedStatus(current => current === 'pending' ? 'skipped' : 'failed');
          setStartupError(getErrorMessage(error));
        }
      }
    };

    void initializeStartup();
    return () => {
      active = false;
    };
  }, []);

  const storeSettingsQuery = useLiveQuery(async () => {
    try {
      return {
        settings: await db.storeSettings.toCollection().first(),
        error: null as string | null,
      };
    } catch (error) {
      console.error('[Startup] Failed to read store settings:', error);
      return { settings: undefined, error: getErrorMessage(error) };
    }
  });
  const storeSettings = storeSettingsQuery?.settings;

  useEffect(() => {
    if (!storeSettingsQuery) return;

    if (storeSettingsQuery.error) {
      setStoreSettingsStatus('failed');
      setStartupError(storeSettingsQuery.error);
      return;
    }

    setStoreSettingsStatus(storeSettingsQuery.settings ? 'found' : 'missing');
  }, [storeSettingsQuery]);

  const startupReady =
    databaseStatus === 'success' &&
    seedStatus === 'success' &&
    storeSettingsStatus === 'found' &&
    !loading;

  if (!startupReady || startupError) {
    return <StartupScreen failed={Boolean(startupError)} />;
  }

  // Show onboarding if not done yet
  if (!storeSettings.onboardingDone) {
    return <Onboarding onComplete={() => { /* Dexie live query will auto-refresh */ }} />;
  }

  // Multi-user mode is on but no one is logged in → show login
  if (multiUserEnabled && !currentUser) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-[100dvh] bg-background max-w-lg md:max-w-6xl mx-auto relative">
      <main className="pb-20">
        <Suspense
          fallback={
            <div role="status" aria-label={t('loading')} className="flex min-h-[50vh] items-center justify-center">
              <span className="sr-only">{t('loading')}</span>
              <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <BottomNav />
      <PushPermissionModal />
    </div>
  );
}

function StartupScreen({ failed }: { failed: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
      <section className="w-full max-w-sm space-y-4 text-center" role={failed ? 'alert' : 'status'}>
        <h1 className="text-xl font-bold">SISMart</h1>
        {failed ? (
          <>
            <p className="text-sm text-muted-foreground">Aplikasi belum dapat dimulai. Silakan coba muat ulang.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Muat ulang
            </button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Memuat aplikasi...</p>
        )}
      </section>
    </main>
  );
}

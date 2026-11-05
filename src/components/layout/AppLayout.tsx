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
        console.error('[StartupDiagnostics] Database initialization failed:', error);
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
      console.error('[StartupDiagnostics] Failed to read store settings:', error);
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

  const onboardingVisible = Boolean(storeSettings && !storeSettings.onboardingDone);
  const startupReady =
    databaseStatus === 'success' &&
    seedStatus === 'success' &&
    storeSettingsStatus === 'found' &&
    !loading;

  if (!startupReady || startupError) {
    return (
      <StartupDiagnostics
        databaseStatus={databaseStatus}
        seedStatus={seedStatus}
        storeSettingsStatus={storeSettingsStatus}
        authLoading={loading}
        onboardingVisible={onboardingVisible}
        error={startupError}
      />
    );
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

function StartupDiagnostics({
  databaseStatus,
  seedStatus,
  storeSettingsStatus,
  authLoading,
  onboardingVisible,
  error,
}: {
  databaseStatus: StartupStepStatus;
  seedStatus: StartupStepStatus;
  storeSettingsStatus: StoreSettingsStatus;
  authLoading: boolean;
  onboardingVisible: boolean;
  error: string | null;
}) {
  const rows = [
    ['React started', 'Yes'],
    ['Dexie initialized', 'Yes'],
    ['Database open', databaseStatus],
    ['storeSettings', storeSettingsStatus],
    ['seedDefaultData', seedStatus],
    ['Auth loading', authLoading ? 'Yes' : 'No'],
    ['Onboarding visible', onboardingVisible ? 'Yes' : 'No'],
  ] as const;

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-900">
      <section className="mx-auto w-full max-w-lg space-y-5">
        <div>
          <h1 className="text-xl font-bold">SISMart startup diagnostics</h1>
          <p className="mt-1 text-sm text-slate-600">Status pemeriksaan startup aplikasi</p>
        </div>

        <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-sm font-medium">{label}</dt>
              <dd className="break-all text-right text-sm">{value}</dd>
            </div>
          ))}
        </dl>

        {error && (
          <section role="alert" className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
            <h2 className="font-semibold">Startup error</h2>
            <pre className="whitespace-pre-wrap break-words text-sm">{error}</pre>
          </section>
        )}
      </section>
    </main>
  );
}

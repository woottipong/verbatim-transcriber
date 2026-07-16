import React, { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { AppConfig } from './types';
import { STORAGE_KEYS, DEFAULT_CONFIG } from './lib/constants';
import { safeJsonParse } from './lib/utils';
import { normalizeAppConfig } from './lib/runtime';
import { AppRoute, parseAppRoute } from './lib/appRoutes';

const AdminPage = lazy(() => import('./components/AdminPage'));
const ViewerPage = lazy(() => import('./components/ViewerPage'));
const StreamPage = lazy(() => import('./components/StreamPage'));

// Load initial config from localStorage or use defaults
const getInitialConfig = (): AppConfig => {
  const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
  const parsedConfig = saved ? safeJsonParse<unknown>(saved, DEFAULT_CONFIG) : DEFAULT_CONFIG;
  const config = normalizeAppConfig(parsedConfig, DEFAULT_CONFIG);

  return {
    ...config,
    backendUrl: import.meta.env.VITE_BACKEND_URL || config.backendUrl,
  };
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(getInitialConfig);
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.hash));

  // Handle hash change for routing
  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseAppRoute(window.location.hash));
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Handlers
  const handleConfigSave = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
  }, []);

  if (route.page === 'viewer') {
    return <Suspense fallback={<RouteLoading />}>
      <ViewerPage
        onBack={window.opener ? () => window.close() : undefined}
        backendUrl={config.backendUrl}
        initialRoomName={route.roomName}
        autoConnect={route.autoConnect}
      />
    </Suspense>;
  }

  if (route.page === 'admin') {
    return <Suspense fallback={<RouteLoading />}>
      <AdminPage
        onBack={window.opener ? () => window.close() : undefined}
        backendUrl={config.backendUrl}
      />
    </Suspense>;
  }

  return <Suspense fallback={<RouteLoading />}>
    <StreamPage
      config={config}
      initialRoomName={route.roomName}
      onConfigSave={handleConfigSave}
    />
  </Suspense>;
}

function RouteLoading() {
  return <div className="app-shell flex min-h-screen items-center justify-center text-sm text-slate-400">Loading workspace…</div>;
}

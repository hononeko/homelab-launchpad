import React, { useState, useEffect, useMemo } from 'react';
import {
  ServiceItem,
  ArgoApplication,
  DiscoveredHTTPRoute,
  ClusterTelemetry,
  ClusterNode,
  TabFilter,
  MainView,
} from './types';
import {
  INITIAL_SERVICES,
  INITIAL_ARGO_APPS,
  INITIAL_DISCOVERED_ROUTES,
  INITIAL_TELEMETRY,
  INITIAL_NODES,
} from './data/initialData';
import { Header } from './components/Header';
import { ServiceCard } from './components/ServiceCard';
import { TelemetryStrip } from './components/TelemetryStrip';
import { CommandPalette } from './components/CommandPalette';
import { AutoDiscoveryModal } from './components/AutoDiscoveryModal';
import { ArgoCDView } from './components/ArgoCDView';
import { ClusterModal } from './components/ClusterModal';
import { ConfigView } from './components/ConfigView';
import { Footer } from './components/Footer';
import { MobileBottomNav } from './components/MobileBottomNav';

export default function App() {
  // Persistence state
  const [services, setServices] = useState<ServiceItem[]>(() => {
    const saved = localStorage.getItem('kerrlab_services');
    return saved ? JSON.parse(saved) : INITIAL_SERVICES;
  });

  const [argoApps, setArgoApps] = useState<ArgoApplication[]>(() => {
    const saved = localStorage.getItem('kerrlab_argo_apps');
    return saved ? JSON.parse(saved) : INITIAL_ARGO_APPS;
  });

  const [discoveredRoutes, setDiscoveredRoutes] = useState<DiscoveredHTTPRoute[]>(() => {
    const saved = localStorage.getItem('kerrlab_discovered_routes');
    return saved ? JSON.parse(saved) : INITIAL_DISCOVERED_ROUTES;
  });

  const [argoEnabled, setArgoEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('kerrlab_argo_enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const [autoSyncRoutes, setAutoSyncRoutes] = useState<boolean>(() => {
    const saved = localStorage.getItem('kerrlab_autosync_routes');
    return saved !== null ? JSON.parse(saved) : false;
  });

  // UI state
  const [currentView, setCurrentView] = useState<MainView>('overview');
  const [activeTab, setActiveTab] = useState<TabFilter>('pinned');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAutoDiscoveryOpen, setIsAutoDiscoveryOpen] = useState(false);
  const [isClusterModalOpen, setIsClusterModalOpen] = useState(false);
  const [isScanningRoutes, setIsScanningRoutes] = useState(false);
  const [isSyncingAllArgo, setIsSyncingAllArgo] = useState(false);
  const [showExtendedServices, setShowExtendedServices] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [k8sStatus, setK8sStatus] = useState<{
    connected: boolean;
    server: string | null;
    mode: string;
  }>({
    connected: false,
    server: null,
    mode: 'simulation',
  });

  // Fetch initial routes from backend and subscribe to SSE stream
  useEffect(() => {
    // 1. Fetch health & connection status
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.k8s) {
          setK8sStatus({
            connected: data.k8s.connected,
            server: data.k8s.server,
            mode: data.k8s.mode,
          });
        }
      })
      .catch((err) => console.warn('[App] Healthcheck error:', err));

    // 2. Fetch discovered routes
    fetch('/api/routes')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.routes) && data.routes.length > 0) {
          setDiscoveredRoutes((prev) => {
            const importedSet = new Set(prev.filter((r) => r.status === 'imported').map((r) => r.id));
            return data.routes.map((r: DiscoveredHTTPRoute) => ({
              ...r,
              status: importedSet.has(r.id) ? 'imported' : r.status,
            }));
          });
        }
      })
      .catch((err) => console.warn('[App] Initial routes fetch error:', err));

    // 3. Connect to SSE stream for live updates
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/routes/stream');
      eventSource.addEventListener('routes:updated', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload?.routes) {
            setDiscoveredRoutes((prev) => {
              const importedSet = new Set(prev.filter((r) => r.status === 'imported').map((r) => r.id));
              return payload.routes.map((r: DiscoveredHTTPRoute) => ({
                ...r,
                status: importedSet.has(r.id) ? 'imported' : r.status,
              }));
            });
          }
        } catch (parseErr) {
          console.error('[SSE] Failed to parse routes:updated event:', parseErr);
        }
      });
    } catch (sseErr) {
      console.warn('[SSE] EventSource init failed:', sseErr);
    }

    return () => {
      eventSource?.close();
    };
  }, []);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('kerrlab_services', JSON.stringify(services));
  }, [services]);

  useEffect(() => {
    localStorage.setItem('kerrlab_argo_apps', JSON.stringify(argoApps));
  }, [argoApps]);

  useEffect(() => {
    localStorage.setItem('kerrlab_discovered_routes', JSON.stringify(discoveredRoutes));
  }, [discoveredRoutes]);

  useEffect(() => {
    localStorage.setItem('kerrlab_argo_enabled', JSON.stringify(argoEnabled));
  }, [argoEnabled]);

  useEffect(() => {
    localStorage.setItem('kerrlab_autosync_routes', JSON.stringify(autoSyncRoutes));
  }, [autoSyncRoutes]);

  // Global keydown handler for ⌘K and /
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is inside an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          target.blur();
          setSearchQuery('');
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Toast trigger helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 2800);
  };

  // Launch service action
  const handleLaunchService = (service: ServiceItem) => {
    // Increment launches per week & update lastAccessed
    setServices((prev) =>
      prev.map((s) =>
        s.id === service.id
          ? {
              ...s,
              launchesPerWeek: s.launchesPerWeek + 1,
              lastAccessed: 'just now',
              lastAccessedTimestamp: Date.now(),
            }
          : s
      )
    );

    showToast(`Launching ${service.name} (${service.displayUrl})`);
    window.open(service.url, '_blank', 'noopener,noreferrer');
  };

  // Toggle service pin
  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setServices((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isPinned: !s.isPinned } : s))
    );
  };

  // Auto-Discovery actions
  const handleScanClusterRoutes = async () => {
    setIsScanningRoutes(true);
    try {
      const importedIds = discoveredRoutes.filter((r) => r.status === 'imported').map((r) => r.id);
      const res = await fetch('/api/routes/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importedIds }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.routes) {
          setDiscoveredRoutes(data.routes);
          showToast(`Cluster scan complete: ${data.count} HTTPRoutes verified via Gateway API`);
        }
      } else {
        showToast('Scan complete (offline simulation)');
      }
    } catch {
      showToast('Scan complete (fallback mode)');
    } finally {
      setIsScanningRoutes(false);
    }
  };

  const handleImportRoute = async (route: DiscoveredHTTPRoute) => {
    // Add to services list
    const newService: ServiceItem = {
      id: `imported-${route.id}`,
      name: route.name,
      url: `https://${route.host}`,
      displayUrl: route.host,
      description: `Discovered from k8s ns: ${route.namespace} (${route.backendService})`,
      icon: route.suggestedIcon,
      category: route.suggestedCategory,
      isPinned: false,
      launchesPerWeek: 1,
      lastAccessed: 'just added',
      lastAccessedTimestamp: Date.now(),
      status: 'active',
      latencyMs: 1.2,
      discoveredFrom: 'httproute',
      argoAppName: route.argoAppName,
    };

    setServices((prev) => [newService, ...prev]);

    // Mark route as imported locally
    setDiscoveredRoutes((prev) =>
      prev.map((r) => (r.id === route.id ? { ...r, status: 'imported' } : r))
    );

    // Persist to backend if available
    try {
      await fetch('/api/routes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId: route.id }),
      });
    } catch {
      // Non-blocking
    }

    showToast(`Imported ${newService.name} into Launchpad!`);
  };

  const handleImportAllRoutes = () => {
    const pending = discoveredRoutes.filter((r) => r.status === 'pending');
    pending.forEach((r) => handleImportRoute(r));
    showToast(`Batch imported ${pending.length} HTTPRoutes`);
  };

  const handleAddCustomRoute = (routeData: Partial<DiscoveredHTTPRoute>) => {
    const newRoute = routeData as DiscoveredHTTPRoute;
    setDiscoveredRoutes((prev) => [newRoute, ...prev]);
    showToast(`Added route ${newRoute.host}`);
    if (autoSyncRoutes) {
      handleImportRoute(newRoute);
    }
  };

  // ArgoCD Sync actions
  const handleSyncArgoApp = (appId: string) => {
    setArgoApps((prev) =>
      prev.map((a) => (a.id === appId ? { ...a, syncStatus: 'Syncing' } : a))
    );

    setTimeout(() => {
      setArgoApps((prev) =>
        prev.map((a) =>
          a.id === appId
            ? {
                ...a,
                syncStatus: 'Synced',
                lastSyncedAt: 'just now',
              }
            : a
        )
      );
      showToast(`ArgoCD synced application successfully`);
    }, 1500);
  };

  const handleSyncAllArgo = () => {
    setIsSyncingAllArgo(true);
    setArgoApps((prev) =>
      prev.map((a) => ({ ...a, syncStatus: 'Syncing' }))
    );

    setTimeout(() => {
      setIsSyncingAllArgo(false);
      setArgoApps((prev) =>
        prev.map((a) => ({
          ...a,
          syncStatus: 'Synced',
          lastSyncedAt: 'just now',
        }))
      );
      showToast('All 8 ArgoCD applications reconciled & healthy!');
    }, 2000);
  };

  const handleResetToDefaults = () => {
    if (window.confirm('Reset launchpad services to initial homelab default?')) {
      setServices(INITIAL_SERVICES);
      setArgoApps(INITIAL_ARGO_APPS);
      setDiscoveredRoutes(INITIAL_DISCOVERED_ROUTES);
      showToast('Services reset to default configuration');
    }
  };

  // Filtering & Sorting
  const pinnedServices = useMemo(() => services.filter((s) => s.isPinned), [services]);

  const mostFrequentServices = useMemo(
    () => [...services].sort((a, b) => b.launchesPerWeek - a.launchesPerWeek),
    [services]
  );

  const displayedServices = useMemo(() => {
    let list: ServiceItem[];
    if (activeTab === 'pinned') {
      list = pinnedServices;
    } else if (activeTab === 'frequent') {
      list = mostFrequentServices;
    } else {
      list = services;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.displayUrl.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeTab, pinnedServices, mostFrequentServices, services, searchQuery]);

  // Extended remaining services (services not in top 6 pinned)
  const remainingServices = useMemo(() => {
    const pinnedIds = new Set(pinnedServices.map((s) => s.id));
    return services.filter((s) => !pinnedIds.has(s.id));
  }, [services, pinnedServices]);

  // Group remaining services by category
  const categorizedRemaining = useMemo(() => {
    const categories: Record<string, ServiceItem[]> = {
      MEDIA: [],
      'HOME & LIVING': [],
      'TOOLS & DEV': [],
      'CLUSTER & OPS': [],
    };

    remainingServices.forEach((s) => {
      if (!categories[s.category]) {
        categories[s.category] = [];
      }
      categories[s.category].push(s);
    });

    return categories;
  }, [remainingServices]);

  const pendingRoutesCount = discoveredRoutes.filter((r) => r.status === 'pending').length;

  const argoSyncHealth = useMemo(() => {
    if (!argoEnabled) return 'Synced';
    if (argoApps.some((a) => a.syncStatus === 'Syncing')) return 'Syncing';
    if (argoApps.some((a) => a.syncStatus === 'OutOfSync')) return 'OutOfSync';
    return 'Synced';
  }, [argoApps, argoEnabled]);

  return (
    <div className="min-h-screen bg-[#07090D] text-[#E2E8F0] flex flex-col font-sans selection:bg-[#67df70]/20 selection:text-[#67df70]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 flex items-center gap-2 bg-[#151921] border border-[#67df70]/40 text-white px-4 py-2.5 rounded-xl shadow-2xl font-mono text-xs animate-bounce">
          <span className="w-2 h-2 rounded-full bg-[#67df70] animate-pulse"></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Header */}
      <Header
        currentView={currentView}
        onViewChange={setCurrentView}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenAutoDiscovery={() => setIsAutoDiscoveryOpen(true)}
        onOpenClusterModal={() => setIsClusterModalOpen(true)}
        pendingRoutesCount={pendingRoutesCount}
        argoSyncHealth={argoSyncHealth}
      />

      {/* Main Content Area */}
      <main className="w-full flex-1 pt-20 pb-20 md:pb-12 bg-[#07090D] relative">
        {/* Subtle radial ambient background glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(103,223,112,0.035),transparent)] pointer-events-none"></div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col items-center w-full">
          {currentView === 'overview' && (
            <div className="flex flex-col w-full max-w-4xl mx-auto gap-4">
              {/* 1. Hero Search Input */}
              <div className="w-full">
                <div
                  onClick={() => setIsSearchOpen(true)}
                  className="relative flex items-center bg-[#0A0C10]/90 hover:bg-[#0E1117] rounded-xl px-4 py-3.5 shadow-2xl backdrop-blur-md border border-[#1C212B] hover:border-[#283141] transition-all cursor-pointer group"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#64748B] group-hover:text-[#67df70] mr-3 select-none transition-colors">
                    search
                  </span>

                  <input
                    type="text"
                    readOnly
                    value={searchQuery}
                    placeholder="Search internal services, pods, or ingress routes..."
                    className="w-full bg-transparent font-mono text-[12px] sm:text-[13px] text-white placeholder:text-[#64748B] focus:outline-none cursor-pointer"
                  />

                  <div className="flex items-center gap-1.5 ml-3 select-none shrink-0">
                    <kbd className="px-1.5 py-0.5 rounded bg-[#191C22] border border-[#283141] font-mono text-[10px] text-[#94A3B8] group-hover:text-white">
                      ⌘K
                    </kbd>
                    <kbd className="px-1.5 py-0.5 rounded bg-[#191C22] border border-[#283141] font-mono text-[10px] text-[#94A3B8] group-hover:text-white">
                      /
                    </kbd>
                  </div>
                </div>
              </div>

              {/* 2. Telemetry Strip */}
              <TelemetryStrip
                telemetry={INITIAL_TELEMETRY}
                totalServices={services.length}
                onOpenSearch={() => setIsSearchOpen(true)}
                onOpenClusterModal={() => setIsClusterModalOpen(true)}
              />

              {/* 3. Filter Tabs and Sorting Bar */}
              <div className="flex items-center justify-between pt-2 pb-1 border-b border-[#1C212B]/70">
                <div className="flex items-center gap-1.5 p-1 bg-[#0A0C10] rounded-lg border border-[#1C212B]">
                  {/* Pinned & Recent */}
                  <button
                    onClick={() => setActiveTab('pinned')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-[11px] font-medium transition-all shadow-sm ${
                      activeTab === 'pinned'
                        ? 'bg-[#151921] border border-[#283141] text-[#67df70]'
                        : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      star
                    </span>
                    <span>Pinned &amp; Recent</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-[#67df70]/20 text-[#67df70] text-[10px]">
                      {pinnedServices.length}
                    </span>
                  </button>

                  {/* Most Frequent */}
                  <button
                    onClick={() => setActiveTab('frequent')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-[11px] font-medium transition-all ${
                      activeTab === 'frequent'
                        ? 'bg-[#151921] border border-[#283141] text-[#67df70]'
                        : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      trending_up
                    </span>
                    <span>Most Frequent</span>
                  </button>

                  {/* All Services */}
                  <button
                    onClick={() => setActiveTab('all')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-[11px] font-medium transition-all ${
                      activeTab === 'all'
                        ? 'bg-[#151921] border border-[#283141] text-[#67df70]'
                        : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      grid_view
                    </span>
                    <span>All Services</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-[#191C22] text-[#94A3B8] text-[10px]">
                      {services.length}
                    </span>
                  </button>
                </div>

                <div className="hidden sm:flex items-center gap-2 font-mono text-[11px] text-[#64748B]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#67df70]"></span>
                  <span>
                    SORTED BY:{' '}
                    {activeTab === 'frequent' ? 'LAUNCH FREQUENCY' : 'LAST ACCESSED'}
                  </span>
                </div>
              </div>

              {/* 4. Main Service Cards Grid (Desktop 3 cols, Tablet 2 cols, Mobile 1 col) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
                {displayedServices.map((service) => {
                  const linkedArgo = argoApps.find(
                    (a) => a.serviceId === service.id || a.name === service.argoAppName
                  );

                  return (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      argoApp={linkedArgo}
                      showArgoIntegration={argoEnabled}
                      onTogglePin={handleTogglePin}
                      onLaunch={handleLaunchService}
                    />
                  );
                })}
              </div>

              {/* 5. Expandable Remaining Services Accordion (as seen in Screen 3) */}
              {activeTab === 'pinned' && remainingServices.length > 0 && !searchQuery && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowExtendedServices(!showExtendedServices)}
                    className="w-full flex items-center justify-between p-3.5 bg-[#0A0C10] hover:bg-[#0E1117] active:bg-[#12161F] border border-[#1C212B] hover:border-[#283141] rounded-xl transition-all text-left group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-[20px] text-[#67df70] group-hover:scale-110 transition-transform">
                        {showExtendedServices ? 'expand_less' : 'expand_more'}
                      </span>
                      <div className="flex flex-col">
                        <span className="font-sans font-medium text-[13px] text-white">
                          {showExtendedServices
                            ? 'Collapse extended directory'
                            : `Show remaining ${remainingServices.length} services`}
                        </span>
                        <span className="font-mono text-[10px] text-[#94A3B8] mt-0.5">
                          Showing {pinnedServices.length} of {services.length} services • Media, Dev, Ops
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#151921] border border-[#1C212B] px-2.5 py-1 rounded text-right shrink-0">
                      <span className="font-mono text-[11px] font-semibold text-[#CBD5E1]">
                        +{remainingServices.length} more
                      </span>
                    </div>
                  </button>

                  {/* Accordion Categorized Content */}
                  {showExtendedServices && (
                    <div className="flex flex-col gap-5 pt-4 animate-fade-in">
                      {(Object.entries(categorizedRemaining) as [string, ServiceItem[]][]).map(([catName, catServices]) => {
                        if (catServices.length === 0) return null;

                        return (
                          <div key={catName} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between px-1">
                              <span className="font-mono text-[11px] uppercase tracking-wider text-[#67df70] font-semibold">
                                // {catName} ({catServices.length})
                              </span>
                              <span className="font-mono text-[10px] text-[#64748B]">
                                AUTOROUTED
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                              {catServices.map((service) => (
                                <div
                                  key={service.id}
                                  onClick={() => handleLaunchService(service)}
                                  className="service-card flex items-center justify-between p-3 bg-[#0E1117] border border-[#1C212B] rounded-xl hover:border-[#67df70]/40 transition-all cursor-pointer group"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-[#151921] border border-[#283141] flex items-center justify-center text-[#94A3B8] group-hover:text-[#67df70] shrink-0">
                                      <span className="material-symbols-outlined text-[17px]">
                                        {service.icon || 'hub'}
                                      </span>
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-sans text-[13px] font-medium text-white group-hover:text-[#67df70] truncate">
                                        {service.name}
                                      </span>
                                      <span className="font-mono text-[10px] text-[#94A3B8] truncate">
                                        {service.displayUrl}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => handleTogglePin(service.id, e)}
                                      className="p-1 text-[#64748B] hover:text-[#67df70]"
                                    >
                                      <span className="material-symbols-outlined text-[15px]">
                                        star_border
                                      </span>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 6. Quick Jump Hint Pill */}
              <div className="flex items-center justify-center pt-3 pb-2">
                <button
                  onClick={() => setIsSearchOpen(true)}
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0A0C10] border border-[#1C212B] hover:border-[#283141] text-[#94A3B8] font-mono text-[11px] transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px] text-[#67df70]">
                    bolt
                  </span>
                  <span>
                    Quick jump: Type{' '}
                    <kbd className="px-1 py-0.2 rounded bg-[#191C22] text-white">
                      /
                    </kbd>{' '}
                    or{' '}
                    <kbd className="px-1 py-0.2 rounded bg-[#191C22] text-white">
                      ⌘K
                    </kbd>{' '}
                    to find all {services.length} services
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* View: Services (Full catalog grouped by category) */}
          {currentView === 'services' && (
            <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#0E1117] p-5 rounded-2xl border border-[#1C212B]">
                <div>
                  <h2 className="text-lg font-semibold text-white tracking-tight">
                    Cluster Services Directory
                  </h2>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    All {services.length} verified internal endpoints and mesh services
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsAutoDiscoveryOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#151921] hover:bg-[#1D2026] text-white rounded-lg border border-[#283141] font-mono text-xs transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px] text-[#67df70]">
                      radar
                    </span>
                    <span>HTTPRoute Discovery</span>
                  </button>
                </div>
              </div>

              {/* Service Categories */}
              {(['HOME & LIVING', 'MEDIA', 'TOOLS & DEV', 'CLUSTER & OPS'] as const).map(
                (category) => {
                  const catServices = services.filter((s) => s.category === category);
                  if (catServices.length === 0) return null;

                  return (
                    <div key={category} className="flex flex-col gap-3">
                      <div className="flex items-center justify-between border-b border-[#1C212B] pb-2">
                        <span className="font-mono text-xs font-semibold text-[#67df70] tracking-wider">
                          // {category} ({catServices.length})
                        </span>
                        <span className="font-mono text-[10px] text-[#64748B]">
                          NAMESPACE ISOLATION
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {catServices.map((service) => (
                          <ServiceCard
                            key={service.id}
                            service={service}
                            argoApp={argoApps.find((a) => a.serviceId === service.id)}
                            showArgoIntegration={argoEnabled}
                            onTogglePin={handleTogglePin}
                            onLaunch={handleLaunchService}
                          />
                        ))}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}

          {/* View: GitOps (ArgoCD Integration) */}
          {currentView === 'gitops' && (
            <ArgoCDView
              argoEnabled={argoEnabled}
              onToggleArgo={() => setArgoEnabled(!argoEnabled)}
              applications={argoApps}
              onSyncApp={handleSyncArgoApp}
              onSyncAll={handleSyncAllArgo}
              isSyncingAll={isSyncingAllArgo}
              services={services}
              onLaunchService={handleLaunchService}
            />
          )}

          {/* View: Config */}
          {currentView === 'config' && (
            <ConfigView
              argoEnabled={argoEnabled}
              onToggleArgo={() => setArgoEnabled(!argoEnabled)}
              autoSyncRoutes={autoSyncRoutes}
              onToggleAutoSyncRoutes={() => setAutoSyncRoutes(!autoSyncRoutes)}
              onResetToDefaults={handleResetToDefaults}
              totalServicesCount={services.length}
              totalRoutesCount={discoveredRoutes.length}
            />
          )}
        </div>
      </main>

      {/* Desktop Footer */}
      <Footer
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenClusterModal={() => setIsClusterModalOpen(true)}
      />

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav
        currentView={currentView}
        onViewChange={setCurrentView}
        onOpenClusterModal={() => setIsClusterModalOpen(true)}
      />

      {/* Raycast Command Palette Modal (Screen 2) */}
      <CommandPalette
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        services={services}
        onLaunchService={handleLaunchService}
      />

      {/* Auto-Discover HTTPRoutes Modal */}
      <AutoDiscoveryModal
        isOpen={isAutoDiscoveryOpen}
        onClose={() => setIsAutoDiscoveryOpen(false)}
        discoveredRoutes={discoveredRoutes}
        onImportRoute={handleImportRoute}
        onImportAll={handleImportAllRoutes}
        onScanCluster={handleScanClusterRoutes}
        isScanning={isScanningRoutes}
        autoSyncEnabled={autoSyncRoutes}
        onToggleAutoSync={() => setAutoSyncRoutes(!autoSyncRoutes)}
        onAddCustomRoute={handleAddCustomRoute}
        k8sStatus={k8sStatus}
      />

      {/* Cluster Telemetry & Node Modal */}
      <ClusterModal
        isOpen={isClusterModalOpen}
        onClose={() => setIsClusterModalOpen(false)}
        telemetry={INITIAL_TELEMETRY}
        nodes={INITIAL_NODES}
      />
    </div>
  );
}

import React, { useState } from 'react';
import { DiscoveredHTTPRoute, ExcludedRoute, ExclusionReason, RouteAlternate, RouteOverride } from '../types';
import { RouteOverrideModal } from './RouteOverrideModal';

interface AutoDiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  discoveredRoutes: DiscoveredHTTPRoute[];
  onImportRoute: (route: DiscoveredHTTPRoute) => void;
  onImportAll: () => void;
  onScanCluster: () => void;
  isScanning: boolean;
  autoSyncEnabled: boolean;
  onToggleAutoSync: () => void;
  onAddCustomRoute: (route: Partial<DiscoveredHTTPRoute>) => void;
  hiddenRouteIds?: string[];
  onToggleRouteHidden?: (routeId: string) => void;
  // Routes the server left out (annotation, env filters, no backends)
  excludedRoutes?: ExcludedRoute[];
  // Saves (or, with null, removes) the shared name, category and icon for a host
  onSaveRouteOverride?: (host: string, override: RouteOverride | null) => Promise<boolean>;
  k8sStatus?: {
    connected: boolean;
    server: string | null;
    mode: string;
  };
}

const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  annotation: 'hidden by annotation',
  namespace: 'excluded namespace',
  'host-pattern': 'excluded host pattern',
  'no-backends': 'redirect or no backend',
};

function describeAlternates(alternates: RouteAlternate[]): string {
  const list = alternates.map((a) => `${a.namespace}/${a.name} (${a.gateways.join(', ') || 'no gateway'})`);
  return `Also served by: ${list.join('; ')}`;
}

interface RouteCardProps {
  route: DiscoveredHTTPRoute;
  isHidden: boolean;
  onImport: (route: DiscoveredHTTPRoute) => void;
  onToggleHidden?: (routeId: string) => void;
  onAdjust?: (routeId: string) => void;
}

const RouteCard: React.FC<RouteCardProps> = ({ route, isHidden, onImport, onToggleHidden, onAdjust }) => {
  const isImported = route.status === 'imported';
  return (
    <div
      className={`p-3 rounded-xl bg-[#0A0C10] border border-[#1C212B] hover:border-[#283141] flex flex-wrap items-center justify-between gap-3 group transition-colors ${
        isHidden ? 'opacity-60' : ''
      }`}
    >
      {/* Details keep at least 14rem; on narrow cards the actions wrap below them */}
      <div className="flex items-center gap-3 min-w-0 flex-[1_1_14rem]">
        <div className="w-8 h-8 rounded-lg bg-[#151921] border border-[#283141] flex items-center justify-center text-[#94A3B8] shrink-0">
          <span className="material-symbols-outlined text-[17px]">
            {route.suggestedIcon || 'alt_route'}
          </span>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono font-medium text-[13px] text-white wrap-anywhere">
              {route.name}
            </span>
            <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-[#191C22] text-[#94A3B8] border border-[#283141]">
              ns: {route.namespace}
            </span>
            {route.tlsEnabled && (
              <span className="material-symbols-outlined text-[12px] text-[#67df70]" title="TLS 1.3 Terminated">
                lock
              </span>
            )}
            {route.override && (
              <span
                className="font-mono text-[9px] px-1.5 rounded bg-[#67df70]/10 text-[#67df70] border border-[#67df70]/30"
                title="Name, category or icon set by an administrator"
              >
                adjusted
              </span>
            )}
            {route.alternates && route.alternates.length > 0 && (
              <span
                className="flex items-center gap-0.5 font-mono text-[9px] px-1.5 rounded bg-[#191C22] text-[#94A3B8] border border-[#283141]"
                title={describeAlternates(route.alternates)}
              >
                <span className="material-symbols-outlined text-[11px]">alt_route</span>
                <span>+{route.alternates.length}</span>
              </span>
            )}
          </div>
          {/* Host, then backend, on their own lines: long values wrap (at spaces
              first) instead of being truncated; the tooltip carries them in full */}
          <div
            className="font-mono text-[11px] text-[#94A3B8] mt-0.5"
            title={`${route.host} → ${route.backendService}:${route.port} (${route.gateway})`}
          >
            <div className="text-[#67df70] wrap-anywhere">{route.host}</div>
            <div className="wrap-anywhere">
              <span className="text-[#64748B]">→ </span>
              {route.backendService}:{route.port}
              <span className="text-[#64748B] hidden sm:inline"> ({route.gateway})</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {onAdjust && (
          <button
            type="button"
            onClick={() => onAdjust(route.id)}
            className="p-1 rounded text-[#64748B] hover:text-[#CBD5E1] transition-colors"
            title="Set the name, category and icon used on import"
            aria-label={`Adjust ${route.host}`}
          >
            <span className="material-symbols-outlined text-[16px]">tune</span>
          </button>
        )}
        {onToggleHidden && (
          <button
            type="button"
            onClick={() => onToggleHidden(route.id)}
            className="p-1 rounded text-[#64748B] hover:text-[#CBD5E1] transition-colors"
            title={isHidden ? 'Unhide route' : 'Hide route from this list'}
            aria-label={`${isHidden ? 'Unhide' : 'Hide'} ${route.host}`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {isHidden ? 'visibility' : 'visibility_off'}
            </span>
          </button>
        )}
        {isImported ? (
          <span className="flex items-center gap-1 font-mono text-[11px] text-[#67df70] bg-[#67df70]/10 px-2 py-1 rounded border border-[#67df70]/30">
            <span className="material-symbols-outlined text-[14px]">check</span>
            <span>Imported</span>
          </span>
        ) : (
          <button
            onClick={() => onImport(route)}
            className="flex items-center gap-1 font-mono text-[11px] font-semibold text-[#0A0C10] bg-[#67df70] hover:bg-[#52c95b] px-2.5 py-1 rounded shadow-sm transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[13px]">
              add
            </span>
            <span>Add to Launchpad</span>
          </button>
        )}
      </div>
    </div>
  );
};

export const AutoDiscoveryModal: React.FC<AutoDiscoveryModalProps> = ({
  isOpen,
  onClose,
  discoveredRoutes,
  onImportRoute,
  onImportAll,
  onScanCluster,
  isScanning,
  autoSyncEnabled,
  onToggleAutoSync,
  onAddCustomRoute,
  hiddenRouteIds = [],
  onToggleRouteHidden,
  excludedRoutes = [],
  onSaveRouteOverride,
  k8sStatus,
}) => {
  const [overrideRouteId, setOverrideRouteId] = useState<string | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHost, setNewHost] = useState('');
  const [newName, setNewName] = useState('');
  const [newNamespace, setNewNamespace] = useState('apps');
  const [newCategory, setNewCategory] = useState<'MEDIA' | 'HOME & LIVING' | 'TOOLS & DEV' | 'CLUSTER & OPS'>('TOOLS & DEV');

  if (!isOpen) return null;

  // No route has a null id, so nothing matches while no route is being adjusted
  const overrideRoute = discoveredRoutes.find((r) => r.id === overrideRouteId);

  const hidden = new Set(hiddenRouteIds);
  const hiddenCount = discoveredRoutes.filter((r) => hidden.has(r.id)).length;
  const listedRoutes = showHidden ? discoveredRoutes : discoveredRoutes.filter((r) => !hidden.has(r.id));

  const namespaces = ['all', ...Array.from(new Set(listedRoutes.map((r) => r.namespace)))];
  const filteredRoutes = selectedNamespace === 'all'
    ? listedRoutes
    : listedRoutes.filter((r) => r.namespace === selectedNamespace);

  // Hidden routes are never imported in bulk
  const pendingCount = discoveredRoutes.filter((r) => r.status === 'pending' && !hidden.has(r.id)).length;

  const handleCustomSubmit = (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newHost.trim() || !newName.trim()) return;

    onAddCustomRoute({
      id: `custom-route-${Date.now()}`,
      name: newName.trim(),
      host: newHost.trim(),
      namespace: newNamespace,
      gateway: 'cilium-gateway-l7',
      backendService: `${newName.toLowerCase().replace(/\s+/g, '-')}-svc`,
      port: 8080,
      tlsEnabled: true,
      status: 'pending',
      suggestedCategory: newCategory,
      suggestedIcon: newCategory === 'MEDIA' ? 'movie' : newCategory === 'HOME & LIVING' ? 'home' : 'terminal',
      discoveredAt: 'just now',
      path: '/',
    });

    setNewHost('');
    setNewName('');
    setShowAddForm(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07090D]/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-[92vw] max-w-2xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl rounded-2xl bg-[#0E1117] border border-[#283141] shadow-[0_24px_70px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#0A0C10] border-b border-[#1C212B]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#151921] border border-[#283141] flex items-center justify-center text-[#67df70]">
              <span className="material-symbols-outlined text-[20px]">
                radar
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-[16px] text-white tracking-tight">
                  HTTPRoute Auto-Discovery Engine
                </h2>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#67df70]/10 text-[#67df70] border border-[#67df70]/30 font-medium">
                  Gateway API v1
                </span>
              </div>
              <p className="font-mono text-[11px] text-[#94A3B8]">
                Scans the cluster for Gateway API HTTPRoutes and Ingresses
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {k8sStatus && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151921] border border-[#283141] font-mono text-[10px]">
                <span className={`w-1.5 h-1.5 rounded-full ${k8sStatus.connected ? 'bg-[#67df70] animate-pulse' : 'bg-amber-400'}`}></span>
                <span className="text-[#CBD5E1]">
                  {k8sStatus.connected ? 'K8s Cluster' : 'Simulation'}
                </span>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-[#94A3B8] hover:text-white flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Toolbar & Controls */}
        <div className="p-4 bg-[#0E1117] border-b border-[#1C212B] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onScanCluster}
              disabled={isScanning}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#67df70] hover:bg-[#52c95b] disabled:bg-[#1D2026] text-[#0A0C10] disabled:text-[#64748B] font-mono text-[12px] font-semibold transition-all shadow-sm cursor-pointer"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${
                  isScanning ? 'animate-spin' : ''
                }`}
              >
                refresh
              </span>
              <span>{isScanning ? 'Probing Cluster...' : 'Scan Ingress Routes'}</span>
            </button>

            {pendingCount > 0 && (
              <button
                onClick={onImportAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-[#E2E8F0] font-mono text-[12px] border border-[#283141] transition-colors"
              >
                <span className="material-symbols-outlined text-[15px] text-[#67df70]">
                  add_task
                </span>
                <span>Import All ({pendingCount})</span>
              </button>
            )}

            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-2.5 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-[#94A3B8] hover:text-white font-mono text-[12px] border border-[#283141] transition-colors"
            >
              {showAddForm ? 'Cancel' : '+ Custom Route'}
            </button>
          </div>

          {/* Auto-Sync Toggle */}
          <div className="flex items-center gap-2 font-mono text-[11px] text-[#94A3B8]">
            <span>Auto-import:</span>
            <button
              type="button"
              onClick={onToggleAutoSync}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                autoSyncEnabled ? 'bg-[#67df70]' : 'bg-[#283141]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0A0C10] shadow ring-0 transition duration-200 ease-in-out ${
                  autoSyncEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Custom Route Form */}
        {showAddForm && (
          <form onSubmit={handleCustomSubmit} className="p-4 bg-[#151921] border-b border-[#1C212B] flex flex-col gap-3 animate-fade-in">
            <span className="font-mono text-[11px] text-[#67df70] font-semibold">
              // DEFINE NEW INGRESS / HTTPROUTE
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">
                  Service Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Immich, Paperless"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-[#0E1117] border border-[#283141] rounded-lg px-3 py-1.5 font-mono text-[12px] text-white focus:border-[#67df70] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">
                  Host Domain
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. photos.kerrlab.app"
                  value={newHost}
                  onChange={(e) => setNewHost(e.target.value)}
                  className="w-full bg-[#0E1117] border border-[#283141] rounded-lg px-3 py-1.5 font-mono text-[12px] text-white focus:border-[#67df70] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">
                  Kubernetes Namespace
                </label>
                <input
                  type="text"
                  value={newNamespace}
                  onChange={(e) => setNewNamespace(e.target.value)}
                  className="w-full bg-[#0E1117] border border-[#283141] rounded-lg px-3 py-1.5 font-mono text-[12px] text-white focus:border-[#67df70] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">
                  Target Category
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full bg-[#0E1117] border border-[#283141] rounded-lg px-3 py-1.5 font-mono text-[12px] text-white focus:border-[#67df70] focus:outline-none"
                >
                  <option value="MEDIA">MEDIA</option>
                  <option value="HOME & LIVING">HOME & LIVING</option>
                  <option value="TOOLS & DEV">TOOLS & DEV</option>
                  <option value="CLUSTER & OPS">CLUSTER & OPS</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1 text-[11px] font-mono text-[#94A3B8] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1 bg-[#67df70] text-[#0A0C10] rounded-md font-mono text-[11px] font-semibold hover:bg-[#52c95b]"
              >
                Add Route
              </button>
            </div>
          </form>
        )}

        {/* Namespace filters */}
        <div className="px-5 py-2 bg-[#0A0C10] border-b border-[#1C212B] flex flex-wrap items-center gap-2 text-[11px] font-mono">
          <span className="text-[#64748B]">Filter NS:</span>
          {namespaces.map((ns) => (
            <button
              key={ns}
              onClick={() => setSelectedNamespace(ns)}
              className={`px-2 py-0.5 rounded transition-colors ${
                selectedNamespace === ns
                  ? 'bg-[#67df70]/20 text-[#67df70] border border-[#67df70]/40'
                  : 'bg-[#151921] text-[#94A3B8] hover:text-white border border-[#1C212B]'
              }`}
            >
              {ns}
            </button>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden(!showHidden)}
              aria-pressed={showHidden}
              className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                showHidden
                  ? 'bg-[#283141] text-white border-[#3a4558]'
                  : 'bg-[#151921] text-[#94A3B8] hover:text-white border-[#1C212B]'
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">
                {showHidden ? 'visibility' : 'visibility_off'}
              </span>
              <span>Show hidden ({hiddenCount})</span>
            </button>
          )}
        </div>

        {/* Discovered Routes Table / List */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-subtle p-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 content-start">
          {filteredRoutes.length === 0 ? (
            <div className="col-span-full py-12 text-center text-[#64748B]">
              <span className="material-symbols-outlined text-[32px] mb-1">
                cloud_done
              </span>
              <p className="font-mono text-[13px] text-[#94A3B8]">
                No discovered HTTPRoutes in this namespace.
              </p>
              <p className="font-mono text-[11px] mt-1">
                Click "Scan Ingress Routes" or add a custom route.
              </p>
            </div>
          ) : (
            filteredRoutes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                isHidden={hidden.has(route.id)}
                onImport={onImportRoute}
                onToggleHidden={onToggleRouteHidden}
                onAdjust={onSaveRouteOverride ? setOverrideRouteId : undefined}
              />
            ))
          )}

          {excludedRoutes.length > 0 && (
            <details className="col-span-full rounded-xl border border-dashed border-[#1C212B] font-mono text-[11px] text-[#64748B]">
              <summary className="px-3 py-2 cursor-pointer select-none hover:text-[#94A3B8]">
                {excludedRoutes.length} {excludedRoutes.length === 1 ? 'route' : 'routes'} excluded by the server
              </summary>
              <ul className="px-3 pb-2 flex flex-col gap-1">
                {excludedRoutes.map((r) => (
                  <li key={`${r.namespace}/${r.name}`} className="flex flex-wrap gap-x-2">
                    <span className="text-[#94A3B8] wrap-anywhere">{r.host}</span>
                    <span>
                      {r.namespace}/{r.name} • {EXCLUSION_LABELS[r.reason]}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-[#0A0C10] border-t border-[#1C212B] flex items-center justify-between font-mono text-[10px] text-[#64748B]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#67df70]"></span>
            <span>
              Showing {filteredRoutes.length} of {discoveredRoutes.length} routes
              {selectedNamespace === 'all' ? '' : ` in ${selectedNamespace}`}
            </span>
          </div>
          <span>{pendingCount} not yet on the launchpad</span>
        </div>

        {/* Inside the panel, so clicks in the dialog never reach the backdrop's close handler */}
        {overrideRoute && onSaveRouteOverride && (
          <RouteOverrideModal
            key={overrideRoute.id}
            route={overrideRoute}
            onSave={onSaveRouteOverride}
            onClose={() => setOverrideRouteId(null)}
          />
        )}
      </div>
    </div>
  );
};

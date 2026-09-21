import React, { useState, useMemo } from 'react';
import { ArgoApplication, ServiceItem } from '../types';

interface ArgoCDViewProps {
  argoEnabled: boolean;
  onToggleArgo: () => void;
  applications: ArgoApplication[];
  onSyncApp: (appId: string) => void;
  onSyncAll: () => void;
  isSyncingAll: boolean;
  services: ServiceItem[];
  onLaunchService: (service: ServiceItem) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

function getSyncBadgeStyles(syncStatus: string, isSyncing: boolean) {
  if (isSyncing) {
    return {
      container: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
      dot: 'bg-amber-400 animate-pulse',
    };
  }
  if (syncStatus === 'Synced') {
    return {
      container: 'bg-[#67df70]/10 text-[#67df70] border border-[#67df70]/30',
      dot: 'bg-[#67df70]',
    };
  }
  return {
    container: 'bg-rose-500/10 text-rose-400 border border-rose-500/30',
    dot: 'bg-rose-400',
  };
}

interface StatusMetricsProps {
  syncedCount: number;
  outOfSyncCount: number;
  totalCount: number;
  healthPercent: number;
  healthyCount: number;
  isSyncingAll: boolean;
  isRefreshing: boolean;
  onSyncAll: () => void;
  onRefresh?: () => void;
}

const StatusMetricsRibbon: React.FC<StatusMetricsProps> = ({
  syncedCount,
  outOfSyncCount,
  totalCount,
  healthPercent,
  healthyCount,
  isSyncingAll,
  isRefreshing,
  onSyncAll,
  onRefresh,
}) => {
  const syncSubtext = outOfSyncCount === 0 ? '0 Out of Sync' : `${outOfSyncCount} Needs Sync`;
  const syncSubtextClass = outOfSyncCount > 0 ? 'text-amber-400 font-semibold' : 'text-[#64748B]';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
      <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col">
        <span className="font-mono text-[10px] text-[#94A3B8] uppercase">SERVER ENDPOINT</span>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="w-2 h-2 rounded-full bg-[#67df70]"></span>
          <span className="font-mono text-xs text-white truncate font-medium">argo.kerrlab.app</span>
        </div>
        <span className="font-mono text-[10px] text-[#64748B] mt-1">K8s CRD Controller (argocd)</span>
      </div>

      <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col">
        <span className="font-mono text-[10px] text-[#94A3B8] uppercase">SYNC STATUS</span>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="font-mono text-xl font-semibold text-[#67df70]">{syncedCount}</span>
          <span className="font-mono text-xs text-[#94A3B8]">/ {totalCount} Synced</span>
        </div>
        <span className={`font-mono text-[10px] mt-1 ${syncSubtextClass}`}>{syncSubtext}</span>
      </div>

      <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col">
        <span className="font-mono text-[10px] text-[#94A3B8] uppercase">OVERALL HEALTH</span>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="material-symbols-outlined text-[16px] text-[#67df70]">favorite</span>
          <span className="font-mono text-sm text-white font-medium">{healthPercent}% HEALTHY</span>
        </div>
        <span className="font-mono text-[10px] text-[#64748B] mt-1">
          {healthyCount} / {totalCount} applications healthy
        </span>
      </div>

      <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col justify-between">
        <span className="font-mono text-[10px] text-[#94A3B8] uppercase">GITOPS RECONCILIATION</span>
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={onSyncAll}
            disabled={isSyncingAll}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-white font-mono text-xs border border-[#283141] transition-all cursor-pointer disabled:opacity-50"
            title="Reconcile all OutOfSync applications"
          >
            <span className={`material-symbols-outlined text-[15px] text-[#67df70] ${isSyncingAll ? 'animate-spin' : ''}`}>
              sync
            </span>
            <span>{isSyncingAll ? 'Syncing...' : 'Sync All'}</span>
          </button>

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-[#94A3B8] hover:text-white border border-[#283141] transition-all cursor-pointer disabled:opacity-50"
              title="Refresh applications from cluster"
            >
              <span className={`material-symbols-outlined text-[15px] ${isRefreshing ? 'animate-spin text-[#67df70]' : ''}`}>
                refresh
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface ApplicationItemProps {
  app: ArgoApplication;
  linkedService?: ServiceItem;
  onLaunchService: (service: ServiceItem) => void;
  onSyncApp: (appId: string) => void;
}

const ApplicationItem: React.FC<ApplicationItemProps> = ({
  app,
  linkedService,
  onLaunchService,
  onSyncApp,
}) => {
  const isSyncing = app.syncStatus === 'Syncing';
  const badgeStyles = getSyncBadgeStyles(app.syncStatus, isSyncing);

  return (
    <div className="p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-[#151921]/60 transition-colors">
      <div className="flex items-start gap-3.5 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-[#151921] border border-[#283141] flex items-center justify-center text-[#67df70] shrink-0 mt-0.5">
          <span className="material-symbols-outlined text-[18px]">deployed_code</span>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-sm text-white tracking-tight font-mono">{app.name}</h4>
            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-[#0A0C10] text-[#94A3B8] border border-[#1C212B]">
              project: {app.project}
            </span>

            <span className={`flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded ${badgeStyles.container}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${badgeStyles.dot}`}></span>
              <span>{app.syncStatus}</span>
            </span>

            <span className="flex items-center gap-1 font-mono text-[10px] text-[#67df70]">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              <span>{app.healthStatus}</span>
            </span>
          </div>

          <p className="font-mono text-xs text-[#94A3B8] mt-1 truncate">{app.commitMessage}</p>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-[#64748B] mt-1.5">
            <span className="text-[#94A3B8]">{app.targetRevision}</span>
            <span>•</span>
            <span>Synced {app.lastSyncedAt}</span>
            <span>•</span>
            <span className="truncate max-w-[200px]">{app.repoUrl}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
        {linkedService && (
          <button
            onClick={() => onLaunchService(linkedService)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0A0C10] hover:bg-[#151921] border border-[#1C212B] text-xs font-mono text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
            title={`Launch ${linkedService.name}`}
          >
            <span className="material-symbols-outlined text-[14px]">launch</span>
            <span className="hidden sm:inline">Launch</span>
          </button>
        )}

        <button
          onClick={() => onSyncApp(app.id)}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] border border-[#283141] text-xs font-mono text-[#E2E8F0] hover:text-white transition-colors cursor-pointer disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-[14px] text-[#67df70] ${isSyncing ? 'animate-spin' : ''}`}>
            sync
          </span>
          <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>
      </div>
    </div>
  );
};

export const ArgoCDView: React.FC<ArgoCDViewProps> = ({
  argoEnabled,
  onToggleArgo,
  applications,
  onSyncApp,
  onSyncAll,
  isSyncingAll,
  services,
  onLaunchService,
  onRefresh,
  isRefreshing = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'synced' | 'outofsync' | 'syncing'>('all');

  const syncedCount = applications.filter((a) => a.syncStatus === 'Synced').length;
  const outOfSyncCount = applications.filter((a) => a.syncStatus === 'OutOfSync').length;
  const syncingCount = applications.filter((a) => a.syncStatus === 'Syncing').length;
  const healthyCount = applications.filter((a) => a.healthStatus === 'Healthy').length;
  const healthPercent = applications.length > 0 ? Math.round((healthyCount / applications.length) * 100) : 100;

  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        app.name.toLowerCase().includes(q) ||
        app.project.toLowerCase().includes(q) ||
        app.commitMessage.toLowerCase().includes(q) ||
        app.repoUrl.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'synced' && app.syncStatus === 'Synced') ||
        (statusFilter === 'outofsync' && app.syncStatus === 'OutOfSync') ||
        (statusFilter === 'syncing' && app.syncStatus === 'Syncing');

      return matchesQuery && matchesStatus;
    });
  }, [applications, searchQuery, statusFilter]);

  if (!argoEnabled) {
    return (
      <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 animate-fade-in">
        <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#151921] border border-[#283141] flex items-center justify-center text-[#67df70] shrink-0">
              <span className="material-symbols-outlined text-[24px]">published_with_changes</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white tracking-tight">ArgoCD GitOps Integration</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">Continuous deployment sync monitoring for homelab manifests</p>
            </div>
          </div>
          <button
            onClick={onToggleArgo}
            className="px-4 py-2 bg-[#67df70] hover:bg-[#52c95b] text-[#0A0C10] rounded-xl font-mono text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            Enable ArgoCD Sync
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 animate-fade-in">
      {/* Top Banner / Integration Toggle */}
      <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#151921] border border-[#283141] flex items-center justify-center text-[#67df70] shrink-0">
            <span className="material-symbols-outlined text-[24px]">published_with_changes</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white tracking-tight">ArgoCD GitOps Integration</h2>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#67df70]/10 text-[#67df70] border border-[#67df70]/30 font-medium">
                Kubernetes CRD
              </span>
            </div>
            <p className="text-xs text-[#94A3B8] mt-0.5">Continuous deployment sync monitoring for homelab Kubernetes manifests</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-xs text-[#94A3B8]">
            <span>Integration Status:</span>
            <button
              type="button"
              onClick={onToggleArgo}
              className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-[#67df70]"
            >
              <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#0A0C10] shadow ring-0 transition duration-200 ease-in-out translate-x-5" />
            </button>
            <span className="font-semibold text-[#67df70]">ACTIVE</span>
          </div>
        </div>
      </div>

      {/* Status Metrics Ribbon */}
      <StatusMetricsRibbon
        syncedCount={syncedCount}
        outOfSyncCount={outOfSyncCount}
        totalCount={applications.length}
        healthPercent={healthPercent}
        healthyCount={healthyCount}
        isSyncingAll={isSyncingAll}
        isRefreshing={isRefreshing}
        onSyncAll={onSyncAll}
        onRefresh={onRefresh}
      />

      {/* Applications Table / Cards */}
      <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl overflow-hidden shadow-md">
        {/* Header with Search and Filter */}
        <div className="px-5 py-3.5 bg-[#0A0C10] border-b border-[#1C212B] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-xs text-[#94A3B8]">
            <span className="text-[#67df70] font-semibold">// MANAGED APPLICATIONS</span>
            <span>({filteredApps.length} of {applications.length})</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-[#64748B]">
                search
              </span>
              <input
                type="text"
                placeholder="Search applications..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#151921] border border-[#283141] text-white placeholder-[#64748B] text-xs font-mono rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:border-[#67df70]/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-white"
                >
                  <span className="material-symbols-outlined text-[13px]">close</span>
                </button>
              )}
            </div>

            <a
              href="https://argo.kerrlab.app"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono text-[11px] text-[#94A3B8] hover:text-[#67df70] transition-colors shrink-0"
            >
              <span className="hidden sm:inline">Open Argo UI</span>
              <span className="material-symbols-outlined text-[13px]">open_in_new</span>
            </a>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="px-5 py-2 bg-[#0E1117] border-b border-[#1C212B] flex items-center gap-2 overflow-x-auto text-xs font-mono">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              statusFilter === 'all' ? 'bg-[#1C212B] text-white font-semibold' : 'text-[#64748B] hover:text-[#94A3B8]'
            }`}
          >
            All ({applications.length})
          </button>
          <button
            onClick={() => setStatusFilter('outofsync')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              statusFilter === 'outofsync'
                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 font-semibold'
                : outOfSyncCount > 0
                ? 'text-rose-400 hover:bg-rose-500/10'
                : 'text-[#64748B] hover:text-[#94A3B8]'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            <span>Out of Sync ({outOfSyncCount})</span>
          </button>
          <button
            onClick={() => setStatusFilter('synced')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              statusFilter === 'synced'
                ? 'bg-[#67df70]/10 text-[#67df70] border border-[#67df70]/30 font-semibold'
                : 'text-[#64748B] hover:text-[#94A3B8]'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#67df70]"></span>
            <span>Synced ({syncedCount})</span>
          </button>
          {syncingCount > 0 && (
            <button
              onClick={() => setStatusFilter('syncing')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                statusFilter === 'syncing'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold'
                  : 'text-amber-400 hover:bg-amber-500/10'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
              <span>Syncing ({syncingCount})</span>
            </button>
          )}
        </div>

        {/* Applications List */}
        {filteredApps.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[32px] text-[#64748B]">filter_list_off</span>
            <p className="text-xs text-[#94A3B8] font-mono">No applications matched the filter</p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs font-mono text-[#67df70] hover:underline cursor-pointer mt-1"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#1C212B]">
            {filteredApps.map((app) => (
              <ApplicationItem
                key={app.id}
                app={app}
                linkedService={services.find((s) => s.id === app.serviceId || s.argoAppName === app.name)}
                onLaunchService={onLaunchService}
                onSyncApp={onSyncApp}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

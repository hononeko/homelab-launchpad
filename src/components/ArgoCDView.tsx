import React from 'react';
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
}

export const ArgoCDView: React.FC<ArgoCDViewProps> = ({
  argoEnabled,
  onToggleArgo,
  applications,
  onSyncApp,
  onSyncAll,
  isSyncingAll,
  services,
  onLaunchService,
}) => {
  const syncedCount = applications.filter((a) => a.syncStatus === 'Synced').length;
  const outOfSyncCount = applications.filter((a) => a.syncStatus === 'OutOfSync').length;

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 animate-fade-in">
      {/* Top Banner / Integration Toggle */}
      <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#151921] border border-[#283141] flex items-center justify-center text-[#67df70] shrink-0">
            <span className="material-symbols-outlined text-[24px]">
              published_with_changes
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white tracking-tight">
                ArgoCD GitOps Integration
              </h2>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#67df70]/10 text-[#67df70] border border-[#67df70]/30 font-medium">
                v2.13.0 API
              </span>
            </div>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Continuous deployment sync monitoring for homelab Kubernetes manifests
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-xs text-[#94A3B8]">
            <span>Integration Status:</span>
            <button
              type="button"
              onClick={onToggleArgo}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                argoEnabled ? 'bg-[#67df70]' : 'bg-[#283141]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#0A0C10] shadow ring-0 transition duration-200 ease-in-out ${
                  argoEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`font-semibold ${argoEnabled ? 'text-[#67df70]' : 'text-[#64748B]'}`}>
              {argoEnabled ? 'ACTIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      {!argoEnabled ? (
        <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#151921] border border-[#283141] flex items-center justify-center text-[#64748B]">
            <span className="material-symbols-outlined text-[28px]">
              sync_disabled
            </span>
          </div>
          <h3 className="text-base font-semibold text-white">
            ArgoCD Integration is currently disabled
          </h3>
          <p className="text-xs text-[#94A3B8] max-w-md">
            Enable the toggle above to stream live application health status, target commit revisions, and synchronization triggers directly into your launchpad.
          </p>
          <button
            onClick={onToggleArgo}
            className="mt-2 px-4 py-2 bg-[#67df70] hover:bg-[#52c95b] text-[#0A0C10] rounded-xl font-mono text-xs font-semibold shadow-sm transition-colors"
          >
            Enable ArgoCD Sync
          </button>
        </div>
      ) : (
        <>
          {/* Status Metrics Ribbon */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col">
              <span className="font-mono text-[10px] text-[#94A3B8] uppercase">
                SERVER ENDPOINT
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-2 h-2 rounded-full bg-[#67df70]"></span>
                <span className="font-mono text-xs text-white truncate font-medium">
                  argo.kerrlab.app
                </span>
              </div>
              <span className="font-mono text-[10px] text-[#64748B] mt-1">
                Response: 12ms (gRPC)
              </span>
            </div>

            <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col">
              <span className="font-mono text-[10px] text-[#94A3B8] uppercase">
                SYNC STATUS
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="font-mono text-xl font-semibold text-[#67df70]">
                  {syncedCount}
                </span>
                <span className="font-mono text-xs text-[#94A3B8]">
                  / {applications.length} Synced
                </span>
              </div>
              <span className="font-mono text-[10px] text-[#64748B] mt-1">
                {outOfSyncCount === 0 ? '0 Out of Sync' : `${outOfSyncCount} Needs Sync`}
              </span>
            </div>

            <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col">
              <span className="font-mono text-[10px] text-[#94A3B8] uppercase">
                OVERALL HEALTH
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="material-symbols-outlined text-[16px] text-[#67df70]">
                  favorite
                </span>
                <span className="font-mono text-sm text-white font-medium">
                  100% HEALTHY
                </span>
              </div>
              <span className="font-mono text-[10px] text-[#64748B] mt-1">
                All replica pods ready
              </span>
            </div>

            <div className="bg-[#0E1117] border border-[#1C212B] rounded-xl p-3.5 flex flex-col justify-between">
              <span className="font-mono text-[10px] text-[#94A3B8] uppercase">
                GITOPS RECONCILIATION
              </span>
              <button
                onClick={onSyncAll}
                disabled={isSyncingAll}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-white font-mono text-xs border border-[#283141] transition-all cursor-pointer mt-1"
              >
                <span
                  className={`material-symbols-outlined text-[15px] text-[#67df70] ${
                    isSyncingAll ? 'animate-spin' : ''
                  }`}
                >
                  sync
                </span>
                <span>{isSyncingAll ? 'Syncing Cluster...' : 'Sync All Apps'}</span>
              </button>
            </div>
          </div>

          {/* Applications Table / Cards */}
          <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl overflow-hidden shadow-md">
            <div className="px-5 py-3 bg-[#0A0C10] border-b border-[#1C212B] flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-xs text-[#94A3B8]">
                <span className="text-[#67df70] font-semibold">// MANAGED APPLICATIONS</span>
                <span>({applications.length})</span>
              </div>
              <a
                href="https://argo.kerrlab.app"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-[11px] text-[#94A3B8] hover:text-[#67df70] transition-colors"
              >
                <span>Open Argo Web UI</span>
                <span className="material-symbols-outlined text-[13px]">
                  open_in_new
                </span>
              </a>
            </div>

            <div className="divide-y divide-[#1C212B]">
              {applications.map((app) => {
                const isSyncing = app.syncStatus === 'Syncing';
                const linkedService = services.find((s) => s.id === app.serviceId || s.argoAppName === app.name);

                return (
                  <div
                    key={app.id}
                    className="p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-[#151921]/60 transition-colors"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-[#151921] border border-[#283141] flex items-center justify-center text-[#67df70] shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-[18px]">
                          deployed_code
                        </span>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-sm text-white tracking-tight font-mono">
                            {app.name}
                          </h4>
                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-[#0A0C10] text-[#94A3B8] border border-[#1C212B]">
                            project: {app.project}
                          </span>

                          <span
                            className={`flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded ${
                              isSyncing
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                : app.syncStatus === 'Synced'
                                ? 'bg-[#67df70]/10 text-[#67df70] border border-[#67df70]/30'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                isSyncing
                                  ? 'bg-amber-400 animate-pulse'
                                  : app.syncStatus === 'Synced'
                                  ? 'bg-[#67df70]'
                                  : 'bg-rose-400'
                              }`}
                            ></span>
                            <span>{app.syncStatus}</span>
                          </span>

                          <span className="flex items-center gap-1 font-mono text-[10px] text-[#67df70]">
                            <span className="material-symbols-outlined text-[13px]">
                              check_circle
                            </span>
                            <span>{app.healthStatus}</span>
                          </span>
                        </div>

                        <p className="font-mono text-xs text-[#94A3B8] mt-1 truncate">
                          {app.commitMessage}
                        </p>

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
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0A0C10] hover:bg-[#151921] border border-[#1C212B] text-xs font-mono text-[#94A3B8] hover:text-white transition-colors"
                          title={`Launch ${linkedService.name}`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            launch
                          </span>
                          <span className="hidden sm:inline">Launch</span>
                        </button>
                      )}

                      <button
                        onClick={() => onSyncApp(app.id)}
                        disabled={isSyncing}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] border border-[#283141] text-xs font-mono text-[#E2E8F0] hover:text-white transition-colors cursor-pointer"
                      >
                        <span
                          className={`material-symbols-outlined text-[14px] text-[#67df70] ${
                            isSyncing ? 'animate-spin' : ''
                          }`}
                        >
                          sync
                        </span>
                        <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

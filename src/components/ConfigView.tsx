import React, { useState } from 'react';

interface ConfigViewProps {
  argoEnabled: boolean;
  onToggleArgo: () => void;
  autoSyncRoutes: boolean;
  onToggleAutoSyncRoutes: () => void;
  onResetToDefaults: () => void;
  totalServicesCount: number;
  totalRoutesCount: number;
}

export const ConfigView: React.FC<ConfigViewProps> = ({
  argoEnabled,
  onToggleArgo,
  autoSyncRoutes,
  onToggleAutoSyncRoutes,
  onResetToDefaults,
  totalServicesCount,
  totalRoutesCount,
}) => {
  const [clusterDomain, setClusterDomain] = useState('kerrlab.app');
  const [argoUrl, setArgoUrl] = useState('https://argo.kerrlab.app');
  const [gatewayClass, setGatewayClass] = useState('cilium-l7');
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-6 shadow-lg flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-[#67df70]">
            <span>SYSTEM // PREFERENCES</span>
            <span className="text-[#64748B]">/</span>
            <span className="text-[#94A3B8]">LAUNCHPAD CONFIG</span>
          </div>
          <h2 className="text-xl font-semibold text-white tracking-tight mt-1">
            Homelab Launchpad Configuration
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            Manage domain routing, Gateway API discovery parameters, and ArgoCD integration.
          </p>
        </div>

        {savedNotice && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#67df70]/10 border border-[#67df70]/30 text-[#67df70] font-mono text-xs animate-fade-in">
            <span className="material-symbols-outlined text-[15px]">check</span>
            <span>Saved!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-5">
        {/* Network & Ingress Routing Section */}
        <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-6 shadow-sm">
          <h3 className="font-mono text-xs font-semibold text-[#67df70] uppercase tracking-wider mb-4">
            // INGRESS &amp; DOMAIN ROUTING
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block font-mono text-xs text-[#94A3B8] mb-1.5">
                Cluster Base Ingress Domain
              </label>
              <input
                type="text"
                value={clusterDomain}
                onChange={(e) => setClusterDomain(e.target.value)}
                className="w-full bg-[#151921] border border-[#283141] rounded-xl px-3.5 py-2 font-mono text-xs text-white focus:border-[#67df70] focus:outline-none"
              />
              <span className="font-mono text-[10px] text-[#64748B] mt-1 block">
                All auto-discovered HTTPRoutes will resolve under *.{clusterDomain}
              </span>
            </div>

            <div>
              <label className="block font-mono text-xs text-[#94A3B8] mb-1.5">
                Gateway API Controller Class
              </label>
              <select
                value={gatewayClass}
                onChange={(e) => setGatewayClass(e.target.value)}
                className="w-full bg-[#151921] border border-[#283141] rounded-xl px-3.5 py-2 font-mono text-xs text-white focus:border-[#67df70] focus:outline-none"
              >
                <option value="cilium-l7">Cilium eBPF L7 (Default)</option>
                <option value="envoy-gateway">Envoy Gateway Controller</option>
                <option value="traefik-v3">Traefik IngressRoute</option>
                <option value="nginx-ingress">ingress-nginx</option>
              </select>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#1C212B]">
              <div>
                <span className="font-mono text-xs text-white block font-medium">
                  Auto-sync newly deployed HTTPRoutes
                </span>
                <span className="font-mono text-[10px] text-[#64748B]">
                  Automatically append detected services into launchpad
                </span>
              </div>
              <button
                type="button"
                onClick={onToggleAutoSyncRoutes}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoSyncRoutes ? 'bg-[#67df70]' : 'bg-[#283141]'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#0A0C10] shadow ring-0 transition duration-200 ease-in-out ${
                    autoSyncRoutes ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* ArgoCD GitOps Integration Settings */}
        <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-6 shadow-sm">
          <h3 className="font-mono text-xs font-semibold text-[#67df70] uppercase tracking-wider mb-4">
            // ARGOCD GITOPS INTEGRATION
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1C212B]">
              <div>
                <span className="font-mono text-xs text-white block font-medium">
                  Enable ArgoCD Live Sync Badges
                </span>
                <span className="font-mono text-[10px] text-[#64748B]">
                  Displays GitOps sync status and health directly on service cards
                </span>
              </div>
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
            </div>

            <div>
              <label className="block font-mono text-xs text-[#94A3B8] mb-1.5">
                ArgoCD Server Endpoint
              </label>
              <input
                type="text"
                value={argoUrl}
                onChange={(e) => setArgoUrl(e.target.value)}
                className="w-full bg-[#151921] border border-[#283141] rounded-xl px-3.5 py-2 font-mono text-xs text-white focus:border-[#67df70] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Stats & Reset Actions */}
        <div className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs text-[#94A3B8] block">
              Active launchpad: {totalServicesCount} services • {totalRoutesCount} discovered routes
            </span>
            <span className="font-mono text-[10px] text-[#64748B]">
              All data persisted locally in browser state
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onResetToDefaults}
              className="px-3.5 py-2 rounded-xl bg-[#151921] hover:bg-[#1D2026] text-rose-400 border border-rose-500/20 font-mono text-xs transition-colors"
            >
              Reset Services
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[#67df70] hover:bg-[#52c95b] text-[#0A0C10] rounded-xl font-mono text-xs font-semibold shadow-sm transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

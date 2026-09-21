import React from 'react';
import { ServiceItem, ArgoApplication } from '../types';

interface ServiceCardProps {
  service: ServiceItem;
  argoApp?: ArgoApplication;
  showArgoIntegration?: boolean;
  onTogglePin: (id: string, e: React.MouseEvent) => void;
  onLaunch: (service: ServiceItem) => void;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  argoApp,
  showArgoIntegration = true,
  onTogglePin,
  onLaunch,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    // If clicking star or internal button, don't trigger general launch
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    e.preventDefault();
    onLaunch(service);
  };

  // Determine status dot color & label
  const isArgoSynced = argoApp?.syncStatus === 'Synced';
  const isArgoSyncing = argoApp?.syncStatus === 'Syncing';

  let statusLabel = service.status === 'synced' ? 'Synced' : service.status === 'active' ? 'Active' : 'Used';
  if (showArgoIntegration && argoApp) {
    statusLabel = argoApp.syncStatus;
  }

  return (
    <div
      onClick={handleClick}
      className="service-card flex flex-col justify-between p-4 rounded-xl bg-[#0E1117] hover:bg-[#151921] transition-all duration-150 shadow-md group border border-[#1C212B] hover:border-[#67df70]/40 cursor-pointer relative"
    >
      {/* Top row: Icon, Name, Domain, Star Pin */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#191C22] border border-[#283141] flex items-center justify-center text-[#94A3B8] group-hover:text-[#67df70] group-hover:border-[#67df70]/40 transition-colors shrink-0">
            <span className="material-symbols-outlined text-[20px]">
              {service.icon || 'hub'}
            </span>
          </div>

          <div className="min-w-0">
            <h3 className="font-semibold text-[15px] text-white group-hover:text-[#67df70] transition-colors flex items-center gap-1.5 tracking-tight truncate">
              <span>{service.name}</span>
              {service.discoveredFrom === 'httproute' && (
                <span className="text-[9px] font-mono px-1 rounded bg-[#101319] text-[#64748B] border border-[#1C212B] hidden sm:inline-block">
                  HTTPRoute
                </span>
              )}
            </h3>
            <span className="font-mono text-[11px] text-[#64748B] group-hover:text-[#94A3B8] transition-colors block truncate">
              {service.displayUrl}
            </span>
          </div>
        </div>

        {/* Pin / Star Toggle */}
        <button
          type="button"
          onClick={(e) => onTogglePin(service.id, e)}
          className="p-1 text-[#64748B] hover:text-[#67df70] rounded-md transition-colors shrink-0"
          title={service.isPinned ? 'Unpin service' : 'Pin to favorites'}
        >
          <span
            className={`material-symbols-outlined text-[17px] ${
              service.isPinned
                ? 'text-[#67df70] font-fill'
                : 'hover:text-[#67df70]'
            }`}
          >
            {service.isPinned ? 'star' : 'star_border'}
          </span>
        </button>
      </div>

      {/* Description */}
      <p className="text-[13px] text-[#94A3B8] line-clamp-1 mb-3.5">
        {service.description}
      </p>

      {/* Bottom Telemetry & Launch Count */}
      <div className="flex items-center justify-between pt-2.5 border-t border-[#1C212B] font-mono text-[11px] text-[#64748B]">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isArgoSyncing
                ? 'bg-amber-400 animate-ping'
                : isArgoSynced || service.status === 'active' || service.status === 'synced'
                ? 'bg-[#67df70]'
                : 'bg-[#64748B]'
            }`}
          ></span>
          <span className="text-[#94A3B8]">
            {statusLabel} • {service.lastAccessed}
          </span>
          {service.latencyMs !== undefined && (
            <span className="text-[#64748B] hidden sm:inline">
              ({service.latencyMs}ms)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {showArgoIntegration && argoApp && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded bg-[#101319] text-[#67df70] border border-[#67df70]/20 hidden xs:inline"
              title={`ArgoCD App: ${argoApp.name} (${argoApp.healthStatus})`}
            >
              GitOps
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101319] text-[#CBD5E1] border border-[#1C212B]">
            {service.launchesPerWeek} launches/wk
          </span>
        </div>
      </div>
    </div>
  );
};

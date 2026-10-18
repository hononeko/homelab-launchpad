import React from 'react';
import { ServiceItem, ArgoApplication, ServiceHealth } from '../types';

interface ServiceCardProps {
  service: ServiceItem;
  argoApp?: ArgoApplication;
  health?: ServiceHealth;
  showArgoIntegration?: boolean;
  onTogglePin: (id: string, e: React.MouseEvent) => void;
  onLaunch: (service: ServiceItem) => void;
  onHide?: (id: string) => void;
}

interface StatusPresentation {
  label: string;
  dotClass: string;
  textClass: string;
}

const STATUS_LABELS: Record<ServiceItem['status'], string> = {
  synced: 'Synced',
  active: 'Active',
  used: 'Used',
  degraded: 'Degraded',
  offline: 'Offline',
};

function getStatusPresentation(
  status: ServiceItem['status'],
  argoApp: ArgoApplication | undefined,
  showArgoIntegration: boolean
): StatusPresentation {
  // Reachability problems outrank GitOps sync state
  if (status === 'offline') {
    return { label: STATUS_LABELS.offline, dotClass: 'bg-red-500', textClass: 'text-red-400' };
  }
  if (status === 'degraded') {
    return { label: STATUS_LABELS.degraded, dotClass: 'bg-amber-400', textClass: 'text-amber-400' };
  }

  const label = showArgoIntegration && argoApp ? argoApp.syncStatus : STATUS_LABELS[status];
  let dotClass = 'bg-[#64748B]';
  if (argoApp?.syncStatus === 'Syncing') {
    dotClass = 'bg-amber-400 animate-ping';
  } else if (argoApp?.syncStatus === 'Synced' || status === 'active' || status === 'synced') {
    dotClass = 'bg-[#67df70]';
  }
  return { label, dotClass, textClass: 'text-[#94A3B8]' };
}

function formatHealthTitle(health?: ServiceHealth): string | undefined {
  if (!health) return undefined;
  const t = health.timings;
  const detail = t
    ? `HTTP ${health.httpStatus} • DNS ${t.dnsMs ?? '–'}ms • TCP ${t.connectMs ?? '–'}ms • TLS ${t.tlsMs ?? '–'}ms • TTFB ${t.ttfbMs ?? '–'}ms`
    : `Unreachable (${health.error ?? 'unknown error'})`;
  return `${detail}\nChecked ${new Date(health.checkedAt).toLocaleTimeString()}`;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  argoApp,
  health,
  showArgoIntegration = true,
  onTogglePin,
  onLaunch,
  onHide,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    // If clicking star or internal button, don't trigger general launch
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    e.preventDefault();
    onLaunch(service);
  };

  // Live probe results take precedence over the stored service status
  const status = getStatusPresentation(health?.status ?? service.status, argoApp, showArgoIntegration);
  const latencyMs = health ? health.latencyMs : service.latencyMs;

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

        <div className="flex items-center shrink-0">
          {onHide && (
            <button
              type="button"
              onClick={() => onHide(service.id)}
              className="p-1 text-[#64748B] hover:text-[#CBD5E1] rounded-md transition-all sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
              title="Hide from dashboard"
              aria-label={`Hide ${service.name} from dashboard`}
            >
              <span className="material-symbols-outlined text-[17px]">visibility_off</span>
            </button>
          )}

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
      </div>

      {/* Description */}
      <p className="text-[13px] text-[#94A3B8] line-clamp-1 mb-3.5">
        {service.description}
      </p>

      {/* Bottom Telemetry & Launch Count */}
      <div className="flex items-center justify-between pt-2.5 border-t border-[#1C212B] font-mono text-[11px] text-[#64748B]">
        <div className="flex items-center gap-1.5" title={formatHealthTitle(health)}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`}></span>
          <span className={status.textClass}>
            {status.label} • {service.lastAccessed}
          </span>
          {latencyMs !== undefined && latencyMs !== null && (
            <span className="text-[#64748B] hidden sm:inline">
              ({latencyMs}ms)
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

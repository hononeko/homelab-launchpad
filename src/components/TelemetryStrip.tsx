import React from 'react';
import { ClusterTelemetry } from '../types';

interface TelemetryStripProps {
  telemetry: ClusterTelemetry;
  totalServices: number;
  onOpenSearch: () => void;
  onOpenClusterModal: () => void;
}

export const TelemetryStrip: React.FC<TelemetryStripProps> = ({
  telemetry,
  totalServices,
  onOpenSearch,
  onOpenClusterModal,
}) => {
  return (
    <div className="w-full flex flex-col gap-2.5">
      {/* Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 py-2 px-4 rounded-xl bg-[#0E1117]/80 text-[#94A3B8] font-mono text-[11px] border border-[#1C212B] backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenClusterModal}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            title="Gateway cluster status"
          >
            <span className="h-2 w-2 rounded-full bg-[#67df70] animate-pulse"></span>
            <span className="text-white font-medium">GATEWAY: ONLINE</span>
          </button>
          <span className="text-[#283141]">•</span>
          <span>DNS: {telemetry.dns.toUpperCase()}</span>
          <span className="text-[#283141] hidden sm:inline">•</span>
          <span className="hidden sm:inline">INGRESS: {telemetry.cni.toUpperCase()}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[#64748B] hidden xs:inline">{telemetry.statusText}</span>
          <span className="text-[#283141] hidden xs:inline">•</span>
          <span className="text-white font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px] text-[#67df70]">
              bolt
            </span>
            <span>RTT: {telemetry.rttMs}ms</span>
          </span>
        </div>
      </div>
    </div>
  );
};

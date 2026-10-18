import React from 'react';
import { ServiceItem } from '../types';

interface HiddenServicesPanelProps {
  services: ServiceItem[];
  onUnhide: (id: string) => void;
}

/** Services the user hid from the dashboard, each with a way back. */
export const HiddenServicesPanel: React.FC<HiddenServicesPanelProps> = ({ services, onUnhide }) => {
  if (services.length === 0) return null;

  return (
    <details className="group bg-[#0E1117] rounded-2xl border border-[#1C212B]">
      <summary className="flex items-center justify-between gap-3 px-5 py-3 cursor-pointer select-none list-none">
        <span className="flex items-center gap-2 font-mono text-xs text-[#94A3B8]">
          <span className="material-symbols-outlined text-[16px]">visibility_off</span>
          <span>Hidden services ({services.length})</span>
        </span>
        <span className="material-symbols-outlined text-[18px] text-[#64748B] transition-transform group-open:rotate-180">
          expand_more
        </span>
      </summary>

      <ul className="flex flex-col divide-y divide-[#1C212B] border-t border-[#1C212B]">
        {services.map((service) => (
          <li key={service.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <span className="material-symbols-outlined text-[18px] text-[#64748B] shrink-0">
                {service.icon || 'hub'}
              </span>
              <div className="min-w-0">
                <div className="text-sm text-white truncate">{service.name}</div>
                <div className="font-mono text-[11px] text-[#64748B] truncate">{service.displayUrl}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onUnhide(service.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#151921] hover:bg-[#1D2026] border border-[#283141] font-mono text-[11px] text-[#CBD5E1] shrink-0 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">visibility</span>
              <span>Unhide</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
};

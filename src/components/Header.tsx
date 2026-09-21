import React, { useState, useEffect } from 'react';
import { MainView } from '../types';

interface HeaderProps {
  currentView: MainView;
  onViewChange: (view: MainView) => void;
  onOpenSearch: () => void;
  onOpenAutoDiscovery: () => void;
  onOpenClusterModal: () => void;
  pendingRoutesCount: number;
  argoSyncHealth: 'Synced' | 'OutOfSync' | 'Syncing';
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onViewChange,
  onOpenSearch,
  onOpenAutoDiscovery,
  onOpenClusterModal,
  pendingRoutesCount,
  argoSyncHealth,
}) => {
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getUTCHours() + 3).padStart(2, '0'); // UTC+3 as in prototype
      const minutes = String(now.getUTCMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes} UTC+3`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="fixed top-0 inset-x-0 z-40 bg-[#0A0C10]/90 backdrop-blur-xl border-b border-[#1C212B] shadow-[0_1px_12px_rgba(0,0,0,0.5)]">
      <div className="h-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={() => onViewChange('overview')}
            className="flex items-center gap-2 text-left focus:outline-none group"
            title="Kerrlab Homelab Launchpad"
          >
            <div className="h-8 w-8 rounded-lg bg-[#0E1117] border border-[#1C212B] p-1 flex items-center justify-center overflow-hidden group-hover:border-[#67df70]/50 transition-colors">
              <img
                alt="Kerrlab Logo"
                className="h-6 w-auto object-contain"
                src="https://lh3.googleusercontent.com/aida/AEtjO1XrzS6X4beHj6GL_Ab4ZThssdJTHptiBONe-EuVvL3lv3JUs6HrztXn2K9XN_XLaoPeVUgVpCY0hWsuqPs8t9dsn5yYYblv0OZ4PkCORez8sOJtUQahEia8f6SNr7lCD6QH_-IVa6fJ3aVy9gwTaqOQsrj4wUkNaLmIazVsER5lhmC5IBgszagi8omox-Fvt6Xx1UcVDlJLDfdLDiPAwZHj340OOyVR0CIvUqJs-0zxr-Ulx2NCm-2BfpS2"
                referrerPolicy="no-referrer"
              />
            </div>
            <span className="font-semibold text-[16px] tracking-tight text-white group-hover:text-[#67df70] transition-colors">
              Kerrlab
            </span>
          </button>

          <div className="hidden xs:flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#101319] border border-[#1C212B]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#67df70] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#67df70]"></span>
            </span>
            <span className="font-mono text-[11px] text-[#94A3B8]">kerrlab.app</span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1 ml-4 pl-3 border-l border-[#1C212B]">
            <button
              onClick={() => onViewChange('overview')}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                currentView === 'overview'
                  ? 'text-[#67df70] bg-[#67df70]/10 font-medium'
                  : 'text-[#94A3B8] hover:text-white hover:bg-[#151921]'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => onViewChange('services')}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                currentView === 'services'
                  ? 'text-[#67df70] bg-[#67df70]/10 font-medium'
                  : 'text-[#94A3B8] hover:text-white hover:bg-[#151921]'
              }`}
            >
              Services
            </button>
            <button
              onClick={() => onViewChange('gitops')}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all flex items-center gap-1.5 ${
                currentView === 'gitops'
                  ? 'text-[#67df70] bg-[#67df70]/10 font-medium'
                  : 'text-[#94A3B8] hover:text-white hover:bg-[#151921]'
              }`}
            >
              <span>GitOps</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  argoSyncHealth === 'Synced'
                    ? 'bg-[#67df70]'
                    : argoSyncHealth === 'Syncing'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-rose-400'
                }`}
              ></span>
            </button>
            <button
              onClick={onOpenAutoDiscovery}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-[#94A3B8] hover:text-white hover:bg-[#151921] transition-all flex items-center gap-1.5"
              title="Auto-discover Kubernetes HTTPRoutes"
            >
              <span>HTTP Routes</span>
              {pendingRoutesCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#67df70]/20 text-[#67df70] font-mono text-[10px] font-semibold">
                  +{pendingRoutesCount}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Center Search Input Trigger */}
        <div className="flex-1 max-w-md hidden md:flex items-center justify-center">
          <button
            onClick={onOpenSearch}
            type="button"
            className="w-full flex items-center justify-between px-3.5 py-1.5 rounded-lg bg-[#0E1117] hover:bg-[#151921] border border-[#1C212B] hover:border-[#283141] text-[#94A3B8] transition-all group cursor-pointer shadow-inner"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-[#94A3B8] group-hover:text-[#67df70] transition-colors">
                terminal
              </span>
              <span className="font-mono text-[12px] text-[#94A3B8] group-hover:text-[#CBD5E1] transition-colors">
                Search services or press /
              </span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#94A3B8] font-mono text-[10px] group-hover:text-white">
                ⌘K
              </kbd>
              <kbd className="px-1.5 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#94A3B8] font-mono text-[10px] group-hover:text-white">
                /
              </kbd>
            </div>
          </button>
        </div>

        {/* Right Info & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* UTC Clock */}
          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-[#94A3B8] px-2.5 py-1 rounded bg-[#0E1117] border border-[#1C212B]">
            <span className="material-symbols-outlined text-[14px] text-[#64748B]">
              schedule
            </span>
            <span>{currentTime || '15:47 UTC+3'}</span>
          </div>

          {/* Talos Nodes Pill */}
          <button
            onClick={onOpenClusterModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0E1117] hover:bg-[#151921] border border-[#1C212B] hover:border-[#67df70]/40 transition-colors"
            title="View Cluster Nodes & Pod Telemetry"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#67df70] animate-pulse"></span>
            <span className="font-mono text-[11px] text-[#E2E8F0] font-medium">
              Talos • 4 Nodes
            </span>
          </button>

          {/* User / Settings Avatar */}
          <button
            onClick={() => onViewChange('config')}
            aria-label="Settings and Preferences"
            className="w-8 h-8 rounded-full bg-[#67df70] hover:bg-[#52c95b] text-[#0A0C10] flex items-center justify-center font-bold text-xs shadow-sm hover:scale-105 active:scale-95 transition-transform"
            title="Homelab Configuration & Preferences"
          >
            <span className="material-symbols-outlined text-[18px] text-[#0A0C10] font-semibold">
              person
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};

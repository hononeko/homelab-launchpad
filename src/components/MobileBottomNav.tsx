import React from 'react';
import { MainView } from '../types';

interface MobileBottomNavProps {
  currentView: MainView;
  onViewChange: (view: MainView) => void;
  onOpenClusterModal: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentView,
  onViewChange,
  onOpenClusterModal,
}) => {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[#0A0C10]/95 backdrop-blur-xl border-t border-[#1C212B] pb-safe">
      <div className="max-w-md mx-auto grid grid-cols-4 items-center h-14 px-2">
        {/* Tab 1: Services */}
        <button
          onClick={() => onViewChange('overview')}
          className={`flex flex-col items-center justify-center py-1 transition-colors ${
            currentView === 'overview' || currentView === 'services'
              ? 'text-[#67df70]'
              : 'text-[#94A3B8] hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">
            grid_view
          </span>
          <span className="font-mono text-[10px] font-medium mt-0.5 tracking-tight">
            Services
          </span>
        </button>

        {/* Tab 2: Cluster */}
        <button
          onClick={onOpenClusterModal}
          className="flex flex-col items-center justify-center py-1 text-[#94A3B8] hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">
            dns
          </span>
          <span className="font-mono text-[10px] font-medium mt-0.5 tracking-tight">
            Cluster
          </span>
        </button>

        {/* Tab 3: GitOps */}
        <button
          onClick={() => onViewChange('gitops')}
          className={`flex flex-col items-center justify-center py-1 transition-colors ${
            currentView === 'gitops'
              ? 'text-[#67df70]'
              : 'text-[#94A3B8] hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">
            published_with_changes
          </span>
          <span className="font-mono text-[10px] font-medium mt-0.5 tracking-tight">
            GitOps
          </span>
        </button>

        {/* Tab 4: Config */}
        <button
          onClick={() => onViewChange('config')}
          className={`flex flex-col items-center justify-center py-1 transition-colors ${
            currentView === 'config'
              ? 'text-[#67df70]'
              : 'text-[#94A3B8] hover:text-white'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">
            tune
          </span>
          <span className="font-mono text-[10px] font-medium mt-0.5 tracking-tight">
            Config
          </span>
        </button>
      </div>
    </nav>
  );
};

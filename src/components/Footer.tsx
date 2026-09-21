import React from 'react';

interface FooterProps {
  onOpenSearch: () => void;
  onOpenClusterModal: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  onOpenSearch,
  onOpenClusterModal,
}) => {
  return (
    <footer className="w-full bg-[#0A0C10] border-t border-[#1C212B] py-3.5 mt-auto hidden md:block">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left Stack Spec */}
        <div className="flex items-center gap-2 font-mono text-[11px] text-[#94A3B8]">
          <span className="material-symbols-outlined text-[14px] text-[#67df70]">
            dns
          </span>
          <button
            onClick={onOpenClusterModal}
            className="hover:text-white transition-colors"
          >
            Talos Linux
          </button>
          <span className="text-[#283141]">•</span>
          <span>Cilium CNI</span>
          <span className="text-[#283141]">•</span>
          <span>ArgoCD GitOps</span>
          <span className="text-[#283141]">•</span>
          <span>Internal Gateway</span>
        </div>

        {/* Right Shortcuts */}
        <div className="flex items-center gap-4 font-mono text-[11px] text-[#94A3B8]">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-[#151921] border border-[#283141] text-[#CBD5E1] text-[10px]">
              tab
            </kbd>
            <span>navigate</span>
          </span>

          <button
            onClick={onOpenSearch}
            className="flex items-center gap-1.5 hover:text-white transition-colors"
          >
            <kbd className="px-1.5 py-0.5 rounded bg-[#151921] border border-[#283141] text-[#CBD5E1] text-[10px]">
              /
            </kbd>
            <span>search</span>
          </button>

          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-[#151921] border border-[#283141] text-[#CBD5E1] text-[10px]">
              esc
            </kbd>
            <span>clear</span>
          </span>
        </div>
      </div>
    </footer>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { ServiceItem } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceItem[];
  onLaunchService: (service: ServiceItem) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  services,
  onLaunchService,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setCopiedUrl(null);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Filter services
  const filtered = services.filter((s) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.displayUrl.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });

  const bestMatch = filtered[0];
  const relatedServices = filtered.slice(1, 8);
  const totalMatches = filtered.length;

  // Keyboard navigation inside modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[selectedIndex] || bestMatch;
      if (target) {
        onLaunchService(target);
        onClose();
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const target = filtered[selectedIndex] || bestMatch;
      if (target) {
        navigator.clipboard.writeText(target.url);
        setCopiedUrl(target.name);
        setTimeout(() => setCopiedUrl(null), 2000);
      }
    }
  };

  // Helper to highlight matched query in string
  const renderHighlightedText = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;
    const regex = new RegExp(`(${highlight.trim()})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, index) =>
      regex.test(part) ? (
        <span
          key={index}
          className="text-[#67df70] underline decoration-[#67df70]/40 decoration-2 underline-offset-4 font-semibold"
        >
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-[#07090D]/80 backdrop-blur-md transition-opacity duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] rounded-2xl bg-[#0E1117]/95 backdrop-blur-2xl border border-[#283141] shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col transition-all duration-200"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Modal Search Input Header */}
        <div className="flex items-center px-4 sm:px-6 py-3.5 bg-[#07090D]/60 border-b border-[#1C212B] gap-3">
          <span className="material-symbols-outlined text-[20px] text-[#67df70] select-none shrink-0">
            terminal
          </span>

          <div className="flex-1 flex items-center relative font-mono text-[14px]">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search services, DNS routes, pods..."
              className="w-full bg-transparent font-mono text-[14px] text-white placeholder:text-[#64748B] focus:outline-none focus:ring-0"
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <span className="w-[6px] h-[18px] bg-[#67df70] animate-pulse inline-block ml-1 shrink-0"></span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {copiedUrl && (
              <span className="text-[11px] font-mono text-[#67df70] bg-[#67df70]/10 px-2 py-0.5 rounded border border-[#67df70]/30 animate-fade-in">
                Copied {copiedUrl}!
              </span>
            )}
            <button
              onClick={onClose}
              className="font-mono text-[10px] text-[#94A3B8] px-2 py-1 rounded bg-[#191C22] border border-[#283141] hover:text-white select-none transition-colors"
            >
              ESC
            </button>
          </div>
        </div>

        {/* Results List */}
        <div className="px-3 sm:px-4 py-2 flex flex-col gap-1 max-h-[440px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-12 text-center flex flex-col items-center justify-center text-[#64748B]">
              <span className="material-symbols-outlined text-[32px] mb-2 text-[#475569]">
                search_off
              </span>
              <p className="font-mono text-[13px] text-[#94A3B8]">
                No matching services for "{query}"
              </p>
              <p className="font-mono text-[11px] text-[#64748B] mt-1">
                Try searching by service name, category, or domain
              </p>
            </div>
          ) : (
            <>
              {/* Best Match Section */}
              {bestMatch && (
                <div>
                  <div className="px-2 pt-1 pb-1 font-mono text-[10px] text-[#94A3B8] flex items-center justify-between select-none">
                    <span className="tracking-wider">// BEST MATCH</span>
                    <span>INDEX: 001</span>
                  </div>

                  <div
                    onClick={() => {
                      onLaunchService(bestMatch);
                      onClose();
                    }}
                    className={`group flex items-center justify-between p-2.5 sm:p-3 rounded-xl cursor-pointer transition-all duration-150 relative ${
                      selectedIndex === 0
                        ? 'bg-[#1D2026] text-white ring-1 ring-[#67df70]/50 shadow-md'
                        : 'bg-[#151921]/90 hover:bg-[#1D2026] text-[#CBD5E1]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[#07090D] border border-[#283141] flex items-center justify-center text-[#67df70] shrink-0">
                        <span className="material-symbols-outlined text-[18px]">
                          {bestMatch.icon || 'hub'}
                        </span>
                      </div>
                      <div className="min-w-0 flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[14px] text-white tracking-tight">
                            {renderHighlightedText(bestMatch.name, query)}
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#67df70] shrink-0"></span>
                        </div>
                        <span className="text-[11px] text-[#94A3B8] truncate font-mono">
                          {bestMatch.description} • {bestMatch.displayUrl}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pl-2">
                      <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-[#0E1117] font-mono text-[10px] text-[#94A3B8] border border-[#283141]">
                        // {bestMatch.category}
                      </span>
                      <div className="flex items-center gap-1 font-mono text-[11px] text-[#0A0C10] bg-[#67df70] hover:bg-[#52c95b] px-2 py-1 rounded shadow-sm font-medium">
                        <span>↵</span>
                        <span>open</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Related Services Section */}
              {relatedServices.length > 0 && (
                <div className="pt-2">
                  <div className="px-2 pt-1 pb-1 font-mono text-[10px] text-[#94A3B8] flex items-center justify-between select-none">
                    <span className="tracking-wider">// RELATED SERVICES</span>
                    <span>{relatedServices.length} OTHERS</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    {relatedServices.map((service, idx) => {
                      const itemIndex = idx + 1;
                      const isSelected = selectedIndex === itemIndex;
                      const indexFormatted = String(itemIndex + 1).padStart(2, '0');

                      return (
                        <div
                          key={service.id}
                          onClick={() => {
                            onLaunchService(service);
                            onClose();
                          }}
                          className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors duration-100 ${
                            isSelected
                              ? 'bg-[#1D2026] text-white ring-1 ring-[#67df70]/40'
                              : 'hover:bg-[#151921] text-[#CBD5E1]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-[#151921] border border-[#283141] flex items-center justify-center text-[#94A3B8] group-hover:text-[#67df70] shrink-0">
                              <span className="material-symbols-outlined text-[18px]">
                                {service.icon || 'circle'}
                              </span>
                            </div>
                            <div className="min-w-0 flex flex-col">
                              <span className="text-[13px] text-white font-medium tracking-tight truncate">
                                {renderHighlightedText(service.name, query)}
                              </span>
                              <span className="text-[11px] text-[#94A3B8] truncate font-mono">
                                {service.description} • {service.displayUrl}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 pl-2">
                            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-[#0E1117] font-mono text-[10px] text-[#94A3B8] border border-[#1C212B]">
                              // {service.category}
                            </span>
                            <span className="font-mono text-[10px] text-[#64748B] px-1">
                              {indexFormatted}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Keybinding Footer */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#07090D]/80 border-t border-[#1C212B] flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-[11px] text-[#94A3B8]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#67df70]"></span>
            <span>{totalMatches} matching services</span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[10px] text-[#64748B]">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#CBD5E1]">
                ↑
              </kbd>
              <kbd className="px-1 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#CBD5E1]">
                ↓
              </kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#CBD5E1]">
                ↵
              </kbd>
              <span>launch</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#CBD5E1]">
                tab
              </kbd>
              <span>copy url</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#CBD5E1]">
                esc
              </kbd>
              <span>dismiss</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

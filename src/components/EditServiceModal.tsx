import React, { useId, useMemo, useState } from 'react';
import { ServiceIdentity, ServiceItem } from '../types';
import { ALL_ICONS, ICON_GROUPS, ICON_NAME_PATTERN, IconGroupLabel } from '../data/iconCatalog';

interface EditServiceModalProps {
  service: ServiceItem;
  onSave: (id: string, identity: ServiceIdentity) => void;
  onClose: () => void;
}

const MAX_NAME_LENGTH = 100;

/** Rename a service card and pick its icon, with a live preview and a way back to the defaults. */
export const EditServiceModal: React.FC<EditServiceModalProps> = ({ service, onSave, onClose }) => {
  const titleId = useId();
  const [name, setName] = useState(service.name);
  const [icon, setIcon] = useState(service.icon);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<IconGroupLabel | 'All'>('All');

  const defaults = service.original ?? { name: service.name, icon: service.icon };
  const trimmedName = name.trim();
  const isAtDefaults = trimmedName === defaults.name && icon === defaults.icon;

  const icons = useMemo(() => {
    const typed = query.trim().toLowerCase().replaceAll(' ', '_');
    const pool = group === 'All' ? ALL_ICONS : (ICON_GROUPS.find((g) => g.label === group)?.icons ?? []);
    const matches = pool.filter((candidate) => candidate.includes(typed));
    // Any Material Symbol works, so a typed name outside the catalog is offered as-is
    return ICON_NAME_PATTERN.test(typed) && !ALL_ICONS.includes(typed) ? [typed, ...matches] : matches;
  }, [query, group]);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!trimmedName) return;
    onSave(service.id, { name: trimmedName, icon });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  const handleReset = () => {
    setName(defaults.name);
    setIcon(defaults.icon);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07090D]/85 backdrop-blur-md"
      onClick={(e) => {
        // Only a click on the backdrop itself closes the dialog
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-2xl bg-[#0E1117] border border-[#283141] shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 bg-[#0A0C10] border-b border-[#1C212B]">
          <h2 id={titleId} className="text-base font-semibold text-white tracking-tight">
            Edit service
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-[#94A3B8] hover:text-white flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-5 overflow-y-auto scrollbar-subtle space-y-5">
          {/* Live preview */}
          <div
            data-testid="service-preview"
            className="flex items-center gap-3 p-3 rounded-xl bg-[#151921] border border-[#1C212B]"
          >
            <div className="w-9 h-9 rounded-lg bg-[#191C22] border border-[#67df70]/40 flex items-center justify-center text-[#67df70] shrink-0">
              <span className="material-symbols-outlined text-[20px]">{icon || 'hub'}</span>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[15px] text-white truncate">{trimmedName || 'Untitled'}</div>
              <div className="font-mono text-[11px] text-[#64748B] truncate">{service.displayUrl}</div>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="font-mono text-[11px] text-[#94A3B8]">DISPLAY NAME</span>
            <input
              autoFocus
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#283141] focus:border-[#67df70]/60 outline-none text-sm text-white"
            />
            {service.original && (
              <span className="block font-mono text-[11px] text-[#64748B]">
                Originally {service.original.name}
              </span>
            )}
          </label>

          <div className="space-y-2">
            <span className="block font-mono text-[11px] text-[#94A3B8]">ICON</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search icons, or type any Material Symbol name"
              aria-label="Search icons"
              className="w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#283141] focus:border-[#67df70]/60 outline-none text-sm text-white placeholder:text-[#64748B]"
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icon categories">
              {(['All', ...ICON_GROUPS.map((g) => g.label)] as const).map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={group === label}
                  onClick={() => setGroup(label)}
                  className={`px-2.5 py-1 rounded-md font-mono text-[11px] border transition-colors ${
                    group === label
                      ? 'bg-[#67df70]/10 border-[#67df70]/40 text-[#67df70]'
                      : 'bg-[#151921] border-[#283141] text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {icons.length === 0 ? (
              <p className="py-4 text-center font-mono text-[11px] text-[#64748B]">No icons match</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5 max-h-48 overflow-y-auto scrollbar-subtle pr-1">
                {icons.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    title={candidate}
                    aria-label={candidate}
                    aria-pressed={icon === candidate}
                    onClick={() => setIcon(candidate)}
                    className={`h-11 rounded-lg border flex items-center justify-center transition-colors ${
                      icon === candidate
                        ? 'bg-[#67df70]/10 border-[#67df70]/60 text-[#67df70]'
                        : 'bg-[#151921] border-[#1C212B] text-[#94A3B8] hover:text-white hover:border-[#283141]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">{candidate}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 bg-[#0A0C10] border-t border-[#1C212B]">
          <button
            type="button"
            onClick={handleReset}
            disabled={isAtDefaults}
            className="px-3 py-1.5 rounded-lg font-mono text-[11px] text-[#94A3B8] hover:text-white disabled:opacity-40 disabled:hover:text-[#94A3B8] transition-colors"
          >
            Reset to defaults
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] border border-[#283141] text-sm text-[#CBD5E1] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!trimmedName}
              className="px-3 py-1.5 rounded-lg bg-[#67df70] hover:bg-[#7ee886] text-sm font-medium text-[#07090D] disabled:opacity-40 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

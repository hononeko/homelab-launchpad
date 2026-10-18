import React, { useEffect, useId, useRef, useState } from 'react';
import { DiscoveredHTTPRoute, RouteOverride, SERVICE_CATEGORIES, ServiceCategory } from '../types';
import { IconPicker } from './IconPicker';

interface RouteOverrideModalProps {
  route: DiscoveredHTTPRoute;
  // Resolves to whether the change was saved; null removes the override
  onSave: (host: string, override: RouteOverride | null) => Promise<boolean>;
  onClose: () => void;
}

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#283141] focus:border-[#67df70]/60 outline-none text-sm text-white';

/** Sets the name, category and icon every administrator sees for one discovered host. */
export const RouteOverrideModal: React.FC<RouteOverrideModalProps> = ({ route, onSave, onClose }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(route.name);
  const [category, setCategory] = useState<ServiceCategory>(route.suggestedCategory);
  const [icon, setIcon] = useState(route.suggestedIcon);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const save = async (override: RouteOverride | null) => {
    setSaving(true);
    const saved = await onSave(route.host, override);
    setSaving(false);
    if (saved) onClose();
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) void save({ name: trimmed, category, icon });
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[90vh] p-0 open:flex flex-col rounded-2xl bg-[#0E1117] border border-[#283141] shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden backdrop:bg-[#07090D]/70"
    >
      <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
        <div className="px-5 py-4 bg-[#0A0C10] border-b border-[#1C212B]">
          <h2 id={titleId} className="text-base font-semibold text-white tracking-tight">
            Route defaults
          </h2>
          <p className="font-mono text-[11px] text-[#64748B] mt-0.5 wrap-anywhere">
            {route.host}: used whenever anyone imports this route
          </p>
        </div>

        <div className="p-5 min-h-0 overflow-y-auto scrollbar-subtle space-y-4">
          <label className="block space-y-1.5">
            <span className="font-mono text-[11px] text-[#94A3B8]">NAME</span>
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="font-mono text-[11px] text-[#94A3B8]">CATEGORY</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ServiceCategory)}
              className={inputClass}
            >
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1.5">
            <span className="block font-mono text-[11px] text-[#94A3B8]">ICON</span>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 bg-[#0A0C10] border-t border-[#1C212B]">
          {route.override ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(null)}
              className="px-3 py-1.5 rounded-lg font-mono text-[11px] text-rose-400 hover:text-rose-300 disabled:opacity-40 transition-colors"
            >
              Remove override
            </button>
          ) : (
            <span />
          )}
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
              disabled={saving || !name.trim()}
              className="px-3 py-1.5 rounded-lg bg-[#67df70] hover:bg-[#7ee886] text-sm font-medium text-[#07090D] disabled:opacity-40 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
};

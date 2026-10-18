import React, { useEffect, useId, useRef, useState } from 'react';
import { ServiceIdentity, ServiceItem } from '../types';
import { IconPicker } from './IconPicker';

interface EditServiceModalProps {
  service: ServiceItem;
  onSave: (id: string, identity: ServiceIdentity) => void;
  onClose: () => void;
}

const MAX_NAME_LENGTH = 100;

/** Rename a service card and pick its icon, with a live preview and a way back to the defaults. */
export const EditServiceModal: React.FC<EditServiceModalProps> = ({ service, onSave, onClose }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(service.name);
  const [icon, setIcon] = useState(service.icon);

  const defaults = service.original ?? { name: service.name, icon: service.icon };
  const trimmedName = name.trim();
  const isAtDefaults = trimmedName === defaults.name && icon === defaults.icon;

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!trimmedName) return;
    onSave(service.id, { name: trimmedName, icon });
  };

  // Opened as a modal so the browser handles the backdrop, focus trapping and Escape
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    nameRef.current?.focus();
  }, []);

  const handleCancel = (e: React.SyntheticEvent) => {
    // Escape: let React unmount the dialog instead of the browser closing it
    e.preventDefault();
    onClose();
  };

  const handleReset = () => {
    setName(defaults.name);
    setIcon(defaults.icon);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[90vh] p-0 open:flex flex-col rounded-2xl bg-[#0E1117] border border-[#283141] shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden backdrop:bg-[#07090D]/85 backdrop:backdrop-blur-md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
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

        <div className="p-5 min-h-0 overflow-y-auto scrollbar-subtle space-y-5">
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
              ref={nameRef}
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
            <IconPicker value={icon} onChange={setIcon} />
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
    </dialog>
  );
};

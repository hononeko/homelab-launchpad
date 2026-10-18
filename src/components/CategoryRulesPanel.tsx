import React, { useEffect, useMemo, useState } from 'react';
import { CategoryMappings, RouteOverride, SERVICE_CATEGORIES, ServiceCategory } from '../types';
import { IconPicker } from './IconPicker';

interface DraftRow {
  key: number;
  // Comma-separated keywords, or the namespace name
  match: string;
  category: ServiceCategory;
  icon: string;
}

interface Draft {
  rules: DraftRow[];
  namespaces: DraftRow[];
  overrides: Record<string, RouteOverride>;
}

let nextKey = 0;
const row = (match: string, category: ServiceCategory, icon: string): DraftRow => ({ key: nextKey++, match, category, icon });

function toDraft(mappings: CategoryMappings): Draft {
  return {
    rules: mappings.appRules.map((r) => row(r.keywords.join(', '), r.category, r.icon)),
    namespaces: Object.entries(mappings.namespaceRules).map(([ns, r]) => row(ns, r.category, r.icon)),
    overrides: mappings.overrides,
  };
}

const splitKeywords = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);

function fromDraft(draft: Draft): CategoryMappings {
  return {
    appRules: draft.rules.map((r) => ({ keywords: splitKeywords(r.match), category: r.category, icon: r.icon })),
    namespaceRules: Object.fromEntries(
      draft.namespaces.map((r) => [r.match.trim().toLowerCase(), { category: r.category, icon: r.icon }])
    ),
    overrides: draft.overrides,
  };
}

/** The first problem that would make the server reject the draft, in words an editor can act on. */
function draftProblem(draft: Draft): string | null {
  const emptyRule = draft.rules.findIndex((r) => splitKeywords(r.match).length === 0);
  if (emptyRule >= 0) return `Keyword rule ${emptyRule + 1} has no keywords`;
  const names = draft.namespaces.map((r) => r.match.trim().toLowerCase());
  if (names.some((n) => !n)) return 'A namespace rule has no namespace';
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  return duplicate ? `Namespace ${duplicate} is listed twice` : null;
}

function describeOverride(override: RouteOverride): string {
  return [override.name, override.category, override.icon].filter(Boolean).join(' · ');
}

const fieldClass =
  'px-2.5 py-1.5 rounded-lg bg-[#0A0C10] border border-[#283141] focus:border-[#67df70]/60 outline-none font-mono text-xs text-white';
const iconButtonClass = 'p-1 rounded text-[#64748B] hover:text-[#CBD5E1] disabled:opacity-30 transition-colors';
const moveButtonClass = 'px-1 rounded text-[#64748B] hover:text-[#CBD5E1] disabled:opacity-30 transition-colors';

interface RuleRowProps {
  label: string;
  matchLabel: string;
  placeholder: string;
  row: DraftRow;
  picking: boolean;
  onChange: (row: DraftRow) => void;
  onTogglePicker: () => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

const RuleRow: React.FC<RuleRowProps> = ({
  label,
  matchLabel,
  placeholder,
  row: current,
  picking,
  onChange,
  onTogglePicker,
  onRemove,
  onMoveUp,
  onMoveDown,
}) => (
  <li className="flex flex-wrap items-center gap-2 py-2">
    {(onMoveUp || onMoveDown) && (
      <div className="flex flex-col">
        <button type="button" onClick={onMoveUp} disabled={!onMoveUp} aria-label={`Move ${label} up`} className={moveButtonClass}>
          <span className="material-symbols-outlined text-[14px] leading-none">keyboard_arrow_up</span>
        </button>
        <button type="button" onClick={onMoveDown} disabled={!onMoveDown} aria-label={`Move ${label} down`} className={moveButtonClass}>
          <span className="material-symbols-outlined text-[14px] leading-none">keyboard_arrow_down</span>
        </button>
      </div>
    )}
    <input
      value={current.match}
      placeholder={placeholder}
      aria-label={`${matchLabel} for ${label}`}
      onChange={(e) => onChange({ ...current, match: e.target.value })}
      className={`${fieldClass} flex-[1_1_12rem] min-w-0`}
    />
    <select
      value={current.category}
      aria-label={`Category for ${label}`}
      onChange={(e) => onChange({ ...current, category: e.target.value as ServiceCategory })}
      className={fieldClass}
    >
      {SERVICE_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
    <button
      type="button"
      onClick={onTogglePicker}
      aria-expanded={picking}
      aria-label={`Icon for ${label}: ${current.icon}`}
      title={current.icon}
      className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
        picking ? 'border-[#67df70]/60 text-[#67df70]' : 'border-[#283141] text-[#94A3B8] hover:text-white'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{current.icon}</span>
    </button>
    <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className={iconButtonClass}>
      <span className="material-symbols-outlined text-[16px]">delete</span>
    </button>
    {picking && (
      <div className="basis-full">
        <IconPicker
          value={current.icon}
          onChange={(icon) => {
            onChange({ ...current, icon });
            onTogglePicker();
          }}
        />
      </div>
    )}
  </li>
);

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Administrator editor for the rules that suggest a category and icon for discovered routes. */
export const CategoryRulesPanel: React.FC = () => {
  const [saved, setSaved] = useState<CategoryMappings | null>(null);
  const [customized, setCustomized] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const accept = (data: { mappings: CategoryMappings; customized: boolean }) => {
    setSaved(data.mappings);
    setCustomized(data.customized);
    setDraft(toDraft(data.mappings));
    setPicking(null);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config/mappings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.success && data.mappings) accept(data);
        else setLoadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const candidate = useMemo(() => (draft ? fromDraft(draft) : null), [draft]);
  const dirty = Boolean(saved && candidate && JSON.stringify(saved) !== JSON.stringify(candidate));
  const problem = draft ? draftProblem(draft) : null;

  const send = async (path: string, init: RequestInit, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.mappings) {
        accept(data);
        setMessage(done);
      } else {
        const reason = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
        setMessage(`Could not save: ${reason}`);
      }
    } catch {
      setMessage('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () =>
    send(
      '/api/config/mappings',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(candidate) },
      'Saved. Discovered routes were re-classified.'
    );

  const handleReset = () => {
    if (!window.confirm('Replace every rule and route override with the built-in defaults?')) return;
    void send('/api/config/mappings/reset', { method: 'POST' }, 'Restored the default rules.');
  };

  const updateRows = (list: 'rules' | 'namespaces', rows: DraftRow[]) =>
    setDraft((prev) => (prev ? { ...prev, [list]: rows } : prev));

  if (!draft) {
    return (
      <section className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-6 font-mono text-xs text-[#64748B]">
        {loadFailed ? 'Could not load the category rules.' : 'Loading category rules…'}
      </section>
    );
  }

  const renderRows = (list: 'rules' | 'namespaces') => {
    const rows = draft[list];
    const isRules = list === 'rules';
    return rows.map((current, index) => (
      <RuleRow
        key={current.key}
        label={isRules ? `keyword rule ${index + 1}` : `namespace rule ${index + 1}`}
        matchLabel={isRules ? 'Keywords' : 'Namespace'}
        placeholder={isRules ? 'plex, jellyfin' : 'media'}
        row={current}
        picking={picking === current.key}
        onChange={(next) => updateRows(list, rows.map((r) => (r.key === next.key ? next : r)))}
        onTogglePicker={() => setPicking((p) => (p === current.key ? null : current.key))}
        onRemove={() => updateRows(list, rows.filter((r) => r.key !== current.key))}
        onMoveUp={isRules && index > 0 ? () => updateRows(list, move(rows, index, index - 1)) : undefined}
        onMoveDown={isRules && index < rows.length - 1 ? () => updateRows(list, move(rows, index, index + 1)) : undefined}
      />
    ));
  };

  const overrideHosts = Object.keys(draft.overrides).sort((a, b) => a.localeCompare(b));
  const summaryClass = 'flex items-center justify-between cursor-pointer select-none font-mono text-xs text-white py-2';
  const addClass =
    'mt-1 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#151921] hover:bg-[#1D2026] border border-[#283141] font-mono text-[11px] text-[#CBD5E1]';

  return (
    <section className="bg-[#0E1117] border border-[#1C212B] rounded-2xl p-6 shadow-sm space-y-3">
      <div>
        <h3 className="font-mono text-xs font-semibold text-[#67df70] uppercase tracking-wider">{'// CATEGORY & ICON RULES'}</h3>
        <p className="font-mono text-[10px] text-[#64748B] mt-1">
          Suggested category and icon for discovered routes. Keyword rules are tried top to bottom against the route
          name, namespace, host and backend; then the route&apos;s namespace. {customized ? 'Customized.' : 'Using the built-in defaults.'}
        </p>
      </div>

      <details className="border-t border-[#1C212B] pt-1">
        <summary className={summaryClass}>Keyword rules ({draft.rules.length})</summary>
        <ul className="divide-y divide-[#1C212B]">{renderRows('rules')}</ul>
        <button type="button" onClick={() => updateRows('rules', [...draft.rules, row('', 'TOOLS & DEV', 'hub')])} className={addClass}>
          <span className="material-symbols-outlined text-[14px]">add</span>
          <span>Add keyword rule</span>
        </button>
      </details>

      <details className="border-t border-[#1C212B] pt-1">
        <summary className={summaryClass}>Namespace rules ({draft.namespaces.length})</summary>
        <ul className="divide-y divide-[#1C212B]">{renderRows('namespaces')}</ul>
        <button
          type="button"
          onClick={() => updateRows('namespaces', [...draft.namespaces, row('', 'TOOLS & DEV', 'hub')])}
          className={addClass}
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          <span>Add namespace rule</span>
        </button>
      </details>

      <details className="border-t border-[#1C212B] pt-1">
        <summary className={summaryClass}>Route overrides ({overrideHosts.length})</summary>
        {overrideHosts.length === 0 ? (
          <p className="font-mono text-[11px] text-[#64748B] pb-2">
            None yet. Use the adjust button next to a route in the discovery dialog.
          </p>
        ) : (
          <ul className="divide-y divide-[#1C212B]">
            {overrideHosts.map((host) => (
              <li key={host} className="flex items-center justify-between gap-3 py-2 font-mono text-[11px]">
                <span className="min-w-0">
                  <span className="block text-[#67df70] wrap-anywhere">{host}</span>
                  <span className="block text-[#94A3B8]">{describeOverride(draft.overrides[host])}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove the override for ${host}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      overrides: Object.fromEntries(Object.entries(draft.overrides).filter(([h]) => h !== host)),
                    })
                  }
                  className={iconButtonClass}
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#1C212B]">
        <output className="font-mono text-[10px] text-[#94A3B8]">{problem && dirty ? problem : message}</output>
        <div className="flex items-center gap-2 ml-auto">
          {customized && (
            <button
              type="button"
              disabled={busy}
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg font-mono text-[11px] text-rose-400 hover:text-rose-300 disabled:opacity-40"
            >
              Reset to defaults
            </button>
          )}
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => saved && setDraft(toDraft(saved))}
            className="px-3 py-1.5 rounded-lg bg-[#151921] hover:bg-[#1D2026] border border-[#283141] font-mono text-[11px] text-[#CBD5E1] disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={busy || !dirty || problem !== null}
            onClick={() => void handleSave()}
            className="px-3 py-1.5 rounded-lg bg-[#67df70] hover:bg-[#52c95b] font-mono text-[11px] font-semibold text-[#0A0C10] disabled:opacity-40"
          >
            Save rules
          </button>
        </div>
      </div>
    </section>
  );
};

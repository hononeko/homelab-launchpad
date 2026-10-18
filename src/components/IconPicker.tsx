import React, { useMemo, useState } from 'react';
import { ALL_ICONS, ICON_GROUPS, ICON_NAME_PATTERN, IconGroupLabel } from '../data/iconCatalog';

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

/** Searchable Material Symbols grid, grouped by category. */
export const IconPicker: React.FC<IconPickerProps> = ({ value, onChange }) => {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<IconGroupLabel | 'All'>('All');

  const icons = useMemo(() => {
    const typed = query.trim().toLowerCase().replaceAll(' ', '_');
    const pool = group === 'All' ? ALL_ICONS : (ICON_GROUPS.find((g) => g.label === group)?.icons ?? []);
    const matches = pool.filter((candidate) => candidate.includes(typed));
    // Any Material Symbol works, so a typed name outside the catalog is offered as-is
    return ICON_NAME_PATTERN.test(typed) && !ALL_ICONS.includes(typed) ? [typed, ...matches] : matches;
  }, [query, group]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons, or type any Material Symbol name"
        aria-label="Search icons"
        className="w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#283141] focus:border-[#67df70]/60 outline-none text-sm text-white placeholder:text-[#64748B]"
      />
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">Icon categories</legend>
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
      </fieldset>
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
              aria-pressed={value === candidate}
              onClick={() => onChange(candidate)}
              className={`h-11 rounded-lg border flex items-center justify-center transition-colors ${
                value === candidate
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
  );
};

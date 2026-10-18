import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SERVICE_CATEGORIES, ServiceCategory, ServiceItem } from '../types';
import { RankedField, RankedItem, rankByFuzzy } from '../lib/fuzzy';

// Rendered results; the list scrolls to keep the keyboard selection in view
const MAX_VISIBLE_RESULTS = 30;
const COMMAND_PREFIX = '>';

/** An action the palette can run in command mode (query starting with ">"). */
export interface PaletteCommand {
  id: string;
  title: string;
  icon: string;
  keywords?: string[];
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceItem[];
  onLaunchService: (service: ServiceItem) => void;
  commands?: PaletteCommand[];
}

// Name matches count most, then the address, category and description
const SERVICE_FIELDS: RankedField<ServiceItem>[] = [
  { get: (s) => s.name, weight: 4 },
  { get: (s) => s.displayUrl, weight: 2 },
  { get: (s) => s.category, weight: 1.5 },
  { get: (s) => s.description, weight: 1 },
];

const COMMAND_FIELDS: RankedField<PaletteCommand>[] = [
  { get: (c) => c.title, weight: 2 },
  { get: (c) => (c.keywords ?? []).join(' '), weight: 1 },
];

type Feedback = { tone: 'ok' | 'error'; text: string } | null;

/** Renders text with the matched character positions emphasized. */
function Highlighted({ text, indices }: Readonly<{ text: string; indices: number[] }>) {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  // Runs of matched or unmatched characters, keyed by where they start
  const parts: Array<{ start: number; text: string; match: boolean }> = [];
  for (const [i, char] of Array.from(text).entries()) {
    const match = marked.has(i);
    const last = parts.at(-1);
    if (last?.match === match) last.text += char;
    else parts.push({ start: i, text: char, match });
  }
  return (
    <>
      {parts.map((part) =>
        part.match ? (
          <mark
            key={part.start}
            className="bg-transparent text-[#67df70] underline decoration-[#67df70]/40 decoration-2 underline-offset-4 font-semibold"
          >
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={part.start}>{part.text}</React.Fragment>
        )
      )}
    </>
  );
}

interface RowProps {
  selected: boolean;
  icon: string;
  onClick: () => void;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}

const ResultRow: React.FC<RowProps> = ({ selected, icon, onClick, children, trailing }) => (
  <button
    type="button"
    // Rows are clicked with the mouse; the keyboard stays in the search field
    tabIndex={-1}
    data-selected={selected}
    onClick={onClick}
    className={`w-full text-left flex items-center justify-between p-2 rounded-xl transition-colors duration-100 group ${
      selected ? 'bg-[#1D2026] text-white ring-1 ring-[#67df70]/40' : 'hover:bg-[#151921] text-[#CBD5E1]'
    }`}
  >
    <span className="flex items-center gap-3 min-w-0">
      <span
        className={`w-8 h-8 rounded-lg border border-[#283141] flex items-center justify-center shrink-0 ${
          selected ? 'bg-[#07090D] text-[#67df70]' : 'bg-[#151921] text-[#94A3B8] group-hover:text-[#67df70]'
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      </span>
      <span className="min-w-0 flex flex-col">{children}</span>
    </span>
    {trailing}
  </button>
);

function SectionHeading({ label, detail }: Readonly<{ label: string; detail?: string }>) {
  return (
    <div className="px-2 pt-2 pb-1 font-mono text-[10px] text-[#94A3B8] flex items-center justify-between select-none">
      <span className="tracking-wider">{label}</span>
      {detail && <span>{detail}</span>}
    </div>
  );
}

const kbdClass = 'px-1.5 py-0.5 rounded bg-[#191C22] border border-[#283141] text-[#CBD5E1]';

function Hint({ keys, label }: Readonly<{ keys: string[]; label: string }>) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key) => (
        <kbd key={key} className={kbdClass}>
          {key}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

interface CategoryFiltersProps {
  categories: ServiceCategory[];
  value: ServiceCategory | null;
  onChange: (category: ServiceCategory | null) => void;
}

function CategoryFilters({ categories, value, onChange }: Readonly<CategoryFiltersProps>) {
  return (
    <fieldset className="flex flex-wrap gap-1.5 px-4 sm:px-6 py-2 border-b border-[#1C212B]">
      <legend className="sr-only">Filter by category</legend>
      {[null, ...categories].map((option) => (
        <button
          key={option ?? 'all'}
          type="button"
          tabIndex={-1}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`px-2 py-0.5 rounded-md font-mono text-[10px] border transition-colors ${
            value === option
              ? 'bg-[#67df70]/10 border-[#67df70]/40 text-[#67df70]'
              : 'bg-[#151921] border-[#283141] text-[#94A3B8] hover:text-white'
          }`}
        >
          {option ?? 'ALL'}
        </button>
      ))}
    </fieldset>
  );
}

interface EmptyResultsProps {
  commandMode: boolean;
  search: string;
  category: ServiceCategory | null;
}

function EmptyResults({ commandMode, search, category }: Readonly<EmptyResultsProps>) {
  const scope = category ? ` in ${category}` : '';
  const message = commandMode
    ? `No commands match "${search.trim()}"`
    : `No matching services for "${search.trim()}"${scope}`;
  return (
    <div className="py-12 text-center flex flex-col items-center justify-center">
      <span className="material-symbols-outlined text-[32px] mb-2 text-[#475569]">search_off</span>
      <p className="font-mono text-[13px] text-[#94A3B8]">{message}</p>
      <p className="font-mono text-[11px] text-[#64748B] mt-1">
        {commandMode ? 'Delete the > to search services' : 'Type > to run a command instead'}
      </p>
    </div>
  );
}

interface FooterProps {
  count: number;
  commandMode: boolean;
  hasCategories: boolean;
}

function PaletteFooter({ count, commandMode, hasCategories }: Readonly<FooterProps>) {
  return (
    <div className="px-4 sm:px-6 py-2.5 bg-[#07090D]/80 border-t border-[#1C212B] flex flex-col sm:flex-row items-center justify-between gap-2">
      <div className="flex items-center gap-2 font-mono text-[11px] text-[#94A3B8]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#67df70]"></span>
        <span>
          {count} {commandMode ? 'matching commands' : 'matching services'}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-[10px] text-[#64748B]">
        <Hint keys={['↑', '↓']} label="navigate" />
        <Hint keys={['↵']} label={commandMode ? 'run' : 'launch'} />
        {!commandMode && <Hint keys={['⇧', '↵']} label="copy url" />}
        {!commandMode && hasCategories && <Hint keys={['tab']} label="category" />}
        <Hint keys={['esc']} label="dismiss" />
      </div>
    </div>
  );
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  services,
  onLaunchService,
  commands = [],
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedIndex(0);
    setCategory(null);
    setFeedback(null);
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
  }, [isOpen]);

  const commandMode = query.trimStart().startsWith(COMMAND_PREFIX);
  const search = commandMode ? query.trimStart().slice(COMMAND_PREFIX.length) : query;

  // Only categories that have services are offered as filters
  const categories = useMemo(
    () => SERVICE_CATEGORIES.filter((c) => services.some((s) => s.category === c)),
    [services]
  );

  const serviceResults = useMemo(() => {
    const pool = category ? services.filter((s) => s.category === category) : services;
    return rankByFuzzy(search, pool, SERVICE_FIELDS);
  }, [search, services, category]);

  const commandResults = useMemo(() => rankByFuzzy(search, commands, COMMAND_FIELDS), [search, commands]);

  const results: Array<RankedItem<ServiceItem> | RankedItem<PaletteCommand>> = commandMode
    ? commandResults
    : serviceResults;
  const visible = results.slice(0, MAX_VISIBLE_RESULTS);
  const selected = Math.min(selectedIndex, Math.max(visible.length - 1, 0));

  // Keep the keyboard selection on screen
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, query, category]);

  if (!isOpen) return null;

  const launch = (service: ServiceItem) => {
    onLaunchService(service);
    onClose();
  };

  const run = (command: PaletteCommand) => {
    onClose();
    command.run();
  };

  const copyUrl = async (service: ServiceItem) => {
    try {
      await navigator.clipboard.writeText(service.url);
      setFeedback({ tone: 'ok', text: `Copied ${service.displayUrl}` });
    } catch {
      setFeedback({ tone: 'error', text: 'Could not copy the URL' });
    }
  };

  const cycleCategory = (step: 1 | -1) => {
    const options: Array<ServiceCategory | null> = [null, ...categories];
    const next = (options.indexOf(category) + step + options.length) % options.length;
    setCategory(options[next]);
    setSelectedIndex(0);
  };

  const activate = (shift: boolean) => {
    const target = visible[selected]?.item;
    if (!target) return;
    if (commandMode) run(target as PaletteCommand);
    else if (shift) void copyUrl(target as ServiceItem);
    else launch(target as ServiceItem);
  };

  const count = Math.max(visible.length, 1);
  const keyActions: Record<string, (shift: boolean) => void> = {
    Escape: onClose,
    ArrowDown: () => setSelectedIndex((selected + 1) % count),
    ArrowUp: () => setSelectedIndex((selected - 1 + count) % count),
    Enter: activate,
    // Tab cycles the category filters instead of leaving the search field
    Tab: (shift) => cycleCategory(shift ? -1 : 1),
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const action = keyActions[e.key];
    // In command mode there are no filters, so Tab keeps its usual meaning
    if (!action || (commandMode && e.key === 'Tab')) return;
    e.preventDefault();
    action(e.shiftKey);
  };

  const chooseCategory = (next: ServiceCategory | null) => {
    setCategory(next);
    setSelectedIndex(0);
    inputRef.current?.focus();
  };

  const renderService = ({ item: service, highlight }: RankedItem<ServiceItem>, index: number) => (
    <ResultRow
      key={service.id}
      selected={index === selected}
      icon={service.icon || 'hub'}
      onClick={() => launch(service)}
      trailing={
        <span className="hidden sm:inline-block shrink-0 ml-2 px-1.5 py-0.5 rounded bg-[#0E1117] font-mono text-[10px] text-[#94A3B8] border border-[#1C212B]">
          {service.category}
        </span>
      }
    >
      <span className="text-[13px] text-white font-medium tracking-tight truncate">
        <Highlighted text={service.name} indices={highlight} />
      </span>
      <span className="text-[11px] text-[#94A3B8] truncate font-mono">
        {service.description} • {service.displayUrl}
      </span>
    </ResultRow>
  );

  const renderCommand = ({ item: command, highlight }: RankedItem<PaletteCommand>, index: number) => (
    <ResultRow key={command.id} selected={index === selected} icon={command.icon} onClick={() => run(command)}>
      <span className="text-[13px] text-white font-medium tracking-tight truncate">
        <Highlighted text={command.title} indices={highlight} />
      </span>
    </ResultRow>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      // Light dismiss: the browser turns a click outside the panel into `cancel`
      {...{ closedby: 'any' }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="mt-16 sm:mt-24 mx-auto w-[calc(100%-2rem)] max-w-[640px] p-0 bg-transparent backdrop:bg-[#07090D]/80 backdrop:backdrop-blur-md"
    >
      <div className="rounded-2xl bg-[#0E1117]/95 border border-[#283141] shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col">
        <div className="flex items-center px-4 sm:px-6 py-3.5 bg-[#07090D]/60 border-b border-[#1C212B] gap-3">
          <span className="material-symbols-outlined text-[20px] text-[#67df70] select-none shrink-0">
            {commandMode ? 'chevron_right' : 'terminal'}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            aria-label="Search services, or type > for commands"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search services, or type > for commands"
            className="flex-1 min-w-0 bg-transparent font-mono text-[14px] text-white placeholder:text-[#64748B] focus:outline-none focus:ring-0"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            {feedback && (
              <output
                className={`text-[11px] font-mono px-2 py-0.5 rounded border animate-fade-in ${
                  feedback.tone === 'ok'
                    ? 'text-[#67df70] bg-[#67df70]/10 border-[#67df70]/30'
                    : 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                }`}
              >
                {feedback.text}
              </output>
            )}
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[10px] text-[#94A3B8] px-2 py-1 rounded bg-[#191C22] border border-[#283141] hover:text-white select-none transition-colors"
            >
              ESC
            </button>
          </div>
        </div>

        {!commandMode && categories.length > 1 && (
          <CategoryFilters categories={categories} value={category} onChange={chooseCategory} />
        )}

        <div ref={listRef} className="px-3 sm:px-4 py-2 flex flex-col gap-1 max-h-[min(440px,60vh)] overflow-y-auto scrollbar-subtle">
          {visible.length === 0 ? (
            <EmptyResults commandMode={commandMode} search={search} category={category} />
          ) : (
            <>
              <SectionHeading
                label={commandMode ? '// COMMANDS' : '// SERVICES'}
                detail={results.length > visible.length ? `TOP ${visible.length} OF ${results.length}` : undefined}
              />
              {commandMode
                ? (visible as RankedItem<PaletteCommand>[]).map((result, index) => renderCommand(result, index))
                : (visible as RankedItem<ServiceItem>[]).map((result, index) => renderService(result, index))}
            </>
          )}
        </div>

        <PaletteFooter count={results.length} commandMode={commandMode} hasCategories={categories.length > 1} />
      </div>
    </dialog>
  );
};

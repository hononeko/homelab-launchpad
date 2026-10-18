import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette, PaletteCommand } from './CommandPalette';
import { makeService } from '../test/fixtures';
import { ServiceItem } from '../types';

const services: ServiceItem[] = [
  makeService({ id: 'jellyfin', name: 'Jellyfin', displayUrl: 'tv.example.com', url: 'https://tv.example.com' }),
  makeService({
    id: 'hass',
    name: 'Home Assistant',
    displayUrl: 'hass.example.com',
    url: 'https://hass.example.com',
    description: 'Home automation hub',
    category: 'HOME & LIVING',
    icon: 'home',
  }),
  makeService({
    id: 'grafana',
    name: 'Grafana',
    displayUrl: 'metrics.example.com',
    url: 'https://metrics.example.com',
    description: 'Dashboards',
    category: 'CLUSTER & OPS',
  }),
];

const many = Array.from({ length: 40 }, (_, i) =>
  makeService({ id: `svc-${i}`, name: `Service ${i}`, displayUrl: `svc-${i}.example.com`, url: `https://svc-${i}.example.com` })
);

const PLACEHOLDER = 'Search services, or type > for commands';

function renderPalette({ list = services, isOpen = true, commands = [] as PaletteCommand[] } = {}) {
  const onClose = mock();
  const onLaunchService = mock();
  render(
    <CommandPalette isOpen={isOpen} onClose={onClose} services={list} onLaunchService={onLaunchService} commands={commands} />
  );
  const input = screen.queryByPlaceholderText(PLACEHOLDER) as HTMLInputElement | null;
  return { onClose, onLaunchService, input };
}

const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
const key = (input: HTMLInputElement, k: string, extra: Record<string, unknown> = {}) =>
  fireEvent.keyDown(input, { key: k, ...extra });
const selectedText = () => document.querySelector('[data-selected="true"]')?.textContent ?? '';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

describe('CommandPalette search', () => {
  test('renders nothing when closed, and opens as a modal with the search focused', () => {
    expect(renderPalette({ isOpen: false }).input).toBeNull();
    const { input } = renderPalette();
    expect((screen.getByRole('dialog') as HTMLDialogElement).open).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  test('fuzzy matches names, ranking name matches above other fields', () => {
    const { input } = renderPalette();
    type(input!, 'hmast');
    expect(screen.getByText('1 matching services')).toBeDefined();
    expect(selectedText()).toContain('Home Assistant');

    // "metrics" is only in Grafana's address
    type(input!, 'metrics');
    expect(selectedText()).toContain('Grafana');
  });

  test('highlights the matched characters of the name', () => {
    const { input } = renderPalette();
    type(input!, 'jelly');
    expect(screen.getByText('Jelly').tagName).toBe('MARK');
  });

  test.each(['(', 'c++', '[a-z', '\\'])('treats %p as literal text', (query) => {
    const { input } = renderPalette({ list: [makeService({ name: 'Notes (c++) [a-z] \\' })] });
    type(input!, query);
    expect(screen.getByText('1 matching services')).toBeDefined();
  });

  test('says when nothing matches', () => {
    const { input } = renderPalette();
    type(input!, 'zzzz');
    expect(screen.getByText('No matching services for "zzzz"')).toBeDefined();
  });

  test('shows at most 30 results and says how many matched', () => {
    renderPalette({ list: many });
    expect(screen.getByText('40 matching services')).toBeDefined();
    expect(screen.getByText('TOP 30 OF 40')).toBeDefined();
    expect(screen.queryByText('Service 30')).toBeNull();
  });
});

describe('CommandPalette keyboard', () => {
  test('Enter launches the selection and closes', () => {
    const { input, onLaunchService, onClose } = renderPalette();
    key(input!, 'Enter');
    expect(onLaunchService).toHaveBeenCalledWith(services[0]);
    expect(onClose).toHaveBeenCalled();
  });

  test('arrow keys move the selection, wrapping at both ends', () => {
    const { input, onLaunchService } = renderPalette();
    key(input!, 'ArrowDown');
    key(input!, 'ArrowDown');
    expect(selectedText()).toContain('Grafana');
    key(input!, 'ArrowDown');
    expect(selectedText()).toContain('Jellyfin');
    key(input!, 'ArrowUp');
    key(input!, 'Enter');
    expect(onLaunchService).toHaveBeenLastCalledWith(services[2]);
  });

  test('the selection is scrolled into view', () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function () {
      scrolled.push(this.textContent ?? '');
    };
    try {
      const { input } = renderPalette({ list: many });
      key(input!, 'ArrowUp');
      expect(scrolled.at(-1)).toContain('Service 29');
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  test('Shift+Enter copies the selected URL without closing', async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { input, onClose, onLaunchService } = renderPalette();
    await act(async () => {
      key(input!, 'Enter', { shiftKey: true });
    });
    expect(writeText).toHaveBeenCalledWith('https://tv.example.com');
    expect(screen.getByText('Copied tv.example.com')).toBeDefined();
    expect(onLaunchService).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a failed copy is reported', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { input } = renderPalette();
    await act(async () => {
      key(input!, 'Enter', { shiftKey: true });
    });
    expect(screen.getByText('Could not copy the URL')).toBeDefined();
  });

  test('Tab and Shift+Tab cycle the category filters', () => {
    const { input } = renderPalette();
    const pressed = () => screen.getByRole('button', { pressed: true }).textContent;
    expect(pressed()).toBe('ALL');

    key(input!, 'Tab');
    expect(pressed()).toBe('MEDIA');
    expect(screen.getByText('1 matching services')).toBeDefined();
    key(input!, 'Tab');
    key(input!, 'Tab');
    expect(pressed()).toBe('CLUSTER & OPS');
    key(input!, 'Tab');
    expect(pressed()).toBe('ALL');
    key(input!, 'Tab', { shiftKey: true });
    expect(pressed()).toBe('CLUSTER & OPS');
  });

  test('clicking a filter keeps typing in the search field', () => {
    const { input } = renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'HOME & LIVING' }));
    expect(screen.getByText('1 matching services')).toBeDefined();
    expect(document.activeElement).toBe(input);
    type(input!, 'graf');
    expect(screen.getByText('No matching services for "graf" in HOME & LIVING')).toBeDefined();
  });

  test('Escape, the ESC button, the cancel event and the backdrop close the palette', () => {
    const { input, onClose } = renderPalette();
    key(input!, 'Escape');
    fireEvent.click(screen.getByText('ESC'));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByRole('dialog'));
    // Clicks inside the panel are not backdrop clicks
    fireEvent.click(screen.getByText('3 matching services'));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  test('clicking a result launches it', () => {
    const { onLaunchService } = renderPalette();
    fireEvent.click(screen.getByText('Grafana'));
    expect(onLaunchService).toHaveBeenCalledWith(services[2]);
  });
});

describe('CommandPalette commands', () => {
  const commands = (runs: Record<string, ReturnType<typeof mock>>): PaletteCommand[] => [
    { id: 'scan', title: 'Scan cluster routes', icon: 'radar', keywords: ['discover'], run: runs.scan },
    { id: 'sync', title: 'Sync all ArgoCD applications', icon: 'sync', keywords: ['deploy'], run: runs.sync },
  ];

  test('">" lists commands and Enter runs the selection', () => {
    const runs = { scan: mock(), sync: mock() };
    const { input, onClose } = renderPalette({ commands: commands(runs) });
    type(input!, '>');
    expect(screen.getByText('2 matching commands')).toBeDefined();
    expect(screen.queryByText('Jellyfin')).toBeNull();
    // Category filters are for services only
    expect(screen.queryByRole('button', { name: 'MEDIA' })).toBeNull();

    type(input!, '> deploy');
    key(input!, 'Enter');
    expect(runs.sync).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    expect(runs.scan).not.toHaveBeenCalled();
  });

  test('commands run on click and report when none match', () => {
    const runs = { scan: mock(), sync: mock() };
    const { input } = renderPalette({ commands: commands(runs) });
    type(input!, '>scan');
    fireEvent.click(screen.getByText('cluster routes', { exact: false }));
    expect(runs.scan).toHaveBeenCalled();

    type(input!, '>nope');
    expect(screen.getByText('No commands match "nope"')).toBeDefined();
  });
});

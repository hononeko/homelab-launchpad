import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CategoryRulesPanel } from './CategoryRulesPanel';
import type { CategoryMappings } from '../types';

const MAPPINGS: CategoryMappings = {
  appRules: [
    { keywords: ['plex', 'jellyfin'], category: 'MEDIA', icon: 'tv' },
    { keywords: ['grafana'], category: 'CLUSTER & OPS', icon: 'monitoring' },
  ],
  namespaceRules: { media: { category: 'MEDIA', icon: 'movie' } },
  overrides: { 'app.example.com': { name: 'App', icon: 'apps' } },
};

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
let requests: Array<{ url: string; init?: RequestInit }>;

function installApi(reply: (url: string, init?: RequestInit) => { status?: number; body: unknown } | 'fail') {
  requests = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const result = reply(url, init);
    if (result === 'fail') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
  }) as unknown as typeof fetch;
}

// Echoes saved rules back like the server does
function serverApi(customized = false) {
  installApi((url, init) => {
    if (url === '/api/config/mappings' && init?.method === 'PUT') {
      return { body: { success: true, customized: true, mappings: JSON.parse(String(init.body)) } };
    }
    if (url === '/api/config/mappings/reset') {
      return { body: { success: true, customized: false, mappings: { ...MAPPINGS, overrides: {} } } };
    }
    return { body: { success: true, customized, mappings: MAPPINGS, defaults: MAPPINGS } };
  });
}

const savedBody = () => {
  const put = requests.find((r) => r.init?.method === 'PUT');
  return JSON.parse(String(put!.init!.body)) as CategoryMappings;
};
const saveButton = () => screen.getByText('Save rules') as HTMLButtonElement;

async function renderPanel() {
  render(<CategoryRulesPanel />);
  await screen.findByText('Keyword rules (2)');
}

beforeEach(() => serverApi());

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
});

describe('CategoryRulesPanel', () => {
  test('loads the rules and shows each section', async () => {
    await renderPanel();
    expect(screen.getByText('Namespace rules (1)')).toBeDefined();
    expect(screen.getByText('Route overrides (1)')).toBeDefined();
    expect((screen.getByLabelText('Keywords for keyword rule 1') as HTMLInputElement).value).toBe('plex, jellyfin');
    expect(screen.getByText('App · apps')).toBeDefined();
    expect(screen.getByText(/Using the built-in defaults/)).toBeDefined();
    expect(saveButton().disabled).toBe(true);
  });

  test('saves edited keywords normalized to lowercase', async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Keywords for keyword rule 2'), { target: { value: 'Grafana,  Prometheus ' } });
    fireEvent.change(screen.getByLabelText('Category for keyword rule 2'), { target: { value: 'TOOLS & DEV' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText('Saved. Discovered routes were re-classified.')).toBeDefined();
    expect(savedBody().appRules[1]).toEqual({ keywords: ['grafana', 'prometheus'], category: 'TOOLS & DEV', icon: 'monitoring' });
    expect(screen.getByText(/Customized/)).toBeDefined();
    expect(saveButton().disabled).toBe(true);
  });

  test('reorders, adds and removes rules', async () => {
    await renderPanel();
    fireEvent.click(screen.getByLabelText('Move keyword rule 2 up'));
    expect((screen.getByLabelText('Move keyword rule 1 up') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('Add namespace rule'));
    fireEvent.change(screen.getByLabelText('Namespace for namespace rule 2'), { target: { value: ' Tools ' } });
    fireEvent.click(screen.getByLabelText('Remove the override for app.example.com'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(requests.some((r) => r.init?.method === 'PUT')).toBe(true));
    const body = savedBody();
    expect(body.appRules.map((r) => r.keywords[0])).toEqual(['grafana', 'plex']);
    expect(body.namespaceRules.tools).toEqual({ category: 'TOOLS & DEV', icon: 'hub' });
    expect(body.overrides).toEqual({});
  });

  test('picks an icon for a rule', async () => {
    await renderPanel();
    fireEvent.click(screen.getByLabelText('Icon for keyword rule 1: tv'));
    fireEvent.click(screen.getByLabelText('live_tv'));
    expect(screen.getByLabelText('Icon for keyword rule 1: live_tv')).toBeDefined();
    // Choosing closes the picker
    expect(screen.queryByLabelText('Search icons')).toBeNull();
  });

  test.each([
    ['an empty keyword rule', () => fireEvent.click(screen.getByText('Add keyword rule')), 'Keyword rule 3 has no keywords'],
    ['a namespace without a name', () => fireEvent.click(screen.getByText('Add namespace rule')), 'A namespace rule has no namespace'],
    [
      'a duplicate namespace',
      () => {
        fireEvent.click(screen.getByText('Add namespace rule'));
        fireEvent.change(screen.getByLabelText('Namespace for namespace rule 2'), { target: { value: 'media' } });
      },
      'Namespace media is listed twice',
    ],
  ])('blocks saving %s', async (_label, edit, problem) => {
    await renderPanel();
    edit();
    expect(screen.getByRole('status').textContent).toBe(problem);
    expect(saveButton().disabled).toBe(true);
  });

  test('discard restores the saved rules', async () => {
    await renderPanel();
    fireEvent.click(screen.getByLabelText('Remove keyword rule 1'));
    expect(screen.getByText('Keyword rules (1)')).toBeDefined();
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.getByText('Keyword rules (2)')).toBeDefined();
  });

  test('reset asks first, then restores the defaults', async () => {
    serverApi(true);
    window.confirm = mock(() => false) as unknown as typeof window.confirm;
    await renderPanel();
    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(requests.some((r) => r.url === '/api/config/mappings/reset')).toBe(false);

    window.confirm = mock(() => true) as unknown as typeof window.confirm;
    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(await screen.findByText('Restored the default rules.')).toBeDefined();
    expect(screen.getByText('Route overrides (0)')).toBeDefined();
    expect(screen.queryByText('Reset to defaults')).toBeNull();
  });

  test('shows the server error when a save is rejected', async () => {
    installApi((_url, init) =>
      init?.method === 'PUT'
        ? { status: 400, body: { success: false, error: 'appRules[0].icon is invalid' } }
        : { body: { success: true, customized: false, mappings: MAPPINGS } }
    );
    await renderPanel();
    fireEvent.click(screen.getByLabelText('Remove keyword rule 2'));
    fireEvent.click(saveButton());
    expect(await screen.findByText('Could not save: appRules[0].icon is invalid')).toBeDefined();
  });

  test('reports when the server is unreachable', async () => {
    installApi(() => 'fail');
    render(<CategoryRulesPanel />);
    expect(await screen.findByText('Could not load the category rules.')).toBeDefined();
  });
});

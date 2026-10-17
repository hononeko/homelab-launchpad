import { describe, expect, mock, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigView } from './ConfigView';

function renderConfig(props: Partial<ComponentProps<typeof ConfigView>> = {}) {
  const handlers = {
    onToggleArgo: mock(),
    onToggleAutoSyncRoutes: mock(),
    onResetToDefaults: mock(),
    onToggleCategory: mock(),
    onChangeDefaultTab: mock(),
  };
  const { container } = render(
    <ConfigView
      argoEnabled
      autoSyncRoutes={false}
      totalServicesCount={12}
      totalRoutesCount={7}
      hiddenCategories={['CLUSTER & OPS']}
      defaultTab="pinned"
      syncState="synced"
      persisted
      {...handlers}
      {...props}
    />
  );
  return { ...handlers, container };
}

describe('ConfigView', () => {
  test('shows launchpad totals', () => {
    renderConfig();
    expect(screen.getByText('Active launchpad: 12 services • 7 discovered routes')).toBeDefined();
  });

  test('toggles call their handlers and reset asks the parent', () => {
    const { container, onToggleArgo, onToggleAutoSyncRoutes, onResetToDefaults } = renderConfig();
    const toggles = container.querySelectorAll('button[type="button"]');
    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);
    expect(onToggleAutoSyncRoutes).toHaveBeenCalledTimes(1);
    expect(onToggleArgo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Reset Services'));
    expect(onResetToDefaults).toHaveBeenCalledTimes(1);
  });

  test('the default tab select reports the chosen tab', () => {
    const { onChangeDefaultTab } = renderConfig();
    const select = screen.getByLabelText('Default Tab') as HTMLSelectElement;
    expect(select.value).toBe('pinned');
    fireEvent.change(select, { target: { value: 'all' } });
    expect(onChangeDefaultTab).toHaveBeenCalledWith('all');
  });

  test('category buttons show visibility and toggle categories', () => {
    const { onToggleCategory } = renderConfig();
    const ops = screen.getByText('CLUSTER & OPS');
    expect(ops.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('MEDIA').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(ops);
    expect(onToggleCategory).toHaveBeenCalledWith('CLUSTER & OPS');
  });

  test.each([
    ['local', true, 'Saved in this browser only'],
    ['synced', true, 'Synced to your account across devices'],
    ['synced', false, 'Synced, but the server keeps preferences in memory only (no Valkey configured)'],
    ['offline', true, 'Server unreachable: changes are saved in this browser only'],
    ['error', true, 'Could not save to the server: changes are kept in this browser'],
  ] as const)('describes the %s sync state (persisted=%p)', (syncState, persisted, text) => {
    renderConfig({ syncState, persisted });
    expect(screen.getByTestId('sync-status').textContent).toBe(text);
  });

  test('editing preferences and saving shows a confirmation', () => {
    const { container } = renderConfig();
    const domain = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(domain, { target: { value: 'lab.example.com' } });
    expect(domain.value).toBe('lab.example.com');

    fireEvent.change(container.querySelector('select')!, { target: { value: 'traefik-v3' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(screen.getByText('Saved!')).toBeDefined();
  });
});

import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigView } from './ConfigView';

function renderConfig() {
  const handlers = { onToggleArgo: mock(), onToggleAutoSyncRoutes: mock(), onResetToDefaults: mock() };
  const { container } = render(
    <ConfigView argoEnabled autoSyncRoutes={false} totalServicesCount={12} totalRoutesCount={7} {...handlers} />
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

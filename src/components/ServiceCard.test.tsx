import { describe, expect, mock, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ServiceCard } from './ServiceCard';
import { makeArgoApp, makeHealth, makeService } from '../test/fixtures';

function renderCard(props: Partial<ComponentProps<typeof ServiceCard>> = {}) {
  const onLaunch = mock();
  const onTogglePin = mock();
  const service = props.service ?? makeService();
  render(<ServiceCard service={service} onLaunch={onLaunch} onTogglePin={onTogglePin} {...props} />);
  return { onLaunch, onTogglePin, service };
}

describe('ServiceCard', () => {
  test('renders the service identity and usage', () => {
    renderCard();
    expect(screen.getByText('Jellyfin')).toBeDefined();
    expect(screen.getByText('jellyfin.example.com')).toBeDefined();
    expect(screen.getByText('3 launches/wk')).toBeDefined();
    expect(screen.getByText('Active • 2h ago')).toBeDefined();
  });

  test('launches on click but not when toggling the pin', () => {
    const { onLaunch, onTogglePin, service } = renderCard();
    fireEvent.click(screen.getByTitle('Pin to favorites'));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onTogglePin.mock.calls[0][0]).toBe(service.id);
    expect(onLaunch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Media streaming server'));
    expect(onLaunch).toHaveBeenCalledWith(service);
  });

  test('shows the pinned state', () => {
    renderCard({ service: makeService({ isPinned: true }) });
    expect(screen.getByTitle('Unpin service')).toBeDefined();
  });

  test('shows live latency and a timing breakdown from probe results', () => {
    renderCard({ health: makeHealth() });
    expect(screen.getByText('(42ms)')).toBeDefined();
    const status = screen.getByText('Active • 2h ago').parentElement!;
    expect(status.getAttribute('title')).toContain('HTTP 200 • DNS 1ms • TCP 2ms • TLS 3ms • TTFB 36ms');
  });

  test.each([
    ['offline', 'Offline'],
    ['degraded', 'Degraded'],
  ] as const)('labels %s probe results', (status, label) => {
    renderCard({
      health: makeHealth({ status, httpStatus: null, latencyMs: null, timings: null, error: 'ECONNREFUSED' }),
    });
    const element = screen.getByText(`${label} • 2h ago`);
    expect(element.parentElement!.getAttribute('title')).toContain('Unreachable (ECONNREFUSED)');
    expect(screen.queryByText(/ms\)$/)).toBeNull();
  });

  test('shows the ArgoCD sync state when the integration is enabled', () => {
    renderCard({ argoApp: makeArgoApp({ syncStatus: 'OutOfSync' }) });
    expect(screen.getByText('OutOfSync • 2h ago')).toBeDefined();
    expect(screen.getByText('GitOps')).toBeDefined();
  });

  test('hides ArgoCD details when the integration is disabled', () => {
    renderCard({ argoApp: makeArgoApp({ syncStatus: 'OutOfSync' }), showArgoIntegration: false });
    expect(screen.getByText('Active • 2h ago')).toBeDefined();
    expect(screen.queryByText('GitOps')).toBeNull();
  });

  test('reachability problems outrank the ArgoCD state', () => {
    renderCard({ argoApp: makeArgoApp({ syncStatus: 'Synced' }), health: makeHealth({ status: 'offline' }) });
    expect(screen.getByText('Offline • 2h ago')).toBeDefined();
  });

  test('offers hiding only when the parent handles it', () => {
    const onHide = mock();
    renderCard({ onHide });
    fireEvent.click(screen.getByTitle('Hide from dashboard'));
    expect(onHide).toHaveBeenCalledWith('imported-jellyfin');
  });

  test('hiding does not launch the service', () => {
    const { onLaunch } = renderCard({ onHide: mock() });
    fireEvent.click(screen.getByTitle('Hide from dashboard'));
    expect(onLaunch).not.toHaveBeenCalled();
  });

  test('has no hide button without a handler', () => {
    renderCard();
    expect(screen.queryByTitle('Hide from dashboard')).toBeNull();
  });
});

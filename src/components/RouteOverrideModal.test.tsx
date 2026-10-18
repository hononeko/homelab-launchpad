import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouteOverrideModal } from './RouteOverrideModal';
import { makeRoute } from '../test/fixtures';
import type { DiscoveredHTTPRoute } from '../types';

function renderModal(route: DiscoveredHTTPRoute = makeRoute(), saved = true) {
  const onSave = mock(async () => saved);
  const onClose = mock();
  render(<RouteOverrideModal route={route} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

describe('RouteOverrideModal', () => {
  test('starts from the route as discovered and saves the full override', async () => {
    const { onSave, onClose } = renderModal();
    expect((screen.getByLabelText('NAME') as HTMLInputElement).value).toBe('Jellyfin');
    expect((screen.getByLabelText('CATEGORY') as HTMLSelectElement).value).toBe('MEDIA');

    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: ' Movies ' } });
    fireEvent.change(screen.getByLabelText('CATEGORY'), { target: { value: 'HOME & LIVING' } });
    fireEvent.click(screen.getByLabelText('live_tv'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('jellyfin.example.com', {
      name: 'Movies',
      category: 'HOME & LIVING',
      icon: 'live_tv',
    });
  });

  test('stays open when saving fails', async () => {
    const { onSave, onClose } = renderModal(makeRoute(), false);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(false);
  });

  test('offers removing an existing override', async () => {
    const { onSave } = renderModal(makeRoute({ override: { icon: 'live_tv' } }));
    fireEvent.click(screen.getByText('Remove override'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('jellyfin.example.com', null));
  });

  test('has no remove button without an override, and a blank name cannot be saved', () => {
    const { onSave } = renderModal();
    expect(screen.queryByText('Remove override')).toBeNull();
    fireEvent.change(screen.getByLabelText('NAME'), { target: { value: '  ' } });
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('NAME').closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('Escape and Cancel close it', () => {
    const { onClose } = renderModal();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

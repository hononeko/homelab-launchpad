import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditServiceModal } from './EditServiceModal';
import { makeService } from '../test/fixtures';
import type { ServiceItem } from '../types';

function renderModal(service: ServiceItem = makeService()) {
  const onSave = mock();
  const onClose = mock();
  render(<EditServiceModal service={service} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

const nameInput = () => screen.getByLabelText(/DISPLAY NAME/) as HTMLInputElement;
const preview = () => screen.getByTestId('service-preview');

describe('EditServiceModal', () => {
  test('previews the name and icon while editing', () => {
    renderModal();
    expect(nameInput().value).toBe('Jellyfin');

    fireEvent.change(nameInput(), { target: { value: 'Movies' } });
    fireEvent.click(screen.getByLabelText('movie'));

    expect(preview().textContent).toContain('Movies');
    expect(preview().textContent).toContain('movie');
    expect(screen.getByLabelText('movie').getAttribute('aria-pressed')).toBe('true');
  });

  test('saves the trimmed name and chosen icon', () => {
    const { onSave } = renderModal();
    fireEvent.change(nameInput(), { target: { value: '  Movies  ' } });
    fireEvent.click(screen.getByLabelText('movie'));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('imported-jellyfin', { name: 'Movies', icon: 'movie' });
  });

  test('Enter in the name field saves', () => {
    const { onSave } = renderModal();
    fireEvent.change(nameInput(), { target: { value: 'Movies' } });
    fireEvent.submit(nameInput().form!);
    expect(onSave).toHaveBeenCalledWith('imported-jellyfin', { name: 'Movies', icon: 'tv' });
  });

  test('an empty name cannot be saved', () => {
    const { onSave } = renderModal();
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(nameInput().form!);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('opens as a modal with the name field focused', () => {
    renderModal();
    expect((screen.getByRole('dialog') as HTMLDialogElement).open).toBe(true);
    expect(document.activeElement).toBe(nameInput());
  });

  test('Escape, Close and Cancel close without saving', () => {
    const { onSave, onClose } = renderModal();
    // Browsers fire `cancel` on the dialog when Escape is pressed
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('searches the catalog and filters by category', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Search icons'), { target: { value: 'movie' } });
    expect(screen.getByLabelText('movie')).toBeDefined();
    expect(screen.queryByLabelText('terminal')).toBeNull();

    fireEvent.change(screen.getByLabelText('Search icons'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Dev'));
    expect(screen.getByLabelText('terminal')).toBeDefined();
    expect(screen.queryByLabelText('movie')).toBeNull();
  });

  test('offers a typed symbol name outside the catalog', () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByLabelText('Search icons'), { target: { value: 'Rocket Launch' } });
    fireEvent.click(screen.getByLabelText('rocket_launch'));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('imported-jellyfin', { name: 'Jellyfin', icon: 'rocket_launch' });
  });

  test('says when nothing matches', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Search icons'), { target: { value: 'no-such icon!' } });
    expect(screen.getByText('No icons match')).toBeDefined();
  });

  test('resets an edited service to its original name and icon', () => {
    renderModal(makeService({ name: 'Movies', icon: 'movie', original: { name: 'Jellyfin', icon: 'tv' } }));
    expect(screen.getByText('Originally Jellyfin')).toBeDefined();

    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(nameInput().value).toBe('Jellyfin');
    expect(screen.getByLabelText('tv').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByText('Reset to defaults') as HTMLButtonElement).disabled).toBe(true);
  });

  test('reset is unavailable for a service that was never edited', () => {
    renderModal();
    expect((screen.getByText('Reset to defaults') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: 'Movies' } });
    // Before saving, reset just undoes the unsaved change
    fireEvent.click(screen.getByText('Reset to defaults'));
    expect(nameInput().value).toBe('Jellyfin');
  });
});

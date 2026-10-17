import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { makeService } from '../test/fixtures';
import { ServiceItem } from '../types';

const services = Array.from({ length: 10 }, (_, i) =>
  makeService({
    id: `svc-${i}`,
    name: `Service ${i}`,
    url: `https://svc-${i}.example.com`,
    displayUrl: `svc-${i}.example.com`,
    description: i === 3 ? 'Home automation hub' : 'Generic service',
  })
);

function renderPalette(list: ServiceItem[] = services, isOpen = true) {
  const onClose = mock();
  const onLaunchService = mock();
  render(<CommandPalette isOpen={isOpen} onClose={onClose} services={list} onLaunchService={onLaunchService} />);
  const input = screen.queryByPlaceholderText('Search services, DNS routes, pods...') as HTMLInputElement | null;
  return { onClose, onLaunchService, input };
}

describe('CommandPalette', () => {
  test('renders nothing when closed', () => {
    const { input } = renderPalette(services, false);
    expect(input).toBeNull();
  });

  test('shows the best match plus at most seven related services', () => {
    renderPalette();
    expect(screen.getByText('10 matching services')).toBeDefined();
    expect(screen.getByText('7 OTHERS')).toBeDefined();
    expect(screen.queryByText('Service 8')).toBeNull();
  });

  test('filters by name, description, and domain', () => {
    const { input } = renderPalette();
    fireEvent.change(input!, { target: { value: 'automation' } });
    expect(screen.getByText('1 matching services')).toBeDefined();
    expect(screen.getByText('Home automation hub • svc-3.example.com')).toBeDefined();

    fireEvent.change(input!, { target: { value: 'nothing-like-this' } });
    expect(screen.getByText('No matching services for "nothing-like-this"')).toBeDefined();
  });

  test('highlights matches case-insensitively', () => {
    const { input } = renderPalette([makeService()]);
    fireEvent.change(input!, { target: { value: 'jelly' } });
    expect(screen.getByText('Jelly').tagName).toBe('SPAN');
  });

  test.each(['(', 'c++', '[a-z', '\\'])('treats %p as literal text instead of crashing', (query) => {
    const { input } = renderPalette([makeService({ name: 'Notes (c++) [a-z] \\' })]);
    fireEvent.change(input!, { target: { value: query } });
    expect(screen.getByText('1 matching services')).toBeDefined();
  });

  test('Enter launches the best match and closes', () => {
    const { input, onLaunchService, onClose } = renderPalette();
    fireEvent.keyDown(input!, { key: 'Enter' });
    expect(onLaunchService).toHaveBeenCalledWith(services[0]);
    expect(onClose).toHaveBeenCalled();
  });

  test('arrow keys move the selection and wrap within the visible results', () => {
    const { input, onLaunchService } = renderPalette();
    fireEvent.keyDown(input!, { key: 'ArrowDown' });
    fireEvent.keyDown(input!, { key: 'ArrowDown' });
    fireEvent.keyDown(input!, { key: 'Enter' });
    expect(onLaunchService).toHaveBeenLastCalledWith(services[2]);
  });

  test('ArrowUp from the top selects the last visible result, not a hidden one', () => {
    const { input, onLaunchService } = renderPalette();
    fireEvent.keyDown(input!, { key: 'ArrowUp' });
    fireEvent.keyDown(input!, { key: 'Enter' });
    expect(onLaunchService).toHaveBeenLastCalledWith(services[7]);
  });

  test('Tab copies the selected URL', async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { input } = renderPalette();
    fireEvent.keyDown(input!, { key: 'Tab' });
    expect(writeText).toHaveBeenCalledWith('https://svc-0.example.com');
    expect(screen.getByText('Copied Service 0!')).toBeDefined();
  });

  test('Escape, the ESC button, and the backdrop close the palette', () => {
    const { input, onClose } = renderPalette();
    fireEvent.keyDown(input!, { key: 'Escape' });
    fireEvent.click(screen.getByText('ESC'));
    fireEvent.click(screen.getByText('10 matching services').closest('.fixed')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test('clicking a related service launches it', () => {
    const { onLaunchService } = renderPalette();
    fireEvent.click(screen.getByText('Service 4'));
    expect(onLaunchService).toHaveBeenCalledWith(services[4]);
  });
});

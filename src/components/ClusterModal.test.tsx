import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClusterModal } from './ClusterModal';
import { INITIAL_NODES, INITIAL_TELEMETRY } from '../data/initialData';

function renderModal(isOpen = true) {
  const onClose = mock();
  render(<ClusterModal isOpen={isOpen} onClose={onClose} telemetry={INITIAL_TELEMETRY} nodes={INITIAL_NODES} />);
  return onClose;
}

describe('ClusterModal', () => {
  test('renders nothing when closed', () => {
    renderModal(false);
    expect(screen.queryByText(INITIAL_NODES[0].name)).toBeNull();
  });

  test('lists every node with its role and address', () => {
    renderModal();
    for (const node of INITIAL_NODES) {
      expect(screen.getByText(node.name)).toBeDefined();
    }
    expect(screen.getByText(new RegExp(`IP: ${INITIAL_NODES[0].ip}`))).toBeDefined();
  });

  test('closes from the backdrop but not from clicks inside the dialog', () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByText(INITIAL_NODES[0].name));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(INITIAL_NODES[0].name).closest('.fixed')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

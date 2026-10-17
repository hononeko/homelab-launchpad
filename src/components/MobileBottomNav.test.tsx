import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileBottomNav } from './MobileBottomNav';

describe('MobileBottomNav', () => {
  test('switches views and opens the cluster modal', () => {
    const onViewChange = mock();
    const onOpenClusterModal = mock();
    render(<MobileBottomNav currentView="gitops" onViewChange={onViewChange} onOpenClusterModal={onOpenClusterModal} />);

    fireEvent.click(screen.getByText('Services'));
    fireEvent.click(screen.getByText('GitOps'));
    fireEvent.click(screen.getByText('Config'));
    expect(onViewChange.mock.calls.map((c) => c[0])).toEqual(['overview', 'gitops', 'config']);

    fireEvent.click(screen.getByText('Cluster'));
    expect(onOpenClusterModal).toHaveBeenCalled();
  });
});

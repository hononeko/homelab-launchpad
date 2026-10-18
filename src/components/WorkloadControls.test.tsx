import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkloadPowerButton, WorkloadsPanel, WorkloadStatusBadge } from './WorkloadControls';
import type { ScalableWorkload } from '../types';

const sleeping: ScalableWorkload = {
  kind: 'StatefulSet',
  namespace: 'games',
  name: 'satisfactory',
  desiredReplicas: 0,
  readyReplicas: 0,
  state: 'stopped',
};
const running: ScalableWorkload = {
  kind: 'Deployment',
  namespace: 'tools',
  name: 'code-server',
  desiredReplicas: 1,
  readyReplicas: 1,
  state: 'running',
  host: 'code.example.com',
};

describe('WorkloadStatusBadge', () => {
  test.each([
    ['stopped', 0, 0, 'Sleeping'],
    ['starting', 1, 0, 'Starting…'],
    ['running', 1, 1, 'Running'],
    ['stopping', 0, 1, 'Stopping…'],
  ] as const)('labels %s workloads', (state, desiredReplicas, readyReplicas, label) => {
    render(<WorkloadStatusBadge workload={{ ...sleeping, state, desiredReplicas, readyReplicas }} />);
    const badge = screen.getByText(label);
    expect(badge.getAttribute('title')).toBe(`${readyReplicas}/1 ready`);
  });
});

describe('WorkloadPowerButton', () => {
  test('starts a sleeping workload and stops a running one', () => {
    const onToggle = mock();
    render(
      <>
        <WorkloadPowerButton workload={sleeping} busy={false} onToggle={onToggle} />
        <WorkloadPowerButton workload={running} busy={false} onToggle={onToggle} compact />
      </>
    );
    fireEvent.click(screen.getByLabelText('Start satisfactory'));
    fireEvent.click(screen.getByLabelText('Stop code-server'));
    expect(onToggle.mock.calls.map(([w]) => w.name)).toEqual(['satisfactory', 'code-server']);
    // The compact button has no text label
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.getByText('Start')).toBeDefined();
  });

  test('is disabled while a request is in flight', () => {
    render(<WorkloadPowerButton workload={sleeping} busy onToggle={mock()} />);
    expect((screen.getByLabelText('Start satisfactory') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('WorkloadsPanel', () => {
  test('lists every workload with its namespace, kind and host', () => {
    render(<WorkloadsPanel workloads={[sleeping, running]} busy={new Set(['tools/Deployment/code-server'])} onToggle={mock()} />);
    expect(screen.getByText('games · StatefulSet')).toBeDefined();
    expect(screen.getByText('tools · Deployment · code.example.com')).toBeDefined();
    expect((screen.getByLabelText('Stop code-server') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Start satisfactory') as HTMLButtonElement).disabled).toBe(false);
  });

  test('renders nothing without workloads', () => {
    const { container } = render(<WorkloadsPanel workloads={[]} busy={new Set()} onToggle={mock()} />);
    expect(container.innerHTML).toBe('');
  });
});

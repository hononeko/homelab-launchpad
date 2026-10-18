import React from 'react';
import { ScalableWorkload, WorkloadState } from '../types';
import { workloadKey } from '../hooks/useWorkloads';

const STATE_STYLES: Record<WorkloadState, { label: string; dot: string; text: string }> = {
  running: { label: 'Running', dot: 'bg-[#67df70]', text: 'text-[#67df70]' },
  stopped: { label: 'Sleeping', dot: 'bg-[#64748B]', text: 'text-[#94A3B8]' },
  starting: { label: 'Starting…', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400' },
  stopping: { label: 'Stopping…', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400' },
};

export function WorkloadStatusBadge({ workload }: Readonly<{ workload: ScalableWorkload }>) {
  const style = STATE_STYLES[workload.state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] ${style.text}`}
      title={`${workload.readyReplicas}/${Math.max(workload.desiredReplicas, 1)} ready`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`}></span>
      {style.label}
    </span>
  );
}

interface PowerButtonProps {
  workload: ScalableWorkload;
  busy: boolean;
  onToggle: (workload: ScalableWorkload) => void;
  compact?: boolean;
}

/** Wakes a sleeping workload, or puts a running (or starting) one to sleep. */
export function WorkloadPowerButton({ workload, busy, onToggle, compact = false }: Readonly<PowerButtonProps>) {
  const asleep = workload.desiredReplicas === 0;
  const action = asleep ? 'Start' : 'Stop';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onToggle(workload)}
      aria-label={`${action} ${workload.name}`}
      title={asleep ? 'Wake: scale to 1 replica' : 'Sleep: scale to 0 replicas'}
      className={`flex items-center gap-1 rounded-md border font-mono text-[11px] transition-colors disabled:opacity-40 ${
        compact ? 'p-1 border-transparent' : 'px-2 py-1'
      } ${
        asleep
          ? 'text-[#67df70] border-[#67df70]/30 hover:bg-[#67df70]/10'
          : 'text-[#94A3B8] border-[#283141] hover:text-rose-300 hover:border-rose-500/40'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{asleep ? 'power_settings_new' : 'bedtime'}</span>
      {!compact && <span>{action}</span>}
    </button>
  );
}

interface WorkloadsPanelProps {
  workloads: ScalableWorkload[];
  busy: Set<string>;
  onToggle: (workload: ScalableWorkload) => void;
}

/** Every opted-in workload, including ones without a service card (e.g. UDP game servers). */
export const WorkloadsPanel: React.FC<WorkloadsPanelProps> = ({ workloads, busy, onToggle }) => {
  if (workloads.length === 0) return null;
  return (
    <section className="bg-[#0A0C10]/90 rounded-xl border border-[#1C212B] px-4 py-3">
      <h2 className="font-mono text-[11px] text-[#94A3B8] tracking-wider mb-2">{'// ON-DEMAND WORKLOADS'}</h2>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {workloads.map((workload) => (
          <li
            key={workloadKey(workload)}
            className="flex items-center justify-between gap-3 rounded-lg bg-[#0E1117] border border-[#1C212B] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white font-medium truncate">{workload.name}</span>
                <WorkloadStatusBadge workload={workload} />
              </div>
              <div className="font-mono text-[10px] text-[#64748B] truncate">
                {workload.namespace} · {workload.kind}
                {workload.host ? ` · ${workload.host}` : ''}
              </div>
            </div>
            <WorkloadPowerButton workload={workload} busy={busy.has(workloadKey(workload))} onToggle={onToggle} />
          </li>
        ))}
      </ul>
    </section>
  );
};

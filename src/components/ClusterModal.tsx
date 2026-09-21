import React from 'react';
import { ClusterTelemetry, ClusterNode } from '../types';

interface ClusterModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: ClusterTelemetry;
  nodes: ClusterNode[];
}

export const ClusterModal: React.FC<ClusterModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  nodes,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07090D]/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl bg-[#0E1117] border border-[#283141] shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0A0C10] border-b border-[#1C212B]">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-[#67df70]">
              <span>NODE INFRA // PROD-US</span>
              <span className="text-[#64748B]">/</span>
              <span className="text-[#94A3B8]">CORE-STACK-01</span>
            </div>
            <h2 className="text-lg font-semibold text-white tracking-tight mt-0.5">
              Cluster Operations &amp; Telemetry
            </h2>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#151921] hover:bg-[#1D2026] text-[#94A3B8] hover:text-white flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* 4 Telemetry Cards (exact match of Screen 2 blur layer) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Pods Active */}
            <div className="bg-[#151921] rounded-xl p-4 border border-[#1C212B] relative overflow-hidden shadow-sm">
              <div className="flex items-center justify-between font-mono text-[11px] text-[#94A3B8]">
                <span>PODS_ACTIVE</span>
                <span className="text-[#67df70] font-medium">{telemetry.podsPercent}%</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1 font-mono">
                <span className="text-2xl font-semibold text-white">{telemetry.podsActive}</span>
                <span className="text-xs text-[#94A3B8]">/ {telemetry.podsTotal} READY</span>
              </div>
              <div className="mt-3 w-full bg-[#0A0C10] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#67df70] h-full rounded-full transition-all duration-500"
                  style={{ width: `${telemetry.podsPercent}%` }}
                ></div>
              </div>
            </div>

            {/* Agg CPU Load */}
            <div className="bg-[#151921] rounded-xl p-4 border border-[#1C212B] relative overflow-hidden shadow-sm">
              <div className="flex items-center justify-between font-mono text-[11px] text-[#94A3B8]">
                <span>AGG_CPU_LOAD</span>
                <span className="text-[#94A3B8]">{telemetry.aggCpuCores} CORES</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1 font-mono">
                <span className="text-2xl font-semibold text-white">{telemetry.aggCpuPercent}</span>
                <span className="text-xs text-[#94A3B8]">%</span>
              </div>
              <div className="mt-3 w-full bg-[#0A0C10] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#67df70] h-full rounded-full transition-all duration-500"
                  style={{ width: `${telemetry.aggCpuPercent}%` }}
                ></div>
              </div>
            </div>

            {/* NVMe Pool */}
            <div className="bg-[#151921] rounded-xl p-4 border border-[#1C212B] relative overflow-hidden shadow-sm">
              <div className="flex items-center justify-between font-mono text-[11px] text-[#94A3B8]">
                <span>NVME_POOL</span>
                <span className="text-[#d3bbff] font-medium">{telemetry.nvmePoolName}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1 font-mono">
                <span className="text-2xl font-semibold text-white">{telemetry.nvmeUsedTb}</span>
                <span className="text-xs text-[#94A3B8]">/ {telemetry.nvmeTotalTb}</span>
              </div>
              <div className="mt-3 w-full bg-[#0A0C10] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#d3bbff] h-full rounded-full transition-all duration-500"
                  style={{ width: `${telemetry.nvmePercent}%` }}
                ></div>
              </div>
            </div>

            {/* Ingress Gateway */}
            <div className="bg-[#151921] rounded-xl p-4 border border-[#1C212B] relative overflow-hidden shadow-sm">
              <div className="flex items-center justify-between font-mono text-[11px] text-[#94A3B8]">
                <span>INGRESS_GATEWAY</span>
                <span className="text-[#67df70] font-medium">{telemetry.ingressState}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1 font-mono">
                <span className="text-2xl font-semibold text-white">{telemetry.ingressRate}</span>
              </div>
              <div className="mt-3 w-full bg-[#0A0C10] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#67df70] h-full rounded-full transition-all duration-500"
                  style={{ width: `${telemetry.ingressPercent}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Node Breakdown Table */}
          <div className="bg-[#151921] rounded-xl border border-[#1C212B] overflow-hidden">
            <div className="px-5 py-3 bg-[#0A0C10] border-b border-[#1C212B] flex items-center justify-between">
              <span className="font-mono text-xs text-[#67df70] font-semibold">
                // TALOS LINUX NODES ({nodes.length})
              </span>
              <span className="font-mono text-[11px] text-[#94A3B8]">
                Kernel: 6.6.47-talos • Cilium eBPF
              </span>
            </div>

            <div className="divide-y divide-[#1C212B]">
              {nodes.map((node) => (
                <div
                  key={node.name}
                  className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-[#1D2026] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full bg-[#67df70] animate-pulse shrink-0"></span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-sm text-white">
                          {node.name}
                        </span>
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.2 rounded border ${
                            node.role === 'controlplane'
                              ? 'bg-[#67df70]/10 text-[#67df70] border-[#67df70]/30'
                              : 'bg-[#0E1117] text-[#94A3B8] border-[#283141]'
                          }`}
                        >
                          {node.role}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-[#64748B] mt-0.5 block">
                        IP: {node.ip} • Up: {node.uptime} • {node.version}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 font-mono text-xs text-[#94A3B8] self-end sm:self-center">
                    <div>
                      <span className="text-[#64748B] text-[10px] block">CPU</span>
                      <span className="text-white font-medium">{node.cpuUsage}%</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-[10px] block">RAM</span>
                      <span className="text-white font-medium">{node.memoryUsage}%</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] text-[10px] block">PODS</span>
                      <span className="text-white font-medium">{node.pods}/{node.maxPods}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#0A0C10] border-t border-[#1C212B] flex items-center justify-between font-mono text-[11px] text-[#94A3B8]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#67df70]"></span>
            <span>CNI: Cilium L7 eBPF Gateway • WireGuard Mesh Active</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-[#151921] hover:bg-[#1D2026] text-white rounded-lg border border-[#283141] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

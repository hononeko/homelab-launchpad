import { getK8sClient, k8sRequest } from './client';
import { ArgoApplication } from '../../src/types';
import { INITIAL_ARGO_APPS } from '../../src/data/initialData';

// RFC 1123 label format for Kubernetes resource names
const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// In-memory cache of ArgoCD applications
let cachedArgoApps: ArgoApplication[] = [];
let lastArgoScannedAt: string | null = null;

export function formatRelativeTime(dateInput: string | Date | undefined): string {
  if (!dateInput) return 'unknown';
  const time = typeof dateInput === 'string' ? new Date(dateInput).getTime() : dateInput.getTime();
  if (Number.isNaN(time)) return 'unknown';

  const diffMs = Date.now() - time;
  if (diffMs < 0) return 'just now';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function mapCrdToArgoApp(item: any): ArgoApplication {
  const metadata = item?.metadata ?? {};
  const spec = item?.spec ?? {};
  const status = item?.status ?? {};
  const source = spec.source ?? spec.sources?.[0] ?? {};
  const sync = status.sync ?? {};
  const health = status.health ?? {};
  const opState = status.operationState ?? {};

  const name = metadata.name ?? 'unnamed';
  const targetRev = source.targetRevision || 'HEAD';
  const shortRev = sync.revision ? String(sync.revision).slice(0, 7) : '';
  const revisionDisplay = shortRev ? `${targetRev} (${shortRev})` : targetRev;

  let syncStatus: ArgoApplication['syncStatus'] = 'Unknown';
  if (item?.operation?.sync || opState.phase === 'Running') {
    syncStatus = 'Syncing';
  } else if (sync.status === 'Synced' || sync.status === 'OutOfSync') {
    syncStatus = sync.status;
  }

  let healthStatus: ArgoApplication['healthStatus'] = 'Healthy';
  if (['Healthy', 'Progressing', 'Degraded', 'Missing'].includes(health.status)) {
    healthStatus = health.status;
  } else if (health.status === 'Suspended') {
    healthStatus = 'Progressing';
  }

  const commitMessage = source.path ? source.path : opState.message || 'GitOps synchronized';
  const syncedTimestamp = status.reconciledAt || opState.finishedAt || metadata.creationTimestamp;

  return {
    id: name,
    name,
    project: spec.project || 'default',
    repoUrl: source.repoURL || '',
    targetRevision: revisionDisplay,
    commitMessage,
    syncStatus,
    healthStatus,
    lastSyncedAt: formatRelativeTime(syncedTimestamp),
    serviceId: name,
  };
}

// Scrape Application CRDs from Kubernetes cluster
export async function fetchArgoApplications(): Promise<ArgoApplication[]> {
  const client = getK8sClient();

  if (!client.isConnected) {
    console.log('[Argo CRD] Simulation mode — returning default mock applications');
    cachedArgoApps = [...INITIAL_ARGO_APPS];
    lastArgoScannedAt = new Date().toISOString();
    return cachedArgoApps;
  }

  try {
    let items: any[] = [];
    try {
      const res = (await client.customObjectsApi.listClusterCustomObject({
        group: 'argoproj.io',
        version: 'v1alpha1',
        plural: 'applications',
      })) as { items?: any[] };
      items = Array.isArray(res?.items) ? res.items : [];
    } catch {
      try {
        const directRes = await k8sRequest<{ items?: any[] }>('/apis/argoproj.io/v1alpha1/applications');
        items = Array.isArray(directRes?.items) ? directRes.items : [];
      } catch (directErr: any) {
        try {
          const nsRes = await k8sRequest<{ items?: any[] }>('/apis/argoproj.io/v1alpha1/namespaces/argocd/applications');
          items = Array.isArray(nsRes?.items) ? nsRes.items : [];
        } catch (nsErr: any) {
          console.warn('[Argo CRD] Failed to fetch Argo applications: %s', nsErr?.message || directErr?.message || 'unknown error');
          items = [];
        }
      }
    }

    const apps = items
      .map(mapCrdToArgoApp)
      .sort((a, b) => a.name.localeCompare(b.name));

    cachedArgoApps = apps;
    lastArgoScannedAt = new Date().toISOString();
    console.log(`[Argo CRD] Scanned ${cachedArgoApps.length} ArgoCD applications from cluster.`);
    return cachedArgoApps;
  } catch (err: any) {
    console.error('[Argo CRD] Error fetching Argo applications: %s', err?.message || err);
    return cachedArgoApps;
  }
}

export function getCachedArgoApps(): ArgoApplication[] {
  return cachedArgoApps;
}

export function getLastArgoScannedAt(): string | null {
  return lastArgoScannedAt;
}

// Trigger reconciliation for a single ArgoCD application by patching the /operation field
export async function syncArgoApplication(
  name: string,
  namespace: string = 'argocd'
): Promise<{ success: boolean; name: string; message: string }> {
  if (!K8S_RESOURCE_NAME_REGEX.test(name)) {
    throw new Error(`Invalid application name: "${name}"`);
  }

  const client = getK8sClient();

  // Optimistically set cached app status to Syncing
  const targetApp = cachedArgoApps.find((a) => a.name === name);
  if (targetApp) {
    targetApp.syncStatus = 'Syncing';
  }

  if (!client.isConnected) {
    console.log(`[Argo CRD] (Simulation) Synced application: ${name}`);
    return {
      success: true,
      name,
      message: `Triggered sync for ${name} (simulation)`,
    };
  }

  try {
    const patchBody = [
      {
        op: 'add',
        path: '/operation',
        value: {
          initiatedBy: { username: 'launchpad' },
          sync: {
            prune: true,
            dryRun: false,
          },
        },
      },
    ];

    try {
      await client.customObjectsApi.patchNamespacedCustomObject({
        group: 'argoproj.io',
        version: 'v1alpha1',
        namespace,
        plural: 'applications',
        name,
        body: patchBody,
      });
    } catch {
      await k8sRequest(
        `/apis/argoproj.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/applications/${encodeURIComponent(name)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: patchBody,
        }
      );
    }

    console.log(`[Argo CRD] Successfully initiated sync for application: ${name}`);
    return {
      success: true,
      name,
      message: `Sync operation submitted to ArgoCD controller for ${name}`,
    };
  } catch (err: any) {
    console.error('[Argo CRD] Failed to sync application %s: %s', name, err?.response?.body?.message || err?.message || err);
    if (targetApp) {
      targetApp.syncStatus = 'OutOfSync';
    }
    throw new Error(err?.response?.body?.message || err?.message || `Failed to sync application ${name}`);
  }
}

// Trigger reconciliation across all OutOfSync applications
export async function syncAllArgoApplications(): Promise<{
  success: boolean;
  triggered: string[];
  count: number;
}> {
  const outOfSyncApps = cachedArgoApps.filter(
    (a) => a.syncStatus === 'OutOfSync' || a.syncStatus === 'Unknown'
  );

  const targets = outOfSyncApps.length > 0 ? outOfSyncApps : cachedArgoApps;
  const triggered: string[] = [];

  for (const app of targets) {
    try {
      await syncArgoApplication(app.name);
      triggered.push(app.name);
    } catch (err: any) {
      console.warn(`[Argo CRD] Batch sync failed for ${app.name}:`, err?.message || err);
    }
  }

  return {
    success: true,
    triggered,
    count: triggered.length,
  };
}

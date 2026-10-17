import dotenv from 'dotenv';
import { createApp } from './app';
import { broadcastServiceHealth, broadcastTelemetry } from './routes/api';
import { getK8sClient } from './k8s/client';
import { scanClusterRoutes } from './k8s/discovery';
import { fetchArgoApplications } from './k8s/argo';
import { fetchClusterTelemetry } from './k8s/telemetry';
import { getProbeConfig, startHealthProbeScheduler } from './health/probe';
import { getAuthConfig } from './auth/forwardAuth';
import { getPreferencesStore } from './preferences/store';
import { errorMessage } from './util/errorMessage';

dotenv.config();

const app = createApp();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);

function logAuthConfig() {
  const authConfig = getAuthConfig();
  if (authConfig.mode === 'none') {
    console.warn('[Auth] AUTH_MODE=none: every request is treated as an administrator.');
    return;
  }
  console.log(`[Auth] Authelia forward-auth enabled (admin groups: ${authConfig.adminGroups.join(', ')})`);
  if (authConfig.trustedProxies === 'none') {
    console.error(
      "[Auth] AUTH_TRUSTED_PROXIES is not set: identity headers are ignored and every user is signed out. Set the gateway IPs/CIDRs, or '*' if a NetworkPolicy restricts ingress to the gateway."
    );
  } else if (authConfig.trustedProxies === 'any') {
    console.warn('[Auth] Identity headers are trusted from any peer (AUTH_TRUSTED_PROXIES unset in development, or "*").');
  }
  if (authConfig.devUser) {
    console.warn(`[Auth] Development identity active for requests without headers: ${authConfig.devUser.username}`);
  }
}

function logPreferencesStore() {
  if (getPreferencesStore().kind === 'memory') {
    console.warn('[Preferences] VALKEY_URL is not set: preferences are kept in memory and lost on restart.');
  } else {
    console.log('[Preferences] Persisting preferences to Valkey.');
  }
}

async function warmUp(label: string, task: () => Promise<string>) {
  console.log(`[Server] Initializing ${label}...`);
  try {
    console.log(`[Server] ${await task()}`);
  } catch (err) {
    console.warn('[Server] Initial %s failed: %s', label, errorMessage(err));
  }
}

// Warm up route, ArgoCD and telemetry caches, then broadcast telemetry every 5s
async function startClusterSync() {
  const client = getK8sClient();
  if (!client.isConnected) {
    console.log('[Server] Kubernetes cluster not connected, operating in simulation mode.');
    return;
  }

  await warmUp(`cluster route scan against ${client.clusterServer}`, async () => {
    const routes = await scanClusterRoutes();
    return `Successfully discovered ${routes.length} HTTPRoutes in cluster.`;
  });
  await warmUp('ArgoCD applications scan', async () => {
    const apps = await fetchArgoApplications();
    return `Successfully discovered ${apps.length} ArgoCD applications in cluster.`;
  });
  await warmUp('cluster telemetry scan', async () => {
    const { telemetry, nodes } = await fetchClusterTelemetry();
    return `Telemetry initialized: ${nodes.length} nodes, ${telemetry.podsActive}/${telemetry.podsTotal} pods.`;
  });

  setInterval(async () => {
    try {
      broadcastTelemetry(await fetchClusterTelemetry(true));
    } catch {
      // Silently skip transient telemetry refresh errors in background loop
    }
  }, 5000);
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n==================================================`);
  console.log(`  Homelab Launchpad Backend Server`);
  console.log(`  Listening on: http://0.0.0.0:${PORT}`);
  console.log(`==================================================\n`);

  logAuthConfig();
  logPreferencesStore();

  // Service health probes run independently of cluster connectivity
  const probeConfig = getProbeConfig();
  startHealthProbeScheduler(broadcastServiceHealth);
  console.log(
    `[Server] Service health probes every ${probeConfig.intervalMs}ms (timeout ${probeConfig.timeoutMs}ms, domains: ${probeConfig.allowedDomains.join(', ') || 'discovered routes only'})`
  );

  await startClusterSync();
});

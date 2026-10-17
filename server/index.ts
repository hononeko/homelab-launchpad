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

dotenv.config();

const app = createApp();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n==================================================`);
  console.log(`  Homelab Launchpad Backend Server`);
  console.log(`  Listening on: http://0.0.0.0:${PORT}`);
  console.log(`==================================================\n`);

  const authConfig = getAuthConfig();
  if (authConfig.mode === 'none') {
    console.warn('[Auth] AUTH_MODE=none: every request is treated as an administrator.');
  } else {
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

  if (getPreferencesStore().kind === 'memory') {
    console.warn('[Preferences] VALKEY_URL is not set: preferences are kept in memory and lost on restart.');
  } else {
    console.log('[Preferences] Persisting preferences to Valkey.');
  }

  // Service health probes run independently of cluster connectivity
  const probeConfig = getProbeConfig();
  startHealthProbeScheduler(broadcastServiceHealth);
  console.log(
    `[Server] Service health probes every ${probeConfig.intervalMs}ms (timeout ${probeConfig.timeoutMs}ms, domains: ${probeConfig.allowedDomains.join(', ') || 'discovered routes only'})`
  );

  // Initialize K8s client and warm up route & argo cache
  const client = getK8sClient();
  if (client.isConnected) {
    console.log(`[Server] Initializing cluster route scan against ${client.clusterServer}...`);
    try {
      const routes = await scanClusterRoutes();
      console.log(`[Server] Successfully discovered ${routes.length} HTTPRoutes in cluster.`);
    } catch (err) {
      const safeErr = String((err as Error)?.message || err).replace(/\n|\r/g, '');
      console.warn('[Server] Initial cluster scan failed: %s', safeErr);
    }

    console.log(`[Server] Initializing ArgoCD applications scan...`);
    try {
      const apps = await fetchArgoApplications();
      console.log(`[Server] Successfully discovered ${apps.length} ArgoCD applications in cluster.`);
    } catch (err) {
      const safeErr = String((err as Error)?.message || err).replace(/\n|\r/g, '');
      console.warn('[Server] Initial ArgoCD applications scan failed: %s', safeErr);
    }

    console.log(`[Server] Initializing cluster telemetry scan...`);
    try {
      const { telemetry, nodes } = await fetchClusterTelemetry();
      console.log(`[Server] Telemetry initialized: ${nodes.length} nodes, ${telemetry.podsActive}/${telemetry.podsTotal} pods.`);
    } catch (err) {
      const safeErr = String((err as Error)?.message || err).replace(/\n|\r/g, '');
      console.warn('[Server] Initial cluster telemetry scan failed: %s', safeErr);
    }

    // Periodic telemetry update broadcast every 5s
    setInterval(async () => {
      try {
        const data = await fetchClusterTelemetry(true);
        broadcastTelemetry(data);
      } catch {
        // Silently skip transient telemetry refresh errors in background loop
      }
    }, 5000);
  } else {
    console.log('[Server] Kubernetes cluster not connected, operating in simulation mode.');
  }
});

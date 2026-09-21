import * as k8s from '@kubernetes/client-node';

export interface K8sClientContext {
  kc: k8s.KubeConfig;
  customObjectsApi: k8s.CustomObjectsApi;
  networkingV1Api: k8s.NetworkingV1Api;
  coreV1Api: k8s.CoreV1Api;
  isConnected: boolean;
  connectionMode: 'cluster' | 'kubeconfig' | 'simulation';
  clusterServer: string;
}

let clientContext: K8sClientContext | null = null;

export function getK8sClient(): K8sClientContext {
  if (clientContext) {
    return clientContext;
  }

  const kc = new k8s.KubeConfig();
  let isConnected = false;
  let connectionMode: 'cluster' | 'kubeconfig' | 'simulation' = 'simulation';
  let clusterServer = '';

  try {
    kc.loadFromDefault();
    const currentCluster = kc.getCurrentCluster();
    if (currentCluster?.server) {
      isConnected = true;
      clusterServer = currentCluster.server;
      connectionMode = process.env.KUBERNETES_SERVICE_HOST ? 'cluster' : 'kubeconfig';
      console.log(`[K8s Client] Successfully loaded context (${connectionMode}) targeting ${clusterServer}`);
    } else {
      console.warn('[K8s Client] No active cluster server found in config, running in simulation mode');
    }
  } catch (err) {
    console.warn('[K8s Client] Could not load Kubernetes configuration, falling back to simulation mode:', err);
    isConnected = false;
    connectionMode = 'simulation';
  }

  const customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
  const networkingV1Api = kc.makeApiClient(k8s.NetworkingV1Api);
  const coreV1Api = kc.makeApiClient(k8s.CoreV1Api);

  clientContext = {
    kc,
    customObjectsApi,
    networkingV1Api,
    coreV1Api,
    isConnected,
    connectionMode,
    clusterServer,
  };

  return clientContext;
}

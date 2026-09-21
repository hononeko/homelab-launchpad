import fs from 'node:fs';
import https from 'node:https';
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
let resolvedCert: Buffer | undefined;
let resolvedKey: Buffer | undefined;
let resolvedCa: Buffer | undefined;
let resolvedToken: string | undefined;
let skipTlsVerify = false;

function resolveBuffer(data?: string, filePath?: string): Buffer | undefined {
  if (data) {
    return Buffer.from(data, 'base64');
  }
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath);
  }
  return undefined;
}

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
    const currentUser = kc.getCurrentUser();

    if (currentCluster?.server) {
      isConnected = true;
      clusterServer = currentCluster.server;
      connectionMode = process.env.KUBERNETES_SERVICE_HOST ? 'cluster' : 'kubeconfig';
      skipTlsVerify = Boolean(currentCluster.skipTLSVerify);

      resolvedCert = resolveBuffer(currentUser?.certData, currentUser?.certFile);
      resolvedKey = resolveBuffer(currentUser?.keyData, currentUser?.keyFile);
      resolvedCa = resolveBuffer(currentCluster.caData, currentCluster.caFile);

      if (currentUser?.token) {
        resolvedToken = currentUser.token;
      } else if (process.env.KUBERNETES_SERVICE_HOST) {
        const saTokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
        if (fs.existsSync(saTokenPath)) {
          resolvedToken = fs.readFileSync(saTokenPath, 'utf8').trim();
        }
      }

      console.log(`[K8s Client] Successfully loaded context (${connectionMode}) targeting ${clusterServer}`);
    } else {
      console.warn('[K8s Client] No active cluster server found in config, running in simulation mode');
    }
  } catch (err) {
    const safeErr = String((err as Error)?.message || err).replace(/\n|\r/g, '');
    console.warn('[K8s Client] Could not load Kubernetes configuration, falling back to simulation mode: %s', safeErr);
    isConnected = false;
    connectionMode = 'simulation';
  }

  if (!isConnected) {
    kc.loadFromClusterAndUser({ name: 'simulation', server: 'http://localhost', skipTLSVerify: true }, { name: 'simulation' });
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

export interface K8sRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Executes a direct HTTPS request against the Kubernetes API server using the active credentials
 * (supporting mTLS client certificates, ServiceAccount bearer tokens, and cluster CA verification).
 */
export function k8sRequest<T>(
  endpoint: string,
  optionsOrTimeout: number | K8sRequestOptions = 8000
): Promise<T> {
  const options: K8sRequestOptions =
    typeof optionsOrTimeout === 'number'
      ? { timeoutMs: optionsOrTimeout }
      : optionsOrTimeout;

  const method = options.method || 'GET';
  const timeoutMs = options.timeoutMs ?? 8000;
  const client = getK8sClient();

  if (!client.isConnected || !client.clusterServer) {
    return Promise.reject(new Error('Kubernetes cluster is not connected or in simulation mode'));
  }

  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(endpoint, client.clusterServer);
    } catch (urlErr) {
      return reject(urlErr);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    let requestBody: string | undefined;
    if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        requestBody = options.body;
      } else {
        requestBody = JSON.stringify(options.body);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
      headers['Content-Length'] = String(Buffer.byteLength(requestBody));
    }

    if (resolvedToken) {
      headers.Authorization = `Bearer ${resolvedToken}`;
    }

    const req = https.request(
      url,
      {
        method,
        headers,
        cert: resolvedCert,
        key: resolvedKey,
        ca: resolvedCa,
        rejectUnauthorized: !skipTlsVerify && !!resolvedCa,
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const statusCode = res.statusCode || 0;
          if (statusCode >= 200 && statusCode < 300) {
            try {
              resolve(body ? (JSON.parse(body) as T) : ({} as T));
            } catch {
              reject(new Error('Failed to parse Kubernetes API JSON response'));
            }
          } else {
            reject(new Error(`Kubernetes API error HTTP ${statusCode}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Kubernetes API request timed out after ${timeoutMs}ms`));
    });

    req.on('error', () => {
      reject(new Error('Kubernetes API request failed due to a network error'));
    });

    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

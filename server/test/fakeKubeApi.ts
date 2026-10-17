import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { resetK8sClient } from '../k8s/client';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  // Sent verbatim instead of JSON-encoding `body`
  raw?: string;
  delayMs?: number;
  // Drops the connection without responding
  reset?: boolean;
}

export type FakeHandler = FakeReply | ((req: RecordedRequest, callCount: number) => FakeReply);

export interface FakeCluster {
  url: string;
  requests: RecordedRequest[];
  /** Registers a reply for `"<METHOD> <path>"`, e.g. `"GET /api/v1/nodes"`. */
  on(route: string, handler: FakeHandler): void;
  reset(): void;
  close(): Promise<void>;
}

export const FAKE_TOKEN = 'test-token';

function resolveReply(handler: FakeHandler | undefined, req: RecordedRequest, count: number): FakeReply {
  if (!handler) return { status: 404, body: { kind: 'Status', message: 'not found' } };
  return typeof handler === 'function' ? handler(req, count) : handler;
}

/**
 * Starts a fake Kubernetes API server over plain HTTP and points the shared
 * K8s client at it through a generated kubeconfig. Unregistered routes return
 * 404. `close()` restores simulation mode (KUBECONFIG=/dev/null).
 */
export async function startFakeCluster(): Promise<FakeCluster> {
  const handlers = new Map<string, FakeHandler>();
  const callCounts = new Map<string, number>();
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const recorded: RecordedRequest = { method: req.method ?? 'GET', path: pathname, headers: req.headers, body };
      requests.push(recorded);

      const key = `${recorded.method} ${pathname}`;
      const count = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, count);

      const reply = resolveReply(handlers.get(key), recorded, count);

      const send = () => {
        if (res.destroyed) return;
        if (reply.reset) {
          req.socket.destroy();
          return;
        }
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body)));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const kubeconfigPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-kube-')), 'config');
  fs.writeFileSync(
    kubeconfigPath,
    [
      'apiVersion: v1',
      'kind: Config',
      'clusters:',
      // client-node refuses plain HTTP servers unless TLS verification is skipped
      `  - name: fake\n    cluster:\n      server: ${url}\n      insecure-skip-tls-verify: true`,
      'users:',
      `  - name: fake\n    user:\n      token: ${FAKE_TOKEN}`,
      'contexts:',
      '  - name: fake\n    context:\n      cluster: fake\n      user: fake',
      'current-context: fake',
      '',
    ].join('\n')
  );
  process.env.KUBECONFIG = kubeconfigPath;
  resetK8sClient();

  return {
    url,
    requests,
    on(route, handler) {
      handlers.set(route, handler);
    },
    reset() {
      handlers.clear();
      callCounts.clear();
      requests.length = 0;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(path.dirname(kubeconfigPath), { recursive: true, force: true });
      process.env.KUBECONFIG = '/dev/null';
      resetK8sClient();
    },
  };
}

# Homelab Launchpad

<div align="center">

![Homelab Launchpad](public/logo.png)

**Modular Homelab Startpage & Operations Dashboard**  
*With Kubernetes Gateway API Auto-Discovery, ArgoCD GitOps Sync Monitoring, and Real-Time Cluster Telemetry*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB.svg?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-38B2AC.svg?logo=tailwind-css)](https://tailwindcss.com/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF.svg?logo=vite)](https://vitejs.dev/)
[![Kaneo](https://img.shields.io/badge/Kaneo-Project%20HLP-7F52FF.svg)](https://kaneo.kerrlab.app)

</div>

---

## Overview

**Homelab Launchpad** is the unified central navigation hub for the homelab environment (`kerrlab.app`). It bridges user application launching with live Kubernetes cluster observability, automated route discovery via Gateway API, and GitOps state monitoring through ArgoCD.

For the full architectural specification, see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Key Capabilities

- **Categorized Service Matrix:** Pinned and categorized access across `MEDIA`, `HOME & LIVING`, `TOOLS & DEV`, and `CLUSTER & OPS`.
- **Command Palette (`⌘K` / `/`):** Lightning-fast fuzzy search with keyboard navigation and quick action commands (`> sync all`, `> scan routes`).
- **Gateway API Auto-Discovery:** Native discovery of Kubernetes Gateway API `HTTPRoute` and `Ingress` resources with automatic categorization and 1-click import.
- **ArgoCD GitOps Sync:** Live tracking of application synchronization states (`Synced`, `OutOfSync`, `Syncing`) and direct reconciliation triggers.
- **Real-Time Cluster Telemetry:** Live pod counts, aggregated CPU load, NVMe storage pool metrics, and individual node statuses via `ClusterModal`.
- **Authelia Forward-Auth Ready:** Integrated header inspection (`Remote-User`, `Remote-Groups`) for personalized and role-gated access control.

---

## Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                        CILIUM GATEWAY API (L7) / TRAEFIK                          |
|                       Routes: kerrlab.app / launch.kerrlab.app                    |
+-----------------------------------------------------------------------------------+
         │                                              │
  Forward-Auth Verify                              HTTP Route
         ▼                                              ▼
+-----------------------+              +--------------------------------------------+
|      AUTHELIA         |              |        KERRLAB LAUNCHPAD SERVICE           |
| (auth.kerrlab.app)    |              |  - React 19 Frontend (Vite)                |
| SSO / Forward-Auth    |              |  - Express / Node.js API Backend           |
+-----------------------+              +--------------------------------------------+
                                                    │
             ┌─────────────────────────┬────────────┴─────────────┬─────────────────┐
             ▼                         ▼                          ▼                 ▼
+-------------------------+ +---------------------+ +--------------------+ +----------------+
|     K8S API SERVER      | |     ARGOCD API      | | PROMETHEUS / METRICS| | VALKEY / DB    |
| - HTTPRoute Informer    | | - Sync State        | | - Pod / CPU Usage  | | - Pinned Items |
| - Ingress Informer      | | - Health State      | | - Storage Pools    | | - Launch Stats |
+-------------------------+ +---------------------+ +--------------------+ +----------------+
```

---

## Getting Started (Local Development)

### Prerequisites
- Docker
- [Dev Container CLI](https://github.com/devcontainers/cli) (or VS Code Dev Containers)

All dependency installs, builds, and repo scripts run inside the dev container
(`.devcontainer/`), never on the host. The container runs as an unprivileged user
with all Linux capabilities dropped, `no-new-privileges`, no Docker socket, and
`node_modules` kept in a named volume.

### Setup
1. Start the dev container (installs dependencies with `--ignore-scripts`):
   ```bash
   devcontainer up --workspace-folder .
   ```
2. Start the backend and the Vite dev server:
   ```bash
   devcontainer exec --workspace-folder . bun run server
   devcontainer exec --workspace-folder . bun run dev
   ```
   The application will be accessible at `http://localhost:3000`.

3. Typecheck, unit tests, and production build:
   ```bash
   devcontainer exec --workspace-folder . bun run lint
   devcontainer exec --workspace-folder . bun run test:unit
   devcontainer exec --workspace-folder . bun run build
   ```

### Testing

Tests use Bun's built-in runner (`bun test`) in two separate runs, so the browser DOM never leaks into server tests:

| Script | Scope |
|---|---|
| `test:server` | `server/**/*.test.ts`. Kubernetes access runs against a fake API server (`server/test/fakeKubeApi.ts`) in connected mode, or in simulation mode (`KUBECONFIG=/dev/null`), so tests never reach a real cluster. |
| `test:client` | `src/**/*.test.tsx` with happy-dom and Testing Library (preloaded from `src/test/setup.ts`) |
| `test:unit` | Both of the above |
| `test:coverage` | Both, with LCOV reports in `coverage/{server,client}/lcov.info` and the per-file floors from `bunfig.toml` |

CI runs `test:coverage`. The **SonarCloud Analysis** workflow uploads both reports once the `SONAR_TOKEN` secret is set and SonarCloud's automatic analysis is turned off.

### Authentication & Access Control (Authelia)

The backend reads Authelia forward-auth headers set by the gateway: `Remote-User`,
`Remote-Name`, `Remote-Email` and `Remote-Groups`. Members of `AUTH_ADMIN_GROUPS` are
**admins**; every other signed-in user is a **viewer**.

| Capability | Admin | Viewer | Signed out |
|---|---|---|---|
| Services in `AUTH_VIEWER_CATEGORIES` | ✅ | ✅ | — |
| All other categories, GitOps, cluster telemetry, Config | ✅ | — | — |
| Route discovery/import, ArgoCD sync, telemetry refresh | ✅ | — | — |
| Service health probes | all results | own registered URLs only | — |
| `GET /api/health` | full detail | status only | status only |

`GET /api/auth/me` returns the current session. State-changing requests must be
same-origin (`Sec-Fetch-Site: same-origin`, or a matching `Origin` on older browsers).
Requests from sibling subdomains are rejected, because the SSO cookie is shared across
the domain.

| Variable | Default | Description |
|---|---|---|
| `AUTH_MODE` | `forward-auth` | `none` disables authentication and treats every request as an admin |
| `AUTH_ADMIN_GROUPS` | `admins` | Comma-separated Authelia groups that grant admin access |
| `AUTH_VIEWER_CATEGORIES` | `MEDIA,HOME & LIVING` | Service categories visible to viewers |
| `AUTH_TRUSTED_PROXIES` | _(unset)_ | Comma-separated IPs/CIDRs of the gateway; identity headers from any other peer are ignored. Use `*` to trust every peer **only** when a NetworkPolicy already limits ingress to the gateway. When unset, development trusts every peer and **production trusts none** (everyone is signed out), so a missing setting fails closed. |
| `AUTH_DEV_USER` / `AUTH_DEV_GROUPS` | _(unset)_ | Local development identity used when no headers are present. Ignored when `NODE_ENV=production`. |

> The gateway must **overwrite** any client-supplied `Remote-*` headers with Authelia's
> response (Traefik `authResponseHeaders`, or the equivalent for Envoy `ext_authz` on
> Cilium Gateway). Otherwise a client could set them itself.
>
> Do not set `AUTH_TRUSTED_PROXIES` to the cluster-wide pod CIDR: that trusts every pod,
> so any workload could call the service directly with forged headers. Prefer a
> NetworkPolicy that only admits the gateway, combined with `*` or the gateway's
> addresses (Traefik pod IPs, or the node IPs when Cilium's Envoy proxies the traffic).

For local development, start the backend with an identity, e.g.
`AUTH_DEV_USER=dev AUTH_DEV_GROUPS=admins bun run server`.

### User Preferences (Valkey)

Each signed-in user's launchpad follows them across devices. The synced state is the service catalog (its order is the display order, plus pins), hidden categories, the default tab, and the ArgoCD and auto-import toggles. It is stored per Authelia user (`Remote-User`); with `AUTH_MODE=none`, everyone shares the `anonymous` profile. Launch counters are incremented atomically on the server. `localStorage` remains the offline cache: if the server can't be reached, changes stay local and are never pushed over the server profile.

| Endpoint | Description |
|---|---|
| `GET /api/user/preferences` | The user's preferences with launch stats merged in, or `null` before the first save |
| `PUT /api/user/preferences` | Save preferences (validated; at most 300 services) |
| `POST /api/services/:id/launch` | Increment the launch counter and record the time, for services in the user's saved catalog (404 otherwise). Counters of services removed from the catalog are dropped on save. |

| Variable | Default | Description |
|---|---|---|
| `VALKEY_URL` | _(unset)_ | e.g. `redis://launchpad-valkey:6379`. When unset, preferences are kept **in memory** and lost on restart (a warning is logged). |

> Deployment: unlike the cache-only Valkey instances elsewhere in the cluster, this one must
> persist data. Run it with `--appendonly yes` on a persistent volume (e.g. `longhorn-retain`).

### Service Health Probes

The backend probes every service URL registered by the dashboard (HEAD, falling back
to GET on 405/501) and streams results over SSE (`health:updated`). Any response
below 500, including Authelia redirects and 401/403, counts as reachable; 5xx is
`degraded`; connection, DNS, and timeout failures are `offline`.

| Variable | Default | Description |
|---|---|---|
| `HEALTH_PROBE_INTERVAL_MS` | `30000` | Interval between background probe rounds |
| `HEALTH_PROBE_TIMEOUT_MS` | `3000` | Per-request timeout |
| `HEALTH_PROBE_CONCURRENCY` | `8` | Maximum simultaneous probes |
| `HEALTH_PROBE_ALLOWED_DOMAINS` | `kerrlab.app` | Comma-separated domains (and subdomains) that may be probed; `*` allows any host. Hosts of discovered HTTPRoutes are always allowed. |
| `HEALTH_PROBE_INSECURE_TLS` | `false` | Skip TLS certificate verification (internal CAs) |

Endpoints: `GET /api/services/health`, `POST /api/services/health/targets` (`{ "urls": [...] }`),
`POST /api/services/health/probe` (on-demand, throttled to once per 5s).

---

## Project Management (Kaneo)

Project planning and tasks are tracked in the **Kerrlab Kaneo Workspace**:
- **Project Name:** `Homelab Launchpad`
- **Slug:** `HLP`
- **Tasks:**
  - `[#1]` Architecture & requirements specification (Completed)
  - `[#2]` Backend service for Gateway API & Ingress route discovery
  - `[#3]` ArgoCD REST API client for application sync & health tracking
  - `[#4]` Prometheus & Metrics Server cluster telemetry integration
  - `[#5]` Background service health check probes & latency ping
  - `[#6]` Authelia forward-auth & role-based access controls
  - `[#7]` Persistent user preferences via database/Valkey
  - `[#8]` Enhanced Command Palette with fuzzy search & quick actions
  - `[#9]` Multi-stage Dockerfile build & GitHub Actions CI/CD to GHCR
  - `[#10]` Kustomize manifests & ArgoCD Application in `homelab-k8s`
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
- **Command Palette (`⌘K` / `/`):** Fuzzy search over service names, addresses, categories and descriptions. `↑`/`↓` move, `Enter` launches, `Shift+Enter` copies the URL, `Tab` cycles category filters. Type `>` for commands: go to a view, and for administrators scan routes, open route discovery or cluster telemetry, and sync or refresh ArgoCD.
- **Gateway API Auto-Discovery:** Native discovery of Kubernetes Gateway API `HTTPRoute` and `Ingress` resources with automatic categorization and 1-click import.
- **ArgoCD GitOps Sync:** Live tracking of application synchronization states (`Synced`, `OutOfSync`, `Syncing`) and direct reconciliation triggers.
- **Real-Time Cluster Telemetry:** Live pod counts, aggregated CPU load, NVMe storage pool metrics, and individual node statuses via `ClusterModal`.
- **Authelia Forward-Auth Ready:** Integrated header inspection (`Remote-User`, `Remote-Groups`) for personalized and role-gated access control.

---

## Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                             TRAEFIK GATEWAY API (L7)                              |
|                       Route: kerrlab.app (internal gateway)                       |
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

CI runs `test:coverage`, and the Sonar job uploads both reports to SonarCloud.

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

Each signed-in user's launchpad follows them across devices. The synced state is the service catalog (its order is the display order, plus pins, hidden services, and any names and icons the user changed), hidden categories, hidden discovery routes, the default tab, and the ArgoCD and auto-import toggles. It is stored per Authelia user (`Remote-User`); with `AUTH_MODE=none`, everyone shares the `anonymous` profile. Launch counters are incremented atomically on the server. `localStorage` remains the offline cache: if the server can't be reached, changes stay local and are never pushed over the server profile.

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

### Route Discovery

Administrators import services from the cluster's Gateway API HTTPRoutes and Ingresses. When several HTTPRoutes serve the same host (typically an internal and an external twin), discovery lists it once: it prefers a route attached to an internal gateway over an external-only one, and otherwise a route whose name doesn't contain `external`. The other routes are shown as alternates. Routes without any backend (redirect-only or empty) are skipped.

Routes can be left out of discovery on the server, for every user:

| Setting | Description |
|---|---|
| `DISCOVERY_EXCLUDE_NAMESPACES` | Comma-separated namespaces whose routes are never listed, e.g. `kube-system,cert-manager` |
| `DISCOVERY_EXCLUDE_HOSTS` | Comma-separated host globs (`*` matches anything, case-insensitive), e.g. `*-webhook.kerrlab.app,metrics.*` |
| Annotation `launchpad.kerrlab.app/hidden: "true"` | Set on an HTTPRoute or Ingress to leave it out |

The discovery dialog lists excluded routes with the reason. Each user can also hide routes from their own discovery list, and hide services from their dashboard; hidden services are listed at the bottom of the Services view to unhide.

#### Category and icon rules

Each discovered route gets a suggested category and icon. Keyword rules are tried in order against the route's name, namespace, host and backend; the first match wins. Otherwise the route's namespace decides, and anything else falls back to Tools & Dev with a generic icon. The built-in rules live in [`server/config/category-mappings.json`](server/config/category-mappings.json).

Administrators can change the rules under **Settings → Category & icon rules**, and set the name, category and icon of a single host from the adjust button in the discovery dialog. Changes apply to every administrator and re-classify the discovered routes straight away. Services already on someone's launchpad keep their name and icon. The rules are stored in Valkey (in memory without `VALKEY_URL`); **Reset to defaults** goes back to the bundled file.

| Endpoint (administrators only) | Description |
|---|---|
| `GET /api/config/mappings` | Active rules, the bundled defaults, and whether they were customized |
| `PUT /api/config/mappings` | Replace the rules (`appRules`, `namespaceRules`, `overrides`) |
| `POST /api/config/mappings/reset` | Go back to the bundled defaults |
| `PUT` / `DELETE /api/config/mappings/overrides/:host` | Set or remove one host's `name`, `category` and `icon` |

### On-Demand Workloads (Sleep / Wake)

Administrators can put heavy, single-instance workloads (game servers, dev environments) to sleep at 0 replicas and wake them at 1, from an **On-demand workloads** panel on the Overview. A workload opts in with annotations on its Deployment or StatefulSet:

| Annotation | Description |
|---|---|
| `launchpad.kerrlab.app/scalable: "true"` | Lists the workload with a start/stop control |
| `launchpad.kerrlab.app/host: app.example.com` | Optional. Links it to the service card with that host: the card gets a power button, shows when the service is sleeping or starting, and launching it while asleep offers to start it instead |

Only namespaces listed in `SCALE_NAMESPACES` (comma-separated, e.g. `games`) are looked at. The server only ever sets 0 or 1 replicas, and refuses workloads that run more than one. In simulation mode two sample workloads are listed.

The launchpad needs a Role in each of those namespaces:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: launchpad-workload-scaler
  namespace: games
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets"]
    verbs: ["get", "list"]
  - apiGroups: ["apps"]
    resources: ["deployments/scale", "statefulsets/scale"]
    verbs: ["patch"]
```

…bound to the launchpad's ServiceAccount with a RoleBinding.

**GitOps:** leave `replicas` out of the workload's manifest (Kubernetes defaults it to 1), so ArgoCD doesn't own the field. A sleeping workload then doesn't show as OutOfSync, and a sync doesn't wake it. If the manifest must keep `replicas`, add an `ignoreDifferences` entry for `/spec/replicas` on that workload to its Application.

| Endpoint (administrators only) | Description |
|---|---|
| `GET /api/workloads` | Opted-in workloads with desired and ready replicas and a state: `running`, `stopped`, `starting` or `stopping` |
| `POST /api/workloads/:namespace/:kind/:name/scale` | Body `{ "replicas": 0 \| 1 }`; `kind` is `deployment` or `statefulset` |

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

## CI/CD & Releases

Same model as the other container repositories, built on the shared actions in [hononeko/actions](https://github.com/hononeko/actions): `bun-setup`, `version`, `release-notes` and `smoke-test`.

| Workflow | When | What |
|---|---|---|
| `pr.yml` | Pull requests | **validate** (lint, tests with coverage against a Valkey service, build, smoke test), **sonar**, and **image** (amd64 + arm64 built natively, smoke-tested, not pushed) |
| `main.yml` | Push to `main` | The same, then publishes a multi-arch **release candidate** to `ghcr.io/hononeko/homelab-launchpad` as `X.Y.Z-rc.N`, `sha-<commit>` and `edge`, with build-provenance attestation |
| `cd.yml` | Manual (`workflow_dispatch`) | Promotes this commit's release candidate (same digest, no rebuild) to `X.Y.Z` and `latest`, creates the GitHub Release with grouped notes, and prunes that version's candidate tags. `dry_run` shows all of this without changing anything; only `main` publishes. |

- **Versions** come from [Conventional Commits](https://www.conventionalcommits.org/): `feat` gives a minor bump, `!` or `BREAKING CHANGE:` a major one, and `docs`/`test` nothing.
- **Pinning:** Bun is pinned in `.bun-version` (CI) and in the Dockerfile's `oven/bun:<version>-alpine`. Renovate updates both together with `@types/bun`.

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
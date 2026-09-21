# Homelab Launchpad — Architecture & Requirements Specification

> **Version:** 1.0.0  
> **Status:** Approved / Active  
> **Target Environment:** Talos Linux / Kubernetes Homelab (`kerrlab.app`)  
> **Ingress & Gateway:** Cilium Gateway API L7 (`gateway.networking.k8s.io`)  
> **GitOps Engine:** ArgoCD v2.13+  
> **Authentication:** Authelia SSO Forward-Auth (`auth.kerrlab.app`)  

---

## 1. Executive Summary & Vision

**Homelab Launchpad** is the centralized mission control and smart startpage for the homelab infrastructure. Designed to replace static bookmark dashboards, the Launchpad acts as an active, Kubernetes-native interface combining:
- **Instant Service Navigation & Launchpad:** High-speed, categorized, and pinned access to all self-hosted homelab applications with active usage metrics and latency indicators.
- **Dynamic Gateway API Auto-Discovery:** Automated detection and synchronization of services exposed via Kubernetes Gateway API `HTTPRoute` and `Ingress` resources across namespaces.
- **GitOps Continuous Deployment Observability:** Direct integration with the in-cluster ArgoCD API to display real-time sync status (`Synced`, `OutOfSync`, `Syncing`), application health, and on-demand reconciliation.
- **Real-Time Cluster Telemetry:** Live operational awareness including active pod counts against cluster capacity, aggregate CPU core load, NVMe storage pool utilization (via Longhorn/Synology CSI), and network RTT latency.
- **Secure Zero-Trust Access:** Seamless integration with Authelia forward-auth for user identity resolution, role-based view filtering, and protected administrative operations.

```
+-----------------------------------------------------------------------------------+
|                                 USER BROWSER                                      |
|            (Web UI: React 19 + TypeScript + Tailwind CSS 4 + Motion)              |
+-----------------------------------------------------------------------------------+
                                         │
                         HTTPS Requests / WebSocket SSE
                                         ▼
+-----------------------------------------------------------------------------------+
|                        CILIUM GATEWAY API (L7) / TRAEFIK                          |
|                       Routes: kerrlab.app / launch.kerrlab.app                    |
+-----------------------------------------------------------------------------------+
         │                                              │
  Forward-Auth Verify                              HTTP Route
         ▼                                              ▼
+-----------------------+              +--------------------------------------------+
|      AUTHELIA         |              |        KERRLAB LAUNCHPAD SERVICE           |
| (auth.kerrlab.app)    |              |  - Express / Node.js API Backend           |
| SSO / Forward-Auth    |              |  - React Single Page App (Vite)            |
+-----------------------+              +--------------------------------------------+
                                                    │
             ┌─────────────────────────┬────────────┴─────────────┬─────────────────┐
             ▼                         ▼                          ▼                 ▼
+-------------------------+ +---------------------+ +--------------------+ +----------------+
|     K8S API SERVER      | |     ARGOCD API      | | PROMETHEUS / METRICS| | VALKEY / DB    |
| - HTTPRoute Informer    | | - Sync State        | | - Pod / CPU Usage  | | - Pinned Items |
| - Ingress Informer      | | - Health State      | | - Storage Pools    | | - Launch Stats |
| - Node Status Watch     | | - Manual Trigger    | | - Network RTT      | | - Custom URLs  |
+-------------------------+ +---------------------+ +--------------------+ +----------------+
```

---

## 2. Core Architecture Pillars

### 2.1 Pillar I: Service Matrix & Launch Navigation
- **Categorization:** Logical segregation into four primary homelab domains:
  - `MEDIA`: Streaming and content management (Plex, Jellyfin, Sonarr, Radarr, Prowlarr, Bazarr, etc.).
  - `HOME & LIVING`: IoT and home life (Home Assistant, Mealie, Bar Assistant, Miniflux).
  - `TOOLS & DEV`: Development tools and utilities (IT-Tools, Kaneo, Keeper, Excalidraw, BentoPDF).
  - `CLUSTER & OPS`: Infrastructure management (ArgoCD, Grafana, Headlamp, Uptime Kuma).
- **Usage Metrics & Pinning:**
  - Pinning flag (`isPinned`) for high-priority quick access.
  - Weekly launch counter (`launchesPerWeek`) and relative timestamping (`lastAccessed`).
- **Command Palette (`⌘K` / `/`):**
  - Instant keyboard modal with fuzzy search across title, URL, description, and categories.
  - Quick action commands (`> sync all`, `> scan routes`, `> copy url`).

### 2.2 Pillar II: Kubernetes Gateway API Auto-Discovery
- **Gateway API Native:** Tracks `HTTPRoute` resources in group `gateway.networking.k8s.io/v1` and legacy `Ingress` (`networking.k8s.io/v1`).
- **Target Extraction:** Extracts exposed hostname (`spec.hostnames`), parent gateway (`spec.parentRefs`), path prefixes (`spec.rules.matches.path`), and backend target services (`spec.rules.backendRefs`).
- **Smart Category & Icon Inference:** Automatically maps Kubernetes namespaces (`media`, `home`, `iot`, `system`, `tools`) to Launchpad categories and standard Material Symbols.
- **Auto-Sync Mode:** Allows optional automatic import of newly deployed routes into the active dashboard.

### 2.3 Pillar III: ArgoCD GitOps Integration
- **Direct Kubernetes CRD Discovery:** Interacts directly with native `Application.argoproj.io/v1alpha1` custom resources via in-cluster `ServiceAccount` credentials (or local kubeconfig during development)—zero static secrets or tokens required.
- **Live Sync & Health States:**
  - Sync: `Synced` (green), `OutOfSync` (amber), `Syncing` (pulsing amber/blue), `Unknown` (slate).
  - Health: `Healthy`, `Progressing`, `Degraded`, `Missing`.
- **Native Controller Reconciliation Actions:**
  - Per-service manual sync button directly on service cards and GitOps view, patching `/operation` with `{ sync: { prune: true } }` to trigger the ArgoCD controller.
  - Global "Sync All" button to batch reconcile all OutOfSync applications across the homelab cluster.
  - SSE-powered live status updates (`argo:syncing`, `argo:updated`) without page refreshes.

### 2.4 Pillar IV: Operational Telemetry & Infrastructure Health
- **Telemetry Strip:** Displays real-time gateway reachability, CoreDNS status, Cilium CNI operational status, and gateway RTT latency.
- **Cluster Operations Modal (`ClusterModal`):**
  - **Pods Active:** Running pods vs total allocatable capacity (`sum(kube_pod_status_phase{phase="Running"})` / allocatable).
  - **Aggregate CPU Cores:** Total cluster core utilization percentage.
  - **NVMe Storage Pool:** Pool utilization and capacity for distributed storage (Longhorn / Synology CSI).
  - **Ingress Rate:** Network bandwidth throughput and traffic states.
  - **Node Matrix:** Control plane and worker node condition, IP address, uptime, CPU/memory usage, and Talos version.

### 2.5 Pillar V: Security, Access Control & Forward-Auth
- **Authelia Forward-Auth Integration:**
  - Receives `Remote-User`, `Remote-Email`, and `Remote-Groups` headers from the ingress gateway.
  - Unauthenticated access is denied at the gateway or presented in guest-restricted mode.
- **Role-Based Action Boundaries:**
  - `admin`: Can import routes, edit cluster config, trigger ArgoCD synchronizations, and configure domains.
  - `user` / `family`: View-only service launching restricted to allowed categories.

---

## 3. Data Flow & Sequence Architecture

```
User Browser                      Launchpad Backend                    K8s API / ArgoCD / Prometheus
     │                                    │                                           │
     ├─── 1. Load Page (GET /) ──────────>│                                           │
     │    [Headers: Remote-User]          ├─── 2. Fetch User Prefs from DB ──────────>│
     │                                    ├─── 3. Query Active HTTPRoutes ───────────>│
     │                                    ├─── 4. Query ArgoCD App Sync States ──────>│
     │                                    ├─── 5. Query Prometheus Telemetry ────────>│
     │                                    │<── 6. Aggregate Response ─────────────────┤
     │<── 7. Render Complete Dashboard ───┤                                           │
     │                                    │                                           │
     ├─── 8. User clicks "Sync App" ─────>│                                           │
     │                                    ├─── 9. POST /api/v1/applications/:name/sync┤
     │                                    │<── 10. Sync Accepted (200 OK) ────────────┤
     │<── 11. WebSocket Event (Syncing) ──┤                                           │
     │<── 12. WebSocket Event (Synced) ───┤                                           │
```

---

## 4. REST API Specification

### 4.1 Route Discovery (`/api/routes`)
- `GET /api/routes`: Returns list of all discovered HTTPRoutes and Ingresses.
  ```json
  [
    {
      "id": "route-hass",
      "name": "home-assistant",
      "namespace": "iot",
      "host": "hass.kerrlab.app",
      "path": "/",
      "gateway": "cilium-gateway-l7",
      "backendService": "home-assistant-svc",
      "port": 8123,
      "tlsEnabled": true,
      "status": "imported",
      "suggestedCategory": "HOME & LIVING",
      "suggestedIcon": "home_iot_device"
    }
  ]
  ```
- `POST /api/routes/import`: Imports selected discovered routes into user dashboard.
- `GET /api/routes/stream`: Server-Sent Events (SSE) streaming route additions/deletions.

### 4.2 ArgoCD Integration (`/api/argo`)
- `GET /api/argo/applications`: Returns list of monitored GitOps applications.
- `POST /api/argo/applications/:name/sync`: Triggers synchronization of a specific application.
- `POST /api/argo/sync-all`: Triggers batch synchronization across all homelab apps.

### 4.3 Telemetry (`/api/telemetry`)
- `GET /api/telemetry`: Returns aggregated cluster telemetry (cached with 5-second TTL).
  ```json
  {
    "podsActive": 74,
    "podsTotal": 110,
    "podsPercent": 67,
    "aggCpuCores": 18.2,
    "aggCpuPercent": 42,
    "nvmeUsedTb": 4.12,
    "nvmeTotalTb": 14.5,
    "nvmePercent": 28.4,
    "nvmePoolName": "LONGHORN_NVME_POOL",
    "ingressRate": "142 MB/S",
    "rttMs": 0.4,
    "nodeCount": 3,
    "dns": "CoreDNS",
    "cni": "Cilium L7",
    "statusText": "ALL SYSTEMS OPERATIONAL"
  }
  ```

### 4.4 User Preferences & Persistence (`/api/user/preferences`)
- `GET /api/user/preferences`: Returns user's pinned services, custom order, and hidden categories.
- `PUT /api/user/preferences`: Updates user preferences in persistent Valkey/PostgreSQL backend.
- `POST /api/services/:id/launch`: Atomically increments launch count and updates timestamp.

---

## 5. Kubernetes Deployment & GitOps Integration

### 5.1 Manifest Placement
All declarative deployment manifests reside in the `homelab-k8s` repository under:
`apps/workloads/tools/launchpad/`

### 5.2 Kubernetes Resources
- **Deployment:** Multi-replica or single-replica pod running non-root container (`10001:10001`), read-only root filesystem, memory request `64Mi` / limit `256Mi`.
- **Service:** ClusterIP on port `3000`.
- **HTTPRoute:** Bound to `cilium-gateway-l7` matching `kerrlab.app` and `launch.kerrlab.app`.
- **ClusterRole & Binding:** Read access to `gateway.networking.k8s.io` and `networking.k8s.io` for route discovery; read, watch, patch, and update access to `argoproj.io/applications` for GitOps sync and health management (see `deploy/rbac.yaml`).
- **ExternalSecret:** Fetches database credentials from Vaultwarden (no ArgoCD static token needed).
- **ArgoCD Application:** Automated GitOps reconciliation with automated prune and self-heal.

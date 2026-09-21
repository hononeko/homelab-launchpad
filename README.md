# Homelab Launchpad

<div align="center">

![Homelab Launchpad](https://lh3.googleusercontent.com/aida/AEtjO1XrzS6X4beHj6GL_Ab4ZThssdJTHptiBONe-EuVvL3lv3JUs6HrztXn2K9XN_XLaoPeVUgVpCY0hWsuqPs8t9dsn5yYYblv0OZ4PkCORez8sOJtUQahEia8f6SNr7lCD6QH_-IVa6fJ3aVy9gwTaqOQsrj4wUkNaLmIazVsER5lhmC5IBgszagi8omox-Fvt6Xx1UcVDlJLDfdLDiPAwZHj340OOyVR0CIvUqJs-0zxr-Ulx2NCm-2BfpS2)

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
- Node.js (v20+ recommended)
- npm (v10+)

### Setup
1. Clone repository and install dependencies:
   ```bash
   npm install
   ```
2. Start local Vite development server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000`.

3. Typecheck and lint:
   ```bash
   npm run lint
   ```

4. Build production bundle:
   ```bash
   npm run build
   ```

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
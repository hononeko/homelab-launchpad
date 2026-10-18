import { Request, Response, Router } from 'express';
import { getRequestUser, requireAdmin } from '../auth/forwardAuth';
import {
  getScaleNamespaces,
  listScalableWorkloads,
  parseWorkloadKind,
  scaleWorkload,
  WorkloadError,
} from '../k8s/workloads';
import { errorMessage } from '../util/errorMessage';

/** Sleep (0 replicas) and wake (1) for opted-in workloads; administrators only. */
export const workloadsRouter = Router();

function clusterFailure(res: Response, action: string, error: unknown) {
  console.error('[Workloads] Failed to %s: %s', action, errorMessage(error));
  res.status(502).json({ success: false, error: `The cluster rejected the request to ${action}` });
}

workloadsRouter.get('/workloads', requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, workloads: await listScalableWorkloads(), namespaces: getScaleNamespaces() });
  } catch (error) {
    clusterFailure(res, 'list workloads', error);
  }
});

workloadsRouter.post('/workloads/:namespace/:kind/:name/scale', requireAdmin, async (req: Request, res: Response) => {
  const kind = parseWorkloadKind(String(req.params.kind));
  const replicas = req.body?.replicas;
  if (!kind || (replicas !== 0 && replicas !== 1)) {
    res.status(400).json({ success: false, error: 'Expected a deployment or statefulset and "replicas" of 0 or 1' });
    return;
  }

  const namespace = String(req.params.namespace);
  const name = String(req.params.name);
  try {
    const workload = await scaleWorkload(namespace, kind, name, replicas);
    // Logged after the lookup succeeded, so namespace and name are known workload names
    console.log('[Workloads] %s scaled %s/%s to %d', getRequestUser(res)?.username, namespace, name, replicas);
    res.json({ success: true, workload });
  } catch (error) {
    if (error instanceof WorkloadError) {
      res.status(error.status).json({ success: false, error: error.message });
      return;
    }
    clusterFailure(res, 'scale the workload', error);
  }
});

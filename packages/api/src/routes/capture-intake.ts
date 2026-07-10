import type { FastifyInstance } from "fastify";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import {
  loadCaptureIntakeOperatorStatus,
  type CaptureIntakeOperatorConfig,
} from "../services/capture-intake-operator.js";

export type CaptureIntakeRoutesOptions = Omit<CaptureIntakeOperatorConfig, "exposeRoots">;

export async function captureIntakeRoutes(
  server: FastifyInstance,
  options: CaptureIntakeRoutesOptions,
): Promise<void> {
  server.get(
    "/admin/capture-intake",
    { preHandler: [authenticate, authorizePlatformAdmin()] },
    async () => ({
      data: await loadCaptureIntakeOperatorStatus({ ...options, exposeRoots: true }),
    }),
  );
}

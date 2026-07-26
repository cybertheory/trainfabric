/**
 * Pluggable GPU trial providers — Modal first, self-hosted HTTP runners.
 * No SSH in v1.
 */

export interface TrialSubmitSpec {
  trialId: string;
  autoRunId: string;
  repoUrl: string;
  commitSha?: string;
  entrypoint?: string;
  budgetSec: number;
  callbackUrl: string;
  env?: Record<string, string>;
}

export interface ComputeProvider {
  name: "modal" | "runner";
  submitTrial(spec: TrialSubmitSpec): Promise<{ externalId: string }>;
  getStatus?(externalId: string): Promise<{ status: string; score?: number }>;
  cancel?(externalId: string): Promise<void>;
}

/** Modal via REST — token + app/function ref. Stub-friendly when Modal URL unset. */
export function createModalProvider(cfg: {
  token: string;
  /** e.g. username/trainfabric-trial */
  appRef: string;
  /** Override Modal API base for tests */
  apiBase?: string;
}): ComputeProvider {
  const base = cfg.apiBase ?? "https://api.modal.com";
  return {
    name: "modal",
    async submitTrial(spec) {
      // Modal Functions HTTP invoke — payload matches gpu-runner contract.
      const res = await fetch(`${base}/v1/functions/${encodeURIComponent(cfg.appRef)}/call`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          args: [],
          kwargs: {
            trial_id: spec.trialId,
            auto_run_id: spec.autoRunId,
            repo_url: spec.repoUrl,
            commit_sha: spec.commitSha,
            entrypoint: spec.entrypoint ?? "python train.py",
            budget_sec: spec.budgetSec,
            callback_url: spec.callbackUrl,
            env: spec.env ?? {},
          },
        }),
      });
      if (!res.ok) {
        // Soft-fail path: queue as external pending so self-hosted / webhook can complete
        if (res.status === 404 || res.status === 501) {
          return { externalId: `modal-pending:${spec.trialId}` };
        }
        const text = await res.text();
        throw new Error(`Modal submit failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { call_id?: string; id?: string };
      return { externalId: json.call_id || json.id || `modal:${spec.trialId}` };
    },
  };
}

/**
 * Self-hosted runners claim trials via the AutoStore; this provider only
 * marks the trial pending for claim (no push required — NAT-friendly).
 */
export function createSelfHostedRunnerProvider(): ComputeProvider {
  return {
    name: "runner",
    async submitTrial(spec) {
      return { externalId: `runner-queue:${spec.trialId}` };
    },
  };
}

export function resolveComputeProvider(
  compute: { provider: "modal" | "runner"; modalRef?: string },
  env: { MODAL_TOKEN?: string; MODAL_APP_REF?: string; MODAL_API_BASE?: string },
): ComputeProvider {
  if (compute.provider === "modal") {
    const token = env.MODAL_TOKEN;
    const appRef = compute.modalRef || env.MODAL_APP_REF;
    if (!token || !appRef) {
      // Still return a provider that queues externally — completion via webhook
      return {
        name: "modal",
        async submitTrial(spec) {
          return { externalId: `modal-local:${spec.trialId}` };
        },
      };
    }
    return createModalProvider({
      token,
      appRef,
      apiBase: env.MODAL_API_BASE,
    });
  }
  return createSelfHostedRunnerProvider();
}

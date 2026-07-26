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

/** Modal trial submit — web endpoint URL or Functions REST invoke. */
export function createModalProvider(cfg: {
  token: string;
  /** HTTPS web endpoint (preferred) or Functions API ref e.g. workspace/app/fn */
  appRef: string;
  /** Override Modal API base for Functions REST path */
  apiBase?: string;
}): ComputeProvider {
  const base = cfg.apiBase ?? "https://api.modal.com";
  const payload = (spec: TrialSubmitSpec) => ({
    trial_id: spec.trialId,
    auto_run_id: spec.autoRunId,
    repo_url: spec.repoUrl,
    commit_sha: spec.commitSha,
    entrypoint: spec.entrypoint ?? "python train.py",
    budget_sec: spec.budgetSec,
    callback_url: spec.callbackUrl,
    env: spec.env ?? {},
  });

  return {
    name: "modal",
    async submitTrial(spec) {
      const body = payload(spec);
      // Preferred: Modal @fastapi_endpoint URL (MODAL_APP_REF=https://….modal.run)
      const isWeb = /^https?:\/\//i.test(cfg.appRef);
      const url = isWeb
        ? cfg.appRef
        : `${base}/v1/functions/${encodeURIComponent(cfg.appRef)}/call`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      // token_id:token_secret → Modal-Key / Modal-Secret (proxy auth) or Bearer
      if (cfg.token.includes(":")) {
        const [key, secret] = cfg.token.split(":", 2);
        headers["Modal-Key"] = key;
        headers["Modal-Secret"] = secret;
        headers.Authorization = `Bearer ${cfg.token}`;
      } else if (cfg.token) {
        headers.Authorization = `Bearer ${cfg.token}`;
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(isWeb ? body : { args: [], kwargs: body }),
      });
      if (!res.ok) {
        // Soft-fail path: queue as external pending so webhook can complete
        if (res.status === 404 || res.status === 501) {
          return { externalId: `modal-pending:${spec.trialId}` };
        }
        const text = await res.text();
        throw new Error(`Modal submit failed: ${res.status} ${text}`);
      }
      // Web endpoint runs sync and callbacks itself — fire-and-forget id is enough.
      const text = await res.text();
      let json: { call_id?: string; id?: string; trial_id?: string } = {};
      try {
        json = text ? (JSON.parse(text) as typeof json) : {};
      } catch {
        /* non-JSON ok for async web */
      }
      return {
        externalId:
          json.call_id || json.id || json.trial_id || `modal:${spec.trialId}`,
      };
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

/**
 * Box by ASCII client — long-running agent sandboxes.
 * API: https://ascii.dev/api/box/v1
 */

const BOX_API_BASE = "https://ascii.dev/api/box/v1";

export interface BoxClientConfig {
  apiKey: string;
  templateId?: string;
  baseUrl?: string;
}

export interface BoxRecord {
  id: string;
  state?: string;
  [key: string]: unknown;
}

export interface BoxEnvelope<T = unknown> {
  ok: boolean;
  type?: string;
  box?: BoxRecord;
  id?: string;
  status?: string;
  events?: unknown[];
  cursor?: string;
  stdout?: string;
  [key: string]: unknown;
  data?: T;
}

export class BoxError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "BoxError";
  }
}

export function createBoxClient(cfg: BoxClientConfig) {
  const base = (cfg.baseUrl ?? BOX_API_BASE).replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };

  async function request<T extends BoxEnvelope>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as BoxEnvelope & {
      message?: string;
      error?: { code?: string; message?: string };
    };
    if (!res.ok || json.ok === false) {
      throw new BoxError(
        json.error?.message || json.message || `Box ${method} ${path} failed`,
        res.status,
        json.error?.code,
      );
    }
    return json as T;
  }

  async function waitReady(boxId: string, timeoutMs = 120_000): Promise<BoxRecord> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const env = await request<BoxEnvelope>("GET", `/boxes/${boxId}`);
      const box = env.box ?? ({ id: boxId, state: env.status } as BoxRecord);
      const state = String(box.state ?? "");
      if (state === "ready" || state === "idle" || state === "running") return box;
      if (state === "error") throw new BoxError(`Box ${boxId} entered error`, 500);
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new BoxError(`Box ${boxId} not ready within timeout`, 408);
  }

  return {
    templateId: cfg.templateId,

    async create(opts: {
      ttlSeconds?: number | null;
      noEnv?: boolean;
      env?: Record<string, string>;
    }): Promise<BoxRecord> {
      const env = await request<BoxEnvelope>("POST", "/boxes", {
        ttlSeconds: opts.ttlSeconds === undefined ? null : opts.ttlSeconds,
        noEnv: opts.noEnv ?? true,
        env: opts.env,
      });
      const box = env.box ?? ({ id: String(env.id) } as BoxRecord);
      return waitReady(box.id);
    },

    async fork(
      templateId: string,
      opts: { noEnv?: boolean; env?: Record<string, string> } = {},
    ): Promise<BoxRecord> {
      const env = await request<BoxEnvelope>("POST", `/boxes/${templateId}/fork`, {
        noEnv: opts.noEnv ?? true,
        env: opts.env,
      });
      const box = env.box ?? ({ id: String(env.id) } as BoxRecord);
      return waitReady(box.id);
    },

    async get(boxId: string): Promise<BoxRecord> {
      const env = await request<BoxEnvelope>("GET", `/boxes/${boxId}`);
      return env.box ?? ({ id: boxId } as BoxRecord);
    },

    async stop(boxId: string): Promise<void> {
      await request("POST", `/boxes/${boxId}/stop`);
    },

    async resume(boxId: string, opts: { noEnv?: boolean } = {}): Promise<BoxRecord> {
      const env = await request<BoxEnvelope>("POST", `/boxes/${boxId}/resume`, {
        noEnv: opts.noEnv ?? true,
      });
      const box = env.box ?? ({ id: boxId } as BoxRecord);
      return waitReady(box.id);
    },

    async interrupt(boxId: string): Promise<void> {
      await request("POST", `/boxes/${boxId}/interrupt`);
    },

    async command(
      boxId: string,
      command: string,
      cwd?: string,
    ): Promise<{ stdout?: string; stderr?: string }> {
      const env = await request<BoxEnvelope & { stdout?: string; stderr?: string }>(
        "POST",
        `/boxes/${boxId}/commands`,
        { command, cwd },
      );
      return { stdout: env.stdout, stderr: env.stderr };
    },

    async writeFile(boxId: string, path: string, content: string): Promise<void> {
      await request("PUT", `/boxes/${boxId}/files`, { path, content, encoding: "utf-8" });
    },

    async selectRepo(repoUrl: string): Promise<void> {
      await request("POST", "/repos", { url: repoUrl }).catch(() => {
        /* optional — Box may already have repo access */
      });
    },

    async events(
      boxId: string,
      cursor?: string,
    ): Promise<{ events: unknown[]; cursor?: string }> {
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const env = await request<BoxEnvelope>("GET", `/boxes/${boxId}/events${q}`);
      return {
        events: (env.events as unknown[]) ?? [],
        cursor: env.cursor ? String(env.cursor) : undefined,
      };
    },

    async desktop(boxId: string): Promise<string | undefined> {
      const env = await request<BoxEnvelope & { url?: string; desktopUrl?: string }>(
        "POST",
        `/boxes/${boxId}/desktop?vnc=1`,
        { publicAccess: false },
      );
      return env.url || env.desktopUrl || (env.box as { desktopUrl?: string } | undefined)?.desktopUrl;
    },

    /**
     * Provision a campaign box: fork template (or create), inject env, start daemon.
     */
    async provisionAutoRun(opts: {
      templateId?: string;
      env: Record<string, string>;
      repoUrl: string;
      daemonStartCmd?: string;
    }): Promise<{ boxId: string; desktopUrl?: string; daemonHostUrl?: string }> {
      const template = opts.templateId || cfg.templateId;
      let box: BoxRecord;
      if (template) {
        box = await this.fork(template, { noEnv: true, env: opts.env });
      } else {
        box = await this.create({ ttlSeconds: null, noEnv: true, env: opts.env });
      }
      await this.selectRepo(opts.repoUrl).catch(() => undefined);

      // Bootstrap daemon if not baked into template
      const start =
        opts.daemonStartCmd ??
        "mkdir -p ~/trainfabric && (systemctl --user start trainfabric-autorunner 2>/dev/null || nohup python3 ~/trainfabric/autorunner_daemon.py >/tmp/autorunner.log 2>&1 &)";
      await this.command(box.id, start).catch(() => undefined);

      let daemonHostUrl: string | undefined;
      try {
        const hosted = await this.command(box.id, "host 8787 --private");
        const m = hosted.stdout?.match(/https:\/\/\S+/);
        if (m) daemonHostUrl = m[0];
      } catch {
        /* optional */
      }

      let desktopUrl: string | undefined;
      try {
        desktopUrl = await this.desktop(box.id);
      } catch {
        /* optional */
      }

      return { boxId: box.id, desktopUrl, daemonHostUrl };
    },
  };
}

export type BoxClient = ReturnType<typeof createBoxClient>;

export function boxClientFromEnv(env: {
  BOX_API_KEY?: string;
  BOX_TEMPLATE_ID?: string;
  BOX_API_BASE?: string;
}): BoxClient | null {
  if (!env.BOX_API_KEY) return null;
  return createBoxClient({
    apiKey: env.BOX_API_KEY,
    templateId: env.BOX_TEMPLATE_ID,
    baseUrl: env.BOX_API_BASE,
  });
}

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

      // Always install chat shim so THIS box answers /chat (talk-back) even if
      // the template's autorunner is stale. Then start the daemon and host :8787.
      const chatShim = `#!/usr/bin/env python3
import json,os,urllib.parse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
PORT=int(os.environ.get("AUTORUN_CHAT_PORT","8787")); HOME=Path.home()/"trainfabric"; INBOX=HOME/"inbox"/"steer.log"; STATUS=HOME/"status.json"
def st():
  try:
    return json.loads(STATUS.read_text()) if STATUS.exists() else {}
  except Exception:
    return {}
class H(BaseHTTPRequestHandler):
  def log_message(self,*a): pass
  def j(self,c,b):
    r=json.dumps(b).encode(); self.send_response(c); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(r))); self.end_headers(); self.wfile.write(r)
  def do_GET(self):
    p=urllib.parse.urlparse(self.path).path
    if p in ("/health","/","/status"):
      s=st(); self.j(200,{"ok":True,"autoRunId":os.environ.get("AUTORUN_ID",""),"phase":s.get("phase","running"),"trial":s.get("trial",0)}); return
    self.j(404,{"error":"not found"})
  def do_POST(self):
    p=urllib.parse.urlparse(self.path).path; n=int(self.headers.get("Content-Length") or 0)
    try: body=json.loads(self.rfile.read(n).decode() or "{}")
    except Exception: body={}
    if p!="/chat": self.j(404,{"error":"not found"}); return
    content=str(body.get("content") or "").strip()
    if not content: self.j(400,{"error":"content required"}); return
    HOME.mkdir(parents=True,exist_ok=True); INBOX.parent.mkdir(parents=True,exist_ok=True)
    INBOX.open("a").write(content.replace("\\n"," ")+"\\n"); s=st()
    reply=f"Received on this Box sandbox. Currently {s.get('phase','running')} (trial {s.get('trial',0)}). Queued. Instruction: {content[:240]}"
    self.j(200,{"ok":True,"reply":reply,"queued":True})
ThreadingHTTPServer(("0.0.0.0",PORT),H).serve_forever()
`;

      const start =
        opts.daemonStartCmd ??
        [
          "mkdir -p ~/trainfabric/inbox ~/trainfabric/skills",
          `cat > ~/trainfabric/chat_shim.py <<'PY'\n${chatShim}\nPY`,
          // Pull latest autorunner stack from main (daemon + Hermes-parity AI Gateway agent + skills).
          "BASE=https://raw.githubusercontent.com/cybertheory/trainfabric/main/services/autorunner",
          "curl -fsSL $BASE/autorunner_daemon.py -o ~/trainfabric/autorunner_daemon.py || true",
          "curl -fsSL $BASE/gateway.py -o ~/trainfabric/gateway.py || true",
          "curl -fsSL $BASE/agent_mutate.py -o ~/trainfabric/agent_mutate.py || true",
          "curl -fsSL $BASE/skills/autoresearch-mutate/SKILL.md -o ~/trainfabric/skills/autoresearch-mutate.md || true",
          "curl -fsSL $BASE/skills/publish-viz-github/SKILL.md -o ~/trainfabric/skills/publish-viz-github.md || true",
          "curl -fsSL $BASE/skills/trainfabric-cli/SKILL.md -o ~/trainfabric/skills/trainfabric-cli.md || true",
          "python3 -m pip install --user -q matplotlib httpx 2>/dev/null || true",
          "pkill -f 'chat_shim.py' 2>/dev/null || true",
          "pkill -f 'autorunner_daemon.py' 2>/dev/null || true",
          "nohup python3 ~/trainfabric/chat_shim.py >/tmp/tf-chat.log 2>&1 &",
          "systemctl --user start trainfabric-autorunner 2>/dev/null || nohup python3 ~/trainfabric/autorunner_daemon.py >/tmp/autorunner.log 2>&1 &",
        ].join(" && ");
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

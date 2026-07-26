/**
 * CatalogDO — per-dataset commit serialization.
 * All writes (ingest append, materialize, rebuild) funnel through this DO
 * so Iceberg snapshot commits cannot collide.
 */

import { getContainer } from "@cloudflare/containers";
import { CONTAINER_COMPUTE } from "./compute";
import type { ComputeContainer } from "./ComputeContainer";

interface CatalogEnv {
  COMPUTE?: DurableObjectNamespace<ComputeContainer>;
}

export class CatalogDO implements DurableObject {
  private state: DurableObjectState;
  private env: CatalogEnv;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: CatalogEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      const meta = (await this.state.storage.get("meta")) ?? {};
      return Response.json(meta);
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = (await request.json()) as {
      action: "ingest" | "materialize" | "rebuild" | "commit";
      computeUrl: string;
      payload: Record<string, unknown>;
      maxRetries?: number;
    };

    const resultPromise = this.enqueue(() => this.runCommit(body));
    try {
      const result = await resultPromise;
      return Response.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async callCompute(path: string, payload: Record<string, unknown>, computeUrl: string) {
    if (computeUrl === CONTAINER_COMPUTE || computeUrl.startsWith("container://")) {
      if (!this.env.COMPUTE) {
        throw new Error("COMPUTE container binding missing");
      }
      const stub = getContainer(this.env.COMPUTE, "hermes-aigw-v2");
      return stub.fetch(
        new Request(`http://compute${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    // ngrok free tier interstitial blocks machine clients without this header
    if (computeUrl.includes("ngrok")) {
      headers["ngrok-skip-browser-warning"] = "1";
    }
    return fetch(`${computeUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }

  private async runCommit(body: {
    action: string;
    computeUrl: string;
    payload: Record<string, unknown>;
    maxRetries?: number;
  }): Promise<unknown> {
    const maxRetries = body.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const path =
          body.action === "ingest"
            ? "/ingest"
            : body.action === "materialize" || body.action === "rebuild"
              ? "/query"
              : "/ingest";
        const res = await this.callCompute(path, body.payload, body.computeUrl);
        if (!res.ok) {
          const text = await res.text();
          if (/conflict|concurrent|stale/i.test(text) && attempt < maxRetries - 1) {
            await this.backoff(attempt);
            continue;
          }
          throw new Error(`Commit failed: ${res.status} ${text}`);
        }
        const json = await res.json();
        await this.state.storage.put("meta", {
          lastAction: body.action,
          lastAt: Date.now(),
          lastResult: json,
        });
        return json;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries - 1) {
          await this.backoff(attempt);
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private backoff(attempt: number): Promise<void> {
    const ms = Math.min(1000, 50 * 2 ** attempt) + Math.random() * 50;
    return new Promise((r) => setTimeout(r, ms));
  }
}

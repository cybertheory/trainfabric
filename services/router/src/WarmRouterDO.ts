/**
 * WarmRouterDO — tracks which warm Container holds hot row-groups per dataset.
 * Promotion: after WARM_HOT_THRESHOLD queries in a window, mark warm.
 * Demotion: idle timeout tears down the warm assignment.
 */

interface WarmState {
  warm: boolean;
  containerId?: string;
  queryCount: number;
  windowStart: number;
  lastAccess: number;
}

const WINDOW_MS = 60 * 60 * 1000; // 1h

export class WarmRouterDO implements DurableObject {
  private state: DurableObjectState;
  private env: { WARM_HOT_THRESHOLD?: string; WARM_IDLE_TIMEOUT_MS?: string };

  constructor(state: DurableObjectState, env: { WARM_HOT_THRESHOLD?: string; WARM_IDLE_TIMEOUT_MS?: string }) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const hotThreshold = Number(this.env.WARM_HOT_THRESHOLD ?? 20);
    const idleMs = Number(this.env.WARM_IDLE_TIMEOUT_MS ?? 600_000);

    let st = ((await this.state.storage.get("warm")) as WarmState | undefined) ?? {
      warm: false,
      queryCount: 0,
      windowStart: Date.now(),
      lastAccess: 0,
    };

    // Demote if idle
    if (st.warm && st.lastAccess && Date.now() - st.lastAccess > idleMs) {
      st = { warm: false, queryCount: 0, windowStart: Date.now(), lastAccess: 0 };
      await this.state.storage.put("warm", st);
    }

    if (url.pathname === "/lookup" && request.method === "GET") {
      return Response.json(st);
    }

    if (url.pathname === "/record" && request.method === "POST") {
      const now = Date.now();
      if (now - st.windowStart > WINDOW_MS) {
        st.queryCount = 0;
        st.windowStart = now;
      }
      st.queryCount += 1;
      st.lastAccess = now;
      if (!st.warm && st.queryCount >= hotThreshold) {
        st.warm = true;
        st.containerId = `warm-${crypto.randomUUID().slice(0, 8)}`;
      }
      await this.state.storage.put("warm", st);
      return Response.json(st);
    }

    if (url.pathname === "/demote" && request.method === "POST") {
      st = { warm: false, queryCount: 0, windowStart: Date.now(), lastAccess: 0 };
      await this.state.storage.put("warm", st);
      return Response.json(st);
    }

    return new Response("Not found", { status: 404 });
  }
}

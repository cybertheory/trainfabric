/** D1-backed control-plane registry. */

import { createD1Registry } from "./d1";

export type Registry = ReturnType<typeof createD1Registry>;

export function createRegistry(env: { DB?: D1Database }): Registry {
  if (!env.DB) {
    throw new Error("Configure DB (D1) on the Worker");
  }
  return createD1Registry(env.DB);
}

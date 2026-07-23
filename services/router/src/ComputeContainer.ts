/**
 * Compute Container — Cloudflare Container DO wrapping the Python FastAPI image.
 */
import { Container } from "@cloudflare/containers";

export class ComputeContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
  // Need outbound internet for R2 S3 API + optional Postgres catalog
  enableInternet = true;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      PORT: "8080",
      CATALOG_BACKEND: env.CATALOG_BACKEND || "rest",
      ICEBERG_CATALOG_URI: env.ICEBERG_CATALOG_URI || "sqlite:////tmp/iceberg/catalog.db",
      ICEBERG_WAREHOUSE: env.ICEBERG_WAREHOUSE || "s3://trainfabric-data/__r2_data_catalog",
      ICEBERG_WAREHOUSE_ID:
        env.ICEBERG_WAREHOUSE_ID || "e5793b12d9dd58ea18bde1fbbed5262b_trainfabric-data",
      ICEBERG_REST_URI:
        env.ICEBERG_REST_URI ||
        "https://catalog.cloudflarestorage.com/e5793b12d9dd58ea18bde1fbbed5262b/trainfabric-data",
      ICEBERG_TOKEN: env.ICEBERG_TOKEN || "",
      R2_ENDPOINT: env.R2_ENDPOINT || "",
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY || "",
      R2_BUCKET: env.R2_BUCKET || "trainfabric-data",
      R2_REGION: env.R2_REGION || "auto",
      AWS_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID || "",
      AWS_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY || "",
    };
  }

  override onStart() {
    console.log("ComputeContainer started");
  }

  override onStop() {
    console.log("ComputeContainer stopped");
  }

  override onError(error: unknown) {
    console.error("ComputeContainer error", error);
  }
}

interface Env {
  CATALOG_BACKEND?: string;
  ICEBERG_CATALOG_URI?: string;
  ICEBERG_WAREHOUSE?: string;
  ICEBERG_WAREHOUSE_ID?: string;
  ICEBERG_REST_URI?: string;
  ICEBERG_TOKEN?: string;
  R2_ENDPOINT?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_REGION?: string;
}

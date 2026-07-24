/** R2 helpers — staging upload + presigned GET URLs. */

export interface R2Like {
  put(key: string, value: ReadableStream | ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; writeHttpMetadata?: (h: Headers) => void } | null>;
  createMultipartUpload?: (key: string) => Promise<unknown>;
}

/** Build a short-lived GET URL. In production, use R2 presign via S3 API;
 *  locally we proxy through the Worker at /r2/{key}. */
export function publicResultUrl(base: string, r2Url: string): string {
  // r2Url may be s3://bucket/key or https://...
  if (r2Url.startsWith("http://") || r2Url.startsWith("https://")) return r2Url;
  const key = r2Url.replace(/^s3:\/\/[^/]+\//, "").replace(/^r2:\/\/[^/]+\//, "");
  return `${base.replace(/\/$/, "")}/r2/${key}`;
}

export async function putStaging(
  r2: R2Like,
  datasetId: string,
  filename: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const key = `staging/${datasetId}/${filename}`;
  await r2.put(key, body, { httpMetadata: { contentType } });
  return key;
}

/** Extract object key from s3/r2 URI or return as-is. */
export function objectKeyFromUri(uri: string): string {
  const r2Idx = uri.indexOf("/r2/");
  if (r2Idx >= 0) {
    return uri.slice(r2Idx + 4).split("?")[0]!;
  }
  return uri.replace(/^s3:\/\/[^/]+\//, "").replace(/^r2:\/\/[^/]+\//, "").replace(/^https?:\/\/[^/]+\//, "");
}

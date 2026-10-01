import { env } from "cloudflare:workers";

export async function getJsonFromR2(key: string): Promise<string> {
  const object = await env.R2.get(key);
  if (!object) {
    throw new Error("Audit payload not found");
  }

  return object.text();
}

export async function putTextToR2(
  key: string,
  body: string,
): Promise<{ key: string; sizeBytes: number }> {
  await env.R2.put(key, body, {
    httpMetadata: {
      contentType: "application/json",
    },
  });

  return {
    key,
    sizeBytes: Buffer.byteLength(body),
  };
}

export async function putBytesToR2(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await env.R2.put(key, body, { httpMetadata: { contentType } });
}

export async function getBytesFromR2(key: string): Promise<Uint8Array | null> {
  const object = await env.R2.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

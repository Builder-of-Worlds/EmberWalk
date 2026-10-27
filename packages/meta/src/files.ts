import { z } from "zod";
import type { ContentKind, MetaClient } from "./client.ts";
import { MetaRefused } from "./errors.ts";
import { SAM_MODEL } from "./prices.ts";

export const MIN_EXPIRY_SECONDS = 3600;
export const MAX_EXPIRY_SECONDS = 30 * 24 * 3600;

const Uploaded = z.object({ id: z.string().min(1).max(200) });

export type Upload = { bytes: Uint8Array; filename: string; mediaType: string; content: ContentKind; expiresInSeconds: number };

export async function uploadFile(client: MetaClient, u: Upload): Promise<string> {
  client.assertMaySend(SAM_MODEL, u.content);
  if (!Number.isInteger(u.expiresInSeconds) || u.expiresInSeconds < MIN_EXPIRY_SECONDS || u.expiresInSeconds > MAX_EXPIRY_SECONDS) {
    throw new MetaRefused("missing_upload_expiry", `an upload expires after ${MIN_EXPIRY_SECONDS} to ${MAX_EXPIRY_SECONDS} seconds`);
  }
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("expires_after[anchor]", "created_at");
  form.append("expires_after[seconds]", String(u.expiresInSeconds));
  form.append("file", new Blob([u.bytes as BlobPart], { type: u.mediaType }), u.filename);
  const raw = await client.send({ method: "POST", path: "/files", form });
  const parsed = Uploaded.safeParse(raw);
  if (!parsed.success) throw new MetaRefused("invalid_answer", "the upload answer has no file id");
  return parsed.data.id;
}

export async function deleteFile(client: MetaClient, fileId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) throw new TypeError("not a file id");
  await client.send({ method: "DELETE", path: `/files/${fileId}` });
}

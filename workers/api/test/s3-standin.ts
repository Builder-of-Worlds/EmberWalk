import { presign } from "@emberwalk/sigv4";

export type StandIn = {
  bucket: R2Bucket;
  bucketName: string;
  host: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: () => Date;
};

const denied = (status: number, code: string): Response =>
  new Response(`<Error><Code>${code}</Code></Error>`, { status, headers: { "content-type": "application/xml" } });

const parseDate = (amz: string): Date =>
  new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);

export const s3StandIn = async (request: Request, standIn: StandIn): Promise<Response> => {
  const url = new URL(request.url);
  const params = url.searchParams;
  const amzDate = params.get("X-Amz-Date") ?? "";
  const expires = Number(params.get("X-Amz-Expires"));
  const given = params.get("X-Amz-Signature") ?? "";
  const signedNames = (params.get("X-Amz-SignedHeaders") ?? "").split(";");

  const signedHeaders: Record<string, string> = {};
  for (const name of signedNames) {
    if (name === "host") continue;
    const value = request.headers.get(name);
    if (value === null) return denied(403, "SignatureDoesNotMatch");
    signedHeaders[name] = value;
  }

  const query: Record<string, string> = {};
  for (const [k, v] of params) if (!k.startsWith("X-Amz-")) query[k] = v;

  const expected = await presign({
    method: request.method as "PUT",
    host: standIn.host,
    path: decodeURIComponent(url.pathname),
    query,
    signedHeaders,
    accessKeyId: standIn.accessKeyId,
    secretAccessKey: standIn.secretAccessKey,
    region: "auto",
    service: "s3",
    now: parseDate(amzDate),
    expiresSeconds: expires,
  });
  if (new URL(expected).searchParams.get("X-Amz-Signature") !== given) return denied(403, "SignatureDoesNotMatch");
  if (standIn.now().getTime() > parseDate(amzDate).getTime() + expires * 1000) return denied(403, "AccessDenied");

  const prefix = `/${standIn.bucketName}/`;
  if (request.method !== "PUT" || !url.pathname.startsWith(prefix)) return denied(400, "InvalidRequest");
  const key = decodeURIComponent(url.pathname.slice(prefix.length));
  const uploadId = params.get("uploadId");
  const partNumber = Number(params.get("partNumber"));
  if (uploadId === null || !Number.isInteger(partNumber)) return denied(400, "InvalidRequest");

  const part = await standIn.bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, await request.arrayBuffer());
  return new Response(null, { status: 200, headers: { etag: `"${part.etag}"` } });
};

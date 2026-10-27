export type Presign = {
  method: "GET" | "PUT" | "DELETE";
  host: string;
  path: string;
  query?: Record<string, string>;
  signedHeaders?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now: Date;
  expiresSeconds: number;
};

export function presign(input: Presign): Promise<string>;

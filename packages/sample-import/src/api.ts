import { ErrorBody } from "@emberwalk/shared";
import type { z } from "zod";
import { ImportError } from "./errors.ts";

export type Fetch = (request: Request) => Promise<Response>;

export const post = async <T>(send: Fetch, origin: string, path: string, body: unknown, shape: z.ZodType<T>): Promise<T> => {
  let response: Response;
  let json: unknown;
  try {
    response = await send(
      new Request(new URL(path, origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    json = await response.json().catch(() => null);
  } catch {
    throw new ImportError("offline", `The API at ${origin} could not be reached.`);
  }
  if (!response.ok) {
    const error = ErrorBody.safeParse(json);
    if (error.success) throw new ImportError(error.data.error.code, error.data.error.message);
    throw new ImportError("server_error", `The API answered ${response.status}.`);
  }
  const parsed = shape.safeParse(json);
  if (!parsed.success) throw new ImportError("server_error", `The API answered ${path} in a shape this tool does not know.`);
  return parsed.data;
};

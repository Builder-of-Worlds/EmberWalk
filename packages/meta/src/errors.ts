export type RefusalReason =
  | "real_content_on_free_credits"
  | "daily_cap_reached"
  | "non_standard_model"
  | "missing_upload_expiry"
  | "invalid_answer"
  | "invalid_tool_arguments";

export class MetaRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "MetaRefused";
  }
}

export class MetaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`Meta Model API answered ${status}`);
    this.name = "MetaHttpError";
  }
}

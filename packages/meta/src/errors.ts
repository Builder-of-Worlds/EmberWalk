export type RefusalReason =
  | "real_content_on_free_credits"
  | "daily_cap_reached"
  | "non_standard_model"
  | "missing_upload_expiry"
  | "invalid_answer"
  | "invalid_audio"
  | "invalid_tool_arguments"
  | "model_not_listed"
  | "real_walk_off_second_check";

export class MetaRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "MetaRefused";
  }
}

export class MetaNetworkError extends Error {
  constructor(detail: string) {
    super(`the request never reached the server: ${detail}`);
    this.name = "MetaNetworkError";
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

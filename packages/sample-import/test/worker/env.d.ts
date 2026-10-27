/// <reference types="@cloudflare/vitest-plugin/types" />

type ApiEnv = import("../../../../workers/api/src/index").Env;
type PipelineEnv = import("../../../../workers/pipeline/src/env").Env;

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../../../../workers/api/src/index");
  }
  interface Env extends ApiEnv, PipelineEnv {
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
    RENDER_FILES: Fetcher;
  }
}

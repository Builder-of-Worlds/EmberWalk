/// <reference types="@cloudflare/vitest-plugin/types" />

type ApiEnv = import("../../../../workers/api/src/index").Env;

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../../../../workers/api/src/index");
  }
  interface Env extends ApiEnv {
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

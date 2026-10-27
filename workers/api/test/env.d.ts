/// <reference types="@cloudflare/vitest-plugin/types" />

type AppEnv = import("../src/index").Env;

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
  interface Env extends AppEnv {
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

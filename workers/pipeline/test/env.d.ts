type AppEnv = import("../src/env").Env;

declare namespace Cloudflare {
  interface Env extends AppEnv {
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

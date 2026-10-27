type AppEnv = import("../src/types").Env;

declare namespace Cloudflare {
  interface Env extends AppEnv {
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
    README_TEXT: string;
  }
}

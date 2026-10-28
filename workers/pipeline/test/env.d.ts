type AppEnv = import("../src/env").Env;

declare module "*?raw" {
  const text: string;
  export default text;
}

declare namespace Cloudflare {
  interface Env extends AppEnv {
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

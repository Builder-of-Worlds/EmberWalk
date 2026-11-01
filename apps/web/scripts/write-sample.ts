import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sampleResults } from "./sample-results.ts";

writeFileSync(fileURLToPath(new URL("../src/samples/test-yard.json", import.meta.url)), `${JSON.stringify(sampleResults(), null, 2)}\n`);

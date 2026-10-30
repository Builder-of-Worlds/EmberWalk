import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const decisions = await import("./license-decisions.mjs").catch((err) => {
  if (err.code === "ERR_MODULE_NOT_FOUND") return null;
  throw err;
});

const ALLOWED = new Set(["MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"]);

function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}

function licenseOf(json) {
  const l = json.license;
  if (typeof l === "string" && l.trim() !== "") return l.trim();
  if (l && typeof l === "object" && typeof l.type === "string") return l.type;
  if (Array.isArray(json.licenses) && json.licenses.length > 0) {
    return `(${json.licenses.map((x) => (typeof x === "string" ? x : x.type)).join(" OR ")})`;
  }
  return "UNKNOWN";
}

function allowed(expression) {
  const tokens = expression.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/);
  let i = 0;
  const primary = () => {
    const t = tokens[i++];
    if (t === "(") {
      const v = orExpr();
      i++;
      return v;
    }
    if (tokens[i] === "WITH") {
      i += 2;
      return false;
    }
    return ALLOWED.has(t);
  };
  const andExpr = () => {
    let v = primary();
    while (tokens[i] === "AND") {
      i++;
      v = primary() && v;
    }
    return v;
  };
  const orExpr = () => {
    let v = andExpr();
    while (tokens[i] === "OR") {
      i++;
      v = andExpr() || v;
    }
    return v;
  };
  const result = orExpr();
  return result && i === tokens.length;
}

function walk(dir, rel, found) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const relPath = `${rel}/${entry}`;
    if (lstatSync(full).isSymbolicLink()) continue;
    if (entry.startsWith("@")) {
      walk(full, relPath, found);
      continue;
    }
    const manifest = path.join(full, "package.json");
    if (!existsSync(manifest)) continue;
    found.push({ rel: relPath, json: JSON.parse(readFileSync(manifest, "utf8")) });
    walk(path.join(full, "node_modules"), `${relPath}/node_modules`, found);
  }
}

function unpinned(lock, name, version) {
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key.includes("node_modules/")) continue;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const spec = entry?.[field]?.[name];
      if (spec !== undefined && spec !== version) return `${key || "root"} asks ${spec}`;
    }
  }
  return null;
}

function noticed(notice, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(?=$|[\\s,:;)])`, "m").test(notice);
}

function shipsReason(e, json, lock, notice) {
  if (e.ships !== true || e.version !== json.version) return "not listed";
  const undecided = decisions?.decisionReason(e);
  if (undecided) return undecided;
  const loose = unpinned(lock, json.name, json.version);
  if (loose) return `not pinned: ${loose}`;
  if (!noticed(notice, json.name)) return "no notice in NOTICE";
  return null;
}

function main() {
  const root = process.cwd();
  const modules = path.join(root, "node_modules");
  if (!existsSync(modules)) {
    console.log("LICENSES node_modules missing; run npm install. Red.");
    process.exit(1);
  }
  const lock = readJson(path.join(root, "package-lock.json"), { packages: {} });
  const { exceptions } = readJson(path.join(root, "tools", "license-exceptions.json"), { exceptions: [] });
  const noticeFile = path.join(root, "NOTICE");
  const notice = existsSync(noticeFile) ? readFileSync(noticeFile, "utf8") : "";
  const found = [];
  walk(modules, "node_modules", found);
  let ok = 0;
  let excepted = 0;
  let failed = 0;
  for (const { rel, json } of found) {
    const license = licenseOf(json);
    if (allowed(license)) {
      ok++;
      continue;
    }
    const devOnly = lock.packages?.[rel]?.dev === true;
    const listed = exceptions.filter((e) => e.name === json.name && e.license === license);
    const reasons = listed.map((e) => (e.ships === true ? shipsReason(e, json, lock, notice) : devOnly ? null : "not listed"));
    if (reasons.includes(null)) {
      excepted++;
      continue;
    }
    failed++;
    const why = reasons.find((r) => r !== "not listed");
    console.log(`LICENSE FAIL ${json.name}@${json.version} ${license} (${rel}${devOnly ? ", dev only" : ""}${why ? `, ${why}` : ""})`);
  }
  console.log(`LICENSES packages=${found.length} allowed=${ok} excepted=${excepted} failed=${failed}`);
  if (found.length === 0) {
    console.log("LICENSES scanned nothing; red");
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();

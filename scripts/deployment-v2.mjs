import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const base = process.env.QA_URL || "https://seoshiro.github.io/sidereal/";
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const report = {
  commit,
  checkedAt: new Date().toISOString(),
  url: base,
  files: [],
};
const paths = [
  "index.html",
  "favicon.svg",
  ...(await fs.readdir("dist/assets")).map((name) => "assets/" + name),
];
for (const path of paths) {
  const response = await fetch(new URL(path, base), { cache: "no-store" });
  assert.equal(response.status, 200, path);
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = await fs.readFile("dist/" + path);
  assert.ok(bytes.equals(local), "Published mismatch: " + path);
  report.files.push({
    path,
    status: response.status,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const html = await fs.readFile("dist/index.html", "utf8");
assert.ok(html.includes("./assets/"));
assert.ok(!html.includes("/src/boot.ts"));
await fs.mkdir("qa-artifacts", { recursive: true });
await fs.writeFile(
  "qa-artifacts/v2-deployment-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

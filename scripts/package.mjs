import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
if (!/^\d+(\.\d+){1,3}$/.test(manifest.version)) throw new Error("Invalid manifest version.");

const release = path.join(root, "release");
const archive = path.join(release, `auto-webmcp-${manifest.version}.zip`);
await mkdir(release, { recursive: true });
await rm(archive, { force: true });
await run("zip", ["-qr", archive, "."], { cwd: dist });
console.log(`Packaged ${archive}`);

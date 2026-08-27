import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packageManifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const lockfile = await readFile(new URL("pnpm-lock.yaml", root), "utf8");
const sourceManifest = JSON.parse(await readFile(new URL("src/manifest.json", root), "utf8"));
const buildManifest = JSON.parse(await readFile(new URL("dist/manifest.json", root), "utf8"));

test("package and extension versions match", () => {
  assert.match(packageManifest.version, /^\d+(\.\d+){1,3}$/);
  assert.equal(sourceManifest.version, packageManifest.version);
});

test("production manifest has only the permissions required by the single purpose", () => {
  assert.deepEqual(buildManifest, sourceManifest);
  assert.equal(buildManifest.manifest_version, 3);
  assert.equal(buildManifest.minimum_chrome_version, "149");
  assert.equal(buildManifest.name, "Auto WebMCP");
  assert.equal(buildManifest.description.length <= 132, true);
  assert.equal("version_name" in buildManifest, false);
  assert.equal("permissions" in buildManifest, false);
  assert.equal("host_permissions" in buildManifest, false);
  assert.equal("background" in buildManifest, false);
  assert.equal(buildManifest.content_scripts.length, 2);
  assert.deepEqual(buildManifest.content_scripts[0], {
    matches: ["http://*/*", "https://*/*"],
    js: ["webmcp-runtime.js"],
    run_at: "document_start",
    world: "MAIN",
  });
  assert.deepEqual(buildManifest.content_scripts[1].js, ["content.js"]);
  assert.equal("all_frames" in buildManifest.content_scripts[1], false);
});

test("production build includes its popup and required PNG icons", async () => {
  for (const file of [
    "dist/content.js",
    "dist/webmcp-runtime.js",
    "dist/LICENSE.txt",
    "dist/THIRD_PARTY_NOTICES.txt",
    "dist/popup.html",
    "dist/popup.css",
    "dist/popup.js",
    "dist/icons/icon16.png",
    "dist/icons/icon32.png",
    "dist/icons/icon48.png",
    "dist/icons/icon128.png",
  ]) {
    await access(new URL(file, root));
  }

  for (const excludedFile of [
    "dist/background.js",
    "dist/dev-reload.js",
    "dist/build-stamp.txt",
    "dist/WEBMCP_POLYFILL_LICENSE.txt",
    "dist/CFWORKER_JSON_SCHEMA_LICENSE.txt",
  ]) {
    await assert.rejects(access(new URL(excludedFile, root)));
  }

  const notices = await readFile(new URL("dist/THIRD_PARTY_NOTICES.txt", root), "utf8");
  const polyfillVersion = packageManifest.devDependencies["@mcp-b/webmcp-polyfill"];
  const cfworkerVersion = lockfile.match(/^  '@cfworker\/json-schema@([^']+)':$/m)?.[1];
  assert.equal(notices.includes(`@mcp-b/webmcp-polyfill ${polyfillVersion}`), true);
  assert.equal(
    notices.includes(
      `https://www.npmjs.com/package/@mcp-b/webmcp-polyfill/v/${polyfillVersion}`,
    ),
    true,
  );
  assert.match(notices, /Copyright \(c\) 2025 mcp-b contributors/);
  assert.equal(typeof cfworkerVersion, "string");
  assert.equal(notices.includes(`@cfworker/json-schema ${cfworkerVersion}`), true);
  assert.equal(
    notices.includes(`https://www.npmjs.com/package/@cfworker/json-schema/v/${cfworkerVersion}`),
    true,
  );
  assert.match(notices, /Copyright \(c\) 2020 Jeremy Danyow/);
});

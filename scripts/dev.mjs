import { watch } from "node:fs";
import { createServer } from "node:http";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = path.join(root, "src");
const production = process.argv.includes("--build");
const output = path.join(root, "dist");
const commonFiles = ["content.js", "popup.html", "popup.css", "popup.js"];
const polyfillRoot = path.join(root, "node_modules", "@mcp-b", "webmcp-polyfill");

async function build() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all(
    commonFiles.map((file) => copyFile(path.join(source, file), path.join(output, file))),
  );
  const runtime = [
    "globalThis.__webMCPPolyfillOptions = { installTestingShim: false };",
    (await readFile(path.join(polyfillRoot, "dist", "index.iife.js"), "utf8")).replace(
      /\n\/\/# sourceMappingURL=.*$/,
      "",
    ),
    await readFile(path.join(source, "form-runtime.js"), "utf8"),
  ].join("\n");
  await writeFile(path.join(output, "webmcp-runtime.js"), runtime);
  await cp(path.join(source, "icons"), path.join(output, "icons"), { recursive: true });
  await copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE.txt"));
  await copyFile(
    path.join(root, "THIRD_PARTY_NOTICES.txt"),
    path.join(output, "THIRD_PARTY_NOTICES.txt"),
  );

  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  if (!production) {
    manifest.permissions = ["storage"];
    manifest.background = { service_worker: "background.js" };
    const scanner = manifest.content_scripts.find(({ js }) => js.includes("content.js"));
    scanner.js = ["content.js", "dev-reload.js"];
    await Promise.all([
      copyFile(path.join(source, "background.js"), path.join(output, "background.js")),
      copyFile(path.join(source, "dev-reload.js"), path.join(output, "dev-reload.js")),
      writeFile(path.join(output, "build-stamp.txt"), `${Date.now()}\n`),
    ]);
  }
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${production ? "production" : "development"} extension: ${output}`);
}

if (production) {
  await build();
  process.exit(0);
}

let building = false;
let queued = false;

async function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  do {
    queued = false;
    try {
      await build();
    } catch (error) {
      console.error(error);
    }
  } while (queued);
  building = false;
}

await rebuild();
const sourceWatcher = watch(source, { recursive: true }, rebuild);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    if (file !== "index.html") {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(await readFile(path.join(root, "mock", file)));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

server.listen(4173, "127.0.0.1", () => {
  console.log("Mock site: http://127.0.0.1:4173");
  console.log("Watching src/. The loaded extension and changed page reload automatically.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    sourceWatcher.close();
    server.close(() => process.exit(0));
  });
}

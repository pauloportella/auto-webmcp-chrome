import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");

function element() {
  return {
    children: [],
    className: "",
    textContent: "",
    title: "",
    addEventListener() {},
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

async function render(status) {
  const elements = Object.fromEntries(
    ["#state", "#generated", "#available", "#tools", "#compatibility", "#refresh"].map(
      (selector) => [selector, element()],
    ),
  );
  const context = {
    document: {
      createElement: element,
      querySelector: (selector) => elements[selector],
    },
    chrome: {
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: async () => status,
      },
    },
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return elements;
}

test("popup reports browser-visible WebMCP tools without reading form values", async () => {
  const elements = await render({
    annotatedForms: 2,
    generatedForms: 1,
    apiAvailable: true,
    apiError: null,
    runtime: "polyfill",
    toolCount: 2,
    toolNames: ["site_tool", "fill_search"],
  });

  assert.equal(elements["#state"].textContent, "2 form(s) ready");
  assert.equal(elements["#generated"].textContent, "1");
  assert.equal(elements["#available"].textContent, "2");
  assert.deepEqual(
    elements["#tools"].children.map(({ textContent }) => textContent),
    ["site_tool", "fill_search"],
  );
  assert.equal(elements["#compatibility"].textContent, "Packaged WebMCP page runtime active.");
});

test("popup reports a missing runtime without asking for an experimental flag", async () => {
  const elements = await render({
    annotatedForms: 1,
    generatedForms: 1,
    apiAvailable: false,
    apiError: null,
    runtime: "unavailable",
    toolCount: 0,
    toolNames: [],
  });

  assert.equal(elements["#state"].textContent, "WebMCP runtime unavailable");
  assert.doesNotMatch(elements["#compatibility"].textContent, /enable-webmcp-testing/);
});

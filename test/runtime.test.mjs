import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bundle = await readFile(new URL("../dist/webmcp-runtime.js", import.meta.url), "utf8");

function control({
  name,
  type = "text",
  value = "",
  required = false,
  readOnly = false,
  ariaHidden = false,
  tagName = "INPUT",
  label = name,
}) {
  return {
    checked: false,
    disabled: false,
    readOnly,
    dispatchEvent() {},
    closest: (selector) => (selector === '[aria-hidden="true"]' && ariaHidden ? {} : null),
    getAttribute: (attribute) => (attribute === "toolparamdescription" ? name : null),
    labels: [{ textContent: label }],
    matches: () => true,
    name,
    required,
    tagName,
    type,
    value,
  };
}

test("bundled runtime polyfills, registers, populates, and never submits", async () => {
  const destination = control({ name: "destination", required: true });
  const guests = control({ name: "guests", tagName: "SELECT" });
  guests.options = [
    { disabled: false, textContent: "1 guest", value: "1" },
    { disabled: false, textContent: "2 guests", value: "2" },
  ];
  const student = control({ name: "role", type: "radio", value: "student", label: "Student" });
  const professional = control({
    name: "role",
    type: "radio",
    value: "professional",
    label: "Professional",
  });
  const web = control({ name: "themes", type: "checkbox", value: "web", label: "Web" });
  const openEnded = control({
    name: "themes",
    type: "checkbox",
    value: "open",
    label: "Open Ended",
  });
  const checkedCheckbox = control({
    name: "same_value_checkboxes",
    type: "checkbox",
    value: "on",
    label: "Checked checkbox",
  });
  const defaultCheckbox = control({
    name: "same_value_checkboxes",
    type: "checkbox",
    value: "on",
    label: "Default checkbox",
  });
  const checkedRadio = control({
    name: "same_value_radios",
    type: "radio",
    value: "on",
    label: "Checked radio",
  });
  const defaultRadio = control({
    name: "same_value_radios",
    type: "radio",
    value: "on",
    label: "Default radio",
  });
  const generatedId = control({ name: "generated_id", readOnly: true });
  const honeypot = control({ name: "company_website", ariaHidden: true });
  let focused = false;
  let submitted = false;
  const form = {
    dispatchEvent() {},
    elements: [
      destination,
      guests,
      student,
      professional,
      web,
      openEnded,
      checkedCheckbox,
      defaultCheckbox,
      checkedRadio,
      defaultRadio,
      generatedId,
      honeypot,
    ],
    getAttribute: (name) =>
      ({
        "data-webmcp-complete-tool": "fill_stay",
        "data-webmcp-tool-title": "Find a place to stay",
        "data-webmcp-tool-description": "Fill the stay form.",
      })[name] || null,
    isConnected: true,
    matches: () => true,
    querySelector: () => ({ focus: () => (focused = true) }),
    requestSubmit: () => (submitted = true),
  };
  let runtime;
  let runtimeWrites = 0;
  let scans = 0;
  let observer;
  const context = {
    AbortController,
    DOMException,
    Event,
    EventTarget,
    MutationObserver: class {
      constructor(callback) {
        observer = callback;
      }
      observe() {}
    },
    URL,
    console,
    document: {
      documentElement: {
        getAttribute: () => runtime,
        setAttribute: (_name, value) => {
          runtime = value;
          runtimeWrites += 1;
        },
      },
      querySelectorAll: () => {
        scans += 1;
        return [form];
      },
    },
    location: { origin: "https://example.test", pathname: "/", search: "" },
    navigator: {},
    queueMicrotask,
  };
  context.self = context;
  context.window = context;

  vm.runInNewContext(bundle, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runtime, "polyfill");
  assert.equal(runtimeWrites, 1);
  assert.equal(scans, 1);
  observer([
    {
      type: "childList",
      target: { closest: () => null },
      addedNodes: [{ nodeType: 1, matches: () => false, querySelector: () => null }],
      removedNodes: [],
    },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, 1);

  observer([
    {
      type: "attributes",
      attributeName: "disabled",
      target: { closest: () => form },
    },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, 1);
  assert.equal(runtimeWrites, 1);
  assert.equal(context.document.modelContext.__isWebMCPPolyfill, true);
  const [tool] = await context.document.modelContext.getTools();
  assert.equal(tool.name, "fill_stay");
  assert.equal(tool.title, "Find a place to stay");
  assert.match(bundle, /annotations:\s*\{ readOnlyHint: false, untrustedContentHint: false \}/);
  assert.match(tool.description, /never submits the form/i);
  assert.deepEqual(JSON.parse(tool.inputSchema), {
    type: "object",
    description:
      "Provide one or more fields to populate. Omitted fields remain unchanged. Fields required by the page may depend on another selection. This tool never submits the form.",
    properties: {
      destination: { type: "string", description: "destination" },
      guests: {
        type: "string",
        anyOf: [
          { type: "string", const: "1", title: "1 guest" },
          { type: "string", const: "2", title: "2 guests" },
        ],
        enum: ["1", "2"],
        description: "guests",
      },
      role: {
        type: "string",
        anyOf: [
          { type: "string", const: "student", title: "Student" },
          { type: "string", const: "professional", title: "Professional" },
        ],
        enum: ["student", "professional"],
        description: "role",
      },
      themes: {
        type: "array",
        items: {
          type: "string",
          anyOf: [
            { type: "string", const: "web", title: "Web" },
            { type: "string", const: "open", title: "Open Ended" },
          ],
          enum: ["web", "open"],
        },
        uniqueItems: true,
        description: "themes",
      },
      same_value_checkboxes: {
        type: "array",
        items: {
          type: "string",
          anyOf: [
            { type: "string", const: "checked_checkbox", title: "Checked checkbox" },
            { type: "string", const: "default_checkbox", title: "Default checkbox" },
          ],
          enum: ["checked_checkbox", "default_checkbox"],
        },
        uniqueItems: true,
        description: "same_value_checkboxes",
      },
      same_value_radios: {
        type: "string",
        anyOf: [
          { type: "string", const: "checked_radio", title: "Checked radio" },
          { type: "string", const: "default_radio", title: "Default radio" },
        ],
        enum: ["checked_radio", "default_radio"],
        description: "same_value_radios",
      },
    },
    minProperties: 1,
    additionalProperties: false,
  });

  const result = JSON.parse(
    await context.document.modelContext.executeTool(
      tool,
      JSON.stringify({
        destination: "Graz",
        guests: "2",
        role: "student",
        themes: ["web"],
        same_value_checkboxes: ["checked_checkbox"],
        same_value_radios: "checked_radio",
      }),
    ),
  );
  assert.equal(destination.value, "Graz");
  assert.equal(guests.value, "2");
  assert.equal(student.checked, true);
  assert.equal(professional.checked, false);
  assert.equal(web.checked, true);
  assert.equal(openEnded.checked, false);
  assert.equal(checkedCheckbox.checked, true);
  assert.equal(defaultCheckbox.checked, false);
  assert.equal(checkedRadio.checked, true);
  assert.equal(defaultRadio.checked, false);
  assert.equal(result.structuredContent.submitted, false);
  assert.equal(focused, true);
  assert.equal(submitted, false);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
const context = { globalThis: {} };
vm.runInNewContext(await readFile(new URL("../src/control-utils.js", import.meta.url), "utf8"), context);
vm.runInNewContext(source, context);
const { agentHintText, annotateForm, controlLabel, humanizeName, labelText, toToolName } =
  context.globalThis.__webMcpAnnotator;

function element(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  const writes = [];
  return {
    getAttribute: (name) => values.get(name) || null,
    hasAttribute: (name) => values.has(name),
    removeAttribute: (name) => values.delete(name),
    setAttribute: (name, value) => {
      writes.push([name, value]);
      values.set(name, value);
    },
    values,
    writes,
  };
}

function control(attributes = {}) {
  return {
    ...element(attributes),
    disabled: false,
    readOnly: false,
    name: attributes.name || "destination",
    type: attributes.type || "text",
    labels: [{ textContent: attributes.label || "Destination" }],
    closest: () => null,
    matches: (selector) => selector !== ":disabled",
  };
}

function form(attributes = {}, controls = [control()]) {
  return {
    ...element(attributes),
    tagName: "FORM",
    id: attributes.id || "",
    elements: controls,
    closest: () => null,
    querySelector: () => null,
  };
}

test("generates bounded, non-submitting WebMCP annotations without repeated writes", () => {
  assert.equal(toToolName("Réserver un hôtel"), "reserver_un_hotel");
  assert.equal(toToolName(`A${" very long".repeat(20)}`).length, 30);

  let controlRemoved = false;
  assert.equal(
    labelText({
      cloneNode: () => ({
        get textContent() {
          return controlRemoved ? "Guests" : "Guests 1 guest 2 guests";
        },
        querySelectorAll: () => [{ remove: () => (controlRemoved = true) }],
      }),
    }),
    "Guests",
  );

  const destination = control({ name: "destination", placeholder: "Vienna" });
  const stayForm = form({ "aria-label": "Find a place to stay", id: "stay-search" }, [destination]);
  const result = annotateForm(stayForm, new Set(), 0, "WebMCP Form Lab");

  assert.equal(result.generated, true);
  assert.equal(stayForm.values.has("toolname"), false);
  assert.equal(stayForm.values.has("tooldescription"), false);
  assert.equal(
    stayForm.values.get("data-webmcp-tool-description"),
    "Fill in “Find a place to stay” on WebMCP Form Lab. Review and submit it manually.",
  );
  assert.equal(stayForm.values.get("data-webmcp-tool-title"), "Find a place to stay");
  assert.equal(destination.values.get("toolparamdescription"), "Destination");
  assert.equal(
    stayForm.values.get("data-webmcp-complete-tool"),
    "fill_find_a_place_to_stay",
  );
  assert.equal(stayForm.values.has("toolautosubmit"), false);

  const writes = stayForm.writes.length + destination.writes.length;
  annotateForm(stayForm, new Set(), 0, "WebMCP Form Lab");
  assert.equal(stayForm.writes.length + destination.writes.length, writes);

  const guests = control({ name: "guests", label: "Guests" });
  stayForm.elements.push(guests);
  annotateForm(stayForm, new Set(), 0, "WebMCP Form Lab");
  assert.equal(guests.values.get("toolparamdescription"), "Guests");

  const longLabel = "A form label that is deliberately much longer than thirty characters";
  const base = toToolName(`fill ${longLabel}`);
  const duplicateForm = form({ "aria-label": longLabel });
  const duplicateResult = annotateForm(duplicateForm, new Set([base]));
  assert.equal(duplicateResult.name.endsWith("_2"), true);
  assert.equal(duplicateResult.name.length <= 30, true);
});

test("uses form questions instead of option labels and humanizes weak names", () => {
  assert.equal(humanizeName("user_birth_month"), "Birth month");
  assert.equal(humanizeName("content-purpose"), "Content purpose");

  const question = {
    cloneNode: () => ({ textContent: "* Occupation", querySelectorAll: () => [] }),
    contains: () => false,
    control: null,
    htmlFor: "occupation",
    matches: (selector) => selector.includes("label"),
  };
  const group = {
    children: [],
    contains: () => true,
    parentElement: null,
    previousElementSibling: question,
    tagName: "DIV",
  };
  const student = control({ name: "occupation", type: "radio", label: "Student" });
  const professional = control({ name: "occupation", type: "radio", label: "Professional" });
  for (const option of [student, professional]) {
    option.parentElement = group;
  }
  assert.equal(controlLabel(student, [student, professional]), "Occupation");

  const language = control({ name: "language", label: "EN", type: "radio" });
  language.value = "en";
  assert.equal(controlLabel(language, [language]), "Language");
});

test("does not modify site-owned WebMCP forms or forms without usable fields", () => {
  const nativeControl = control({ name: "query", label: "Query" });
  const nativeForm = form(
    { toolname: "site_search", tooldescription: "Search this site." },
    [nativeControl],
  );
  assert.equal(annotateForm(nativeForm).skipped, "site-owned");
  assert.equal(nativeForm.writes.length + nativeControl.writes.length, 0);

  const emptyForm = form({ "aria-label": "Empty" }, [control({ name: "token", type: "hidden" })]);
  assert.equal(annotateForm(emptyForm).skipped, "no-fields");
  assert.equal(emptyForm.writes.length, 0);

  const uploadForm = form({ "aria-label": "Upload" }, [control({ name: "file", type: "file" })]);
  assert.equal(annotateForm(uploadForm).skipped, "no-fields");

  const hiddenForm = form({ "aria-label": "Hidden" });
  hiddenForm.closest = () => hiddenForm;
  assert.equal(annotateForm(hiddenForm).skipped, "hidden");
  assert.equal(hiddenForm.values.has("data-webmcp-complete-tool"), false);

  const readonly = control({ name: "generated_id", label: "Generated ID" });
  readonly.readOnly = true;
  const ariaHidden = control({ name: "company_website", label: "Leave blank" });
  ariaHidden.closest = () => ({});
  const protectedForm = form({ "aria-label": "Protected" }, [readonly, ariaHidden]);
  assert.equal(annotateForm(protectedForm).skipped, "no-fields");
});

test("creates a concise factual agent discovery hint", () => {
  assert.equal(
    agentHintText(["fill_preferences"]),
    "WEBMCP AVAILABLE ON THIS PAGE. Registered tools: fill_preferences. Prefer these structured tools over clicking individual form controls. If WebMCP actions are not listed directly, access document.modelContext from the page's main JavaScript world. Call document.modelContext.getTools(), inspect inputSchema, then call document.modelContext.executeTool(toolObject, JSON.stringify(input)). Use the tool object returned by getTools(). Fill tools edit controls; show/choose tools activate widgets; search tools navigate and send search parameters to the website.",
  );
  assert.equal(
    agentHintText(["one", "two", "three", "four"]),
    "WEBMCP AVAILABLE ON THIS PAGE. Registered tools: one, two, three (+1 more). Prefer these structured tools over clicking individual form controls. If WebMCP actions are not listed directly, access document.modelContext from the page's main JavaScript world. Call document.modelContext.getTools(), inspect inputSchema, then call document.modelContext.executeTool(toolObject, JSON.stringify(input)). Use the tool object returned by getTools(). Fill tools edit controls; show/choose tools activate widgets; search tools navigate and send search parameters to the website.",
  );
});

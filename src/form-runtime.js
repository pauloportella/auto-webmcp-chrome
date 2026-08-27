(() => {
  const TOOL_SELECTOR =
    "form[data-webmcp-complete-tool][data-webmcp-tool-description]";
  const INPUT_SCHEMA_DESCRIPTION =
    "Provide one or more fields to populate. Omitted fields remain unchanged. Fields required by the page may depend on another selection. This tool never submits the form.";
  const context = document.modelContext;
  const runtime = context?.__isWebMCPPolyfill ? "polyfill" : context ? "native" : "unavailable";
  const markRuntime = () => {
    const root = document.documentElement;
    if (root?.getAttribute("data-webmcp-form-runtime") !== runtime) {
      root?.setAttribute("data-webmcp-form-runtime", runtime);
    }
  };
  markRuntime();
  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", markRuntime, { once: true });
  }
  if (typeof context?.registerTool !== "function") return;

  const registrations = new Map();
  let scanScheduled = false;
  let scanAll = true;
  const dirtyForms = new Set();

  function cleanText(value, limit) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function controlsByName(form) {
    const groups = new Map();
    for (const control of form.elements) {
      if (
        control.disabled ||
        control.readOnly ||
        control.closest?.('[aria-hidden="true"]') ||
        !control.name ||
        !control.matches?.("input, select, textarea") ||
        ["button", "file", "hidden", "image", "reset", "submit"].includes(control.type)
      ) {
        continue;
      }
      const group = groups.get(control.name) || [];
      group.push(control);
      groups.set(control.name, group);
    }
    return groups;
  }

  function choiceTitle(control) {
    const label = control.labels?.[0];
    if (label?.cloneNode) {
      const copy = label.cloneNode(true);
      copy.querySelectorAll?.("input, select, textarea, button").forEach((element) =>
        element.remove(),
      );
      const text = cleanText(copy.textContent, 150);
      if (text) return text;
    }
    return cleanText(
      label?.textContent ||
        control.label ||
        control.textContent ||
        control.getAttribute?.("aria-label") ||
        control.value,
      150,
    );
  }

  function choiceDetails(controls) {
    const choices = [...controls]
      .filter((control) => !control.disabled)
      .map((control) => ({ control, title: choiceTitle(control), value: String(control.value) }));
    const valueCounts = new Map();
    for (const { value } of choices) valueCounts.set(value, (valueCounts.get(value) || 0) + 1);

    const usedTokens = new Set(
      choices
        .filter(({ value }) => value && valueCounts.get(value) === 1)
        .map(({ value }) => value),
    );
    return choices.map((choice, index) => {
      if (choice.value && valueCounts.get(choice.value) === 1) {
        return { ...choice, token: choice.value };
      }
      const base =
        cleanText(choice.title, 100)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") || `option_${index + 1}`;
      let token = base;
      for (let suffix = 2; usedTokens.has(token); suffix += 1) token = `${base}_${suffix}`;
      usedTokens.add(token);
      return { ...choice, token };
    });
  }

  function enumDetails(controls) {
    const choices = choiceDetails(controls);
    return {
      anyOf: choices.map(({ title, token }) => ({ type: "string", const: token, title })),
      enum: choices.map(({ token }) => token),
    };
  }

  function schemaForGroup(group) {
    const first = group[0];
    const description = cleanText(first.getAttribute("toolparamdescription"), 150);
    let schema;

    if (first.type === "radio") {
      schema = { type: "string", ...enumDetails(group) };
    } else if (first.type === "checkbox" && group.length === 1) {
      schema = { type: "boolean" };
    } else if (first.type === "checkbox") {
      schema = {
        type: "array",
        items: { type: "string", ...enumDetails(group) },
        uniqueItems: true,
      };
    } else if (first.tagName === "SELECT" && first.multiple) {
      schema = {
        type: "array",
        items: {
          type: "string",
          ...enumDetails(first.options),
        },
        uniqueItems: true,
      };
    } else if (first.tagName === "SELECT") {
      schema = {
        type: "string",
        ...enumDetails(first.options),
      };
    } else if (["number", "range"].includes(first.type)) {
      schema = { type: "number" };
    } else if (group.length > 1) {
      schema = { type: "array", items: { type: "string" } };
    } else {
      schema = { type: "string" };
    }

    const formats = { date: "date", email: "email", url: "uri" };
    if (schema.type === "string" && formats[first.type]) schema.format = formats[first.type];
    if (schema.type === "string" && first.type === "password") schema.writeOnly = true;
    if (schema.type === "string" && first.type === "color") {
      schema.pattern = "^#[0-9a-fA-F]{6}$";
    }
    if (schema.type === "string" && first.type === "month") schema.pattern = "^[0-9]{4}-[0-9]{2}$";
    if (schema.type === "string" && first.type === "week") {
      schema.pattern = "^[0-9]{4}-W[0-9]{2}$";
    }
    if (schema.type === "string" && first.pattern) schema.pattern = first.pattern;
    if (schema.type === "string" && first.minLength >= 0) schema.minLength = first.minLength;
    if (schema.type === "string" && first.maxLength >= 0) schema.maxLength = first.maxLength;
    if (schema.type === "number") {
      if (first.min !== "" && Number.isFinite(Number(first.min))) schema.minimum = Number(first.min);
      if (first.max !== "" && Number.isFinite(Number(first.max))) schema.maximum = Number(first.max);
      if (first.step !== "" && first.step !== "any" && Number(first.step) > 0) {
        schema.multipleOf = Number(first.step);
      }
    }
    const examples = [...(first.list?.options || [])].map(({ value }) => String(value)).filter(Boolean);
    if (schema.type === "string" && examples.length) schema.examples = examples;

    if (description) schema.description = description;
    return schema;
  }

  function inputSchema(form) {
    const properties = Object.create(null);
    for (const [name, group] of controlsByName(form)) {
      properties[name] = schemaForGroup(group);
    }
    return {
      type: "object",
      description: INPUT_SCHEMA_DESCRIPTION,
      properties,
      minProperties: 1,
      additionalProperties: false,
    };
  }

  function dispatchEdit(control) {
    control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setControlProperty(control, property, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), property)?.set;
    if (setter) setter.call(control, value);
    else control[property] = value;
  }

  function populateGroup(group, value) {
    const first = group[0];
    if (first.type === "radio") {
      for (const choice of choiceDetails(group)) {
        setControlProperty(choice.control, "checked", String(value) === choice.token);
        dispatchEdit(choice.control);
      }
      return;
    }
    if (first.type === "checkbox") {
      const selected = Array.isArray(value) ? new Set(value.map(String)) : null;
      for (const choice of choiceDetails(group)) {
        setControlProperty(
          choice.control,
          "checked",
          selected ? selected.has(choice.token) : Boolean(value),
        );
        dispatchEdit(choice.control);
      }
      return;
    }
    if (first.tagName === "SELECT") {
      const choices = choiceDetails(first.options);
      if (first.multiple) {
        const selected = new Set(Array.isArray(value) ? value.map(String) : []);
        for (const choice of choices) {
          setControlProperty(choice.control, "selected", selected.has(choice.token));
        }
      } else {
        const selectedIndex = choices.findIndex(({ token }) => token === String(value));
        if (selectedIndex >= 0) {
          const selected = choices[selectedIndex];
          if (choices.filter(({ value: optionValue }) => optionValue === selected.value).length > 1) {
            setControlProperty(first, "selectedIndex", [...first.options].indexOf(selected.control));
          } else {
            setControlProperty(first, "value", selected.value);
          }
        }
      }
      dispatchEdit(first);
      return;
    }
    if (group.length > 1 && Array.isArray(value)) {
      group.forEach((control, index) => {
        setControlProperty(control, "value", value[index] == null ? "" : String(value[index]));
        dispatchEdit(control);
      });
      return;
    }
    setControlProperty(first, "value", String(value));
    dispatchEdit(first);
  }

  function executeForm(form, args) {
    let populated = 0;
    for (const [name, group] of controlsByName(form)) {
      if (!Object.hasOwn(args, name)) continue;
      populateGroup(group, args[name]);
      populated += 1;
    }
    form.dispatchEvent(new Event("toolactivated", { bubbles: true, composed: true }));
    form.querySelector('button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled])')
      ?.focus({ preventScroll: true });
    return {
      content: [{ type: "text", text: `Populated ${populated} field(s). Review and submit manually.` }],
      structuredContent: { populatedFields: populated, submitted: false },
    };
  }

  function signature(form, schema) {
    return JSON.stringify({
      name: form.getAttribute("data-webmcp-complete-tool"),
      title: form.getAttribute("data-webmcp-tool-title"),
      description: form.getAttribute("data-webmcp-tool-description"),
      inputSchema: schema,
    });
  }

  function register(form) {
    const name = cleanText(form.getAttribute("data-webmcp-complete-tool"), 128);
    const title = cleanText(form.getAttribute("data-webmcp-tool-title"), 150);
    const description = cleanText(
      `Populate supported form controls in one WebMCP call. Supply only fields you want to change; omitted fields remain unchanged. This tool never submits the form. ${form.getAttribute("data-webmcp-tool-description")}`,
      500,
    );
    if (!name || !description || controlsByName(form).size === 0) return;

    const schema = inputSchema(form);
    const nextSignature = signature(form, schema);
    const current = registrations.get(form);
    if (current?.signature === nextSignature) return;
    current?.controller.abort();

    const controller = new AbortController();
    const registration = { controller, signature: nextSignature };
    registrations.set(form, registration);
    context
      .registerTool(
        {
          name,
          title,
          description,
          inputSchema: schema,
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: (args) => executeForm(form, args),
        },
        { signal: controller.signal },
      )
      .catch((error) => {
        if (registrations.get(form) === registration) registrations.delete(form);
        console.warn(`[Auto WebMCP] Could not register ${name}:`, error);
      });
  }

  function scan() {
    scanScheduled = false;
    markRuntime();
    if (!scanAll) {
      for (const form of dirtyForms) {
        if (form.isConnected && form.matches?.(TOOL_SELECTOR)) register(form);
      }
      dirtyForms.clear();
      for (const [form, registration] of registrations) {
        if (form.isConnected && form.matches?.(TOOL_SELECTOR)) continue;
        registration.controller.abort();
        registrations.delete(form);
      }
      return;
    }

    scanAll = false;
    dirtyForms.clear();
    const seenForms = new Set();
    const seenNames = new Set();
    for (const form of document.querySelectorAll(TOOL_SELECTOR)) {
      const name = cleanText(form.getAttribute("data-webmcp-complete-tool"), 128);
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);
      seenForms.add(form);
      register(form);
    }
    for (const [form, registration] of registrations) {
      if (seenForms.has(form) && form.isConnected) continue;
      registration.controller.abort();
      registrations.delete(form);
    }
  }

  function scheduleScan(forms) {
    if (!forms) scanAll = true;
    else for (const form of forms) dirtyForms.add(form);
    if (scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(scan);
  }

  function affectedToolForms(mutations) {
    const forms = new Set();
    let needsFullScan = false;
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const form =
          mutation.target.tagName === "FORM"
            ? mutation.target
            : mutation.target.closest?.(TOOL_SELECTOR);
        if (form) forms.add(form);
        continue;
      }
      const owner = mutation.target.closest?.(TOOL_SELECTOR);
      if (owner) forms.add(owner);
      if (
        [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            node.nodeType === 1 &&
            (node.matches?.(TOOL_SELECTOR) || node.querySelector?.(TOOL_SELECTOR)),
        )
      ) {
        needsFullScan = true;
      }
    }
    return needsFullScan ? null : forms;
  }

  new MutationObserver((mutations) => {
    const forms = affectedToolForms(mutations);
    if (forms === null || forms.size) scheduleScan(forms || undefined);
  }).observe(document, {
    attributes: true,
    attributeFilter: [
      "data-webmcp-tool-description",
      "disabled",
      "data-webmcp-complete-tool",
      "multiple",
      "name",
      "required",
      "toolparamdescription",
      "type",
      "value",
    ],
    childList: true,
    subtree: true,
  });
  scheduleScan();
})();

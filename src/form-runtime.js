(() => {
  const controlUtils = globalThis.__autoWebMcpControls;
  const TOOL_SELECTOR = controlUtils.toolSelector;
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
  const searches = new Map();
  const searchTools = globalThis.__autoWebMcpSearch;
  let scanScheduled = false;
  let scanAll = true;
  let scanning = false;
  let executions = 0;
  let statusRevision = 0;
  const dirtyForms = new Set();

  function cleanText(value, limit) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function controlsByName(form) {
    const groups = new Map();
    if (!form.isConnected || form.closest?.('[hidden], [aria-hidden="true"]')) return groups;
    for (const control of controlUtils.controls(form)) {
      if (!controlUtils.eligible(control) || !controlUtils.key(control)) continue;
      const name = controlUtils.key(control);
      const group = groups.get(name) || [];
      group.push(control);
      groups.set(name, group);
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
      .filter((control) => !control.disabled && !control.closest?.('optgroup[disabled], [hidden], [aria-hidden="true"]'))
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

    if (group.length > 1 && !["radio", "checkbox"].includes(first.type)) {
      const schemas = [...new Map(group.map((control) => {
        const item = schemaForGroup([control]);
        return [JSON.stringify(item), item];
      })).values()];
      return {
        type: "array",
        items: schemas.length === 1 ? schemas[0] : { anyOf: schemas },
        minItems: group.length,
        maxItems: group.length,
        description: "Supply every entry in form order; this replaces the complete group.",
      };
    }
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
    } else {
      schema = { type: "string" };
    }

    const formats = { date: "date", email: "email", url: "uri" };
    if (schema.type === "string" && formats[first.type] && !first.multiple) schema.format = formats[first.type];
    if (schema.type === "string" && first.type === "password") schema.writeOnly = true;
    if (schema.type === "string" && first.type === "color") {
      schema.pattern = "^#[0-9a-fA-F]{6}$";
    }
    if (schema.type === "string" && first.type === "month") schema.pattern = "^[0-9]{4}-[0-9]{2}$";
    if (schema.type === "string" && first.type === "week") {
      schema.pattern = "^[0-9]{4}-W[0-9]{2}$";
    }
    // ponytail: HTML's Unicode-set patterns cannot always be expressed in JSON Schema;
    // enforce them with the browser below instead of publishing a different regex.

    if (schema.type === "string" && first.minLength >= 0) schema.minLength = first.minLength;
    if (schema.type === "string" && first.maxLength >= 0) schema.maxLength = first.maxLength;
    if (schema.type === "number") {
      if (first.min !== "" && Number.isFinite(Number(first.min))) schema.minimum = Number(first.min);
      if (first.max !== "" && Number.isFinite(Number(first.max))) schema.maximum = Number(first.max);
      if (first.step !== "" && first.step !== "any" && Number(first.step) > 0) {
        const base = Number(first.min || first.getAttribute("value") || 0);
        if (Number.isInteger(base / Number(first.step))) schema.multipleOf = Number(first.step);
      }
    }
    const examples = [...(first.list?.options || [])].map(({ value }) => String(value)).filter(Boolean);
    if (schema.type === "string" && examples.length) schema.examples = examples;

    const guidance = [description, first.pattern ? `HTML pattern: ${first.pattern}` : ""].filter(Boolean).join(". ");
    if (guidance) schema.description = cleanText(guidance, 150);
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

  function assignments(group, value) {
    const first = group[0];
    if (group.length > 1 && !["radio", "checkbox"].includes(first.type)) {
      if (!Array.isArray(value) || value.length !== group.length) throw new Error("Invalid group length");
      return group.flatMap((control, index) => assignments([control], value[index]));
    }
    if (first.type === "radio" || first.type === "checkbox" || first.tagName === "SELECT") {
      const choices = choiceDetails(first.tagName === "SELECT" ? first.options : group);
      const singleCheckbox = first.type === "checkbox" && group.length === 1;
      const multiple = first.multiple || (first.type === "checkbox" && group.length > 1);
      if (singleCheckbox) {
        if (typeof value !== "boolean") throw new Error("Invalid checkbox value");
        return [{ control: first, property: "checked", value }];
      }
      const selected = multiple ? value : [value];
      if (!Array.isArray(selected) || (!multiple && typeof value !== "string") ||
          new Set(selected).size !== selected.length ||
          selected.some((token) => typeof token !== "string" || !choices.some((choice) => choice.token === token))) {
        throw new Error("Invalid choice");
      }
      if (first.tagName === "SELECT" && !first.multiple) {
        return [{ control: first, property: "selectedIndex", value: [...first.options].indexOf(choices.find((choice) => choice.token === value).control) }];
      }
      return choices.map((choice) => ({
        control: choice.control,
        property: first.tagName === "SELECT" ? "selected" : "checked",
        value: selected.includes(choice.token),
      }));
    }
    const numeric = ["number", "range"].includes(first.type);
    if (numeric ? typeof value !== "number" || !Number.isFinite(value) : typeof value !== "string") {
      throw new Error("Invalid field type");
    }
    const text = String(value);
    const probe = first.cloneNode(true);
    probe.removeAttribute("id");
    probe.removeAttribute("name");
    probe.removeAttribute("form");
    probe.required = false;
    probe.value = text;
    if (probe.value !== text || !probe.validity.valid ||
        (text && first.minLength >= 0 && text.length < first.minLength) ||
        (first.maxLength >= 0 && text.length > first.maxLength)) {
      throw new Error("Invalid field value");
    }
    return [{ control: first, property: "value", value: text }];
  }

  function currentAssignments(form, name, value) {
    const group = controlsByName(form).get(name);
    if (!group) throw new Error("Field unavailable");
    return assignments(group, value);
  }

  async function executeForm(form, args) {
    const completed = new Set();
    const original = form, parent = form.parentElement;
    // ponytail: resolve standalone replacements within the original parent only;
    // ambiguous matches stay unverified instead of guessing across the page.
    const resolveForm = () => {
      if (form.isConnected || !original.matches(controlUtils.selector) || !parent?.isConnected) return form;
      const matches = [...parent.children].filter(control =>
        control.tagName === original.tagName && control.type === original.type &&
        control.id === original.id && controlUtils.key(control) === controlUtils.key(original) &&
        controlUtils.scope(control) === control);
      if (matches.length === 1) form = matches[0];
      return form;
    };
    executions += 1;
    try {
      if (!args || typeof args !== "object" || Array.isArray(args) || !Object.keys(args).length) {
        throw new Error("Invalid arguments");
      }
      // Validate every requested group before any website event can cause a side effect.
      for (const [name, value] of Object.entries(args)) currentAssignments(form, name, value);
      for (const [name, value] of Object.entries(args)) {
        const edits = currentAssignments(resolveForm(), name, value);
        const changed = new Set();
        for (const edit of edits) {
          if (edit.control[edit.property] === edit.value) continue;
          if (!edit.control.isConnected || (edit.property !== "selected" && !controlUtils.eligible(edit.control))) {
            throw new Error("Control became unavailable");
          }
          if (edit.property === "checked") {
            if (edit.control.type !== "radio" || edit.value) edit.control.click();
            continue;
          }
          setControlProperty(edit.control, edit.property, edit.value);
          changed.add(edit.control.tagName === "OPTION" ? edit.control.closest("select") : edit.control);
        }
        for (const control of changed) {
          if (!control.isConnected || controlUtils.scope(control) !== form || !controlsByName(form).get(name)?.includes(control)) {
            throw new Error("Form changed during editing");
          }
          dispatchEdit(control);
        }
        // Give queued website updates a turn, then resolve the next field from the live form.
        await new Promise((resolve) => setTimeout(resolve, 0));
        completed.add(name);
      }
    } catch {
      // Do not retry or roll back: the website may already have processed edit events.
    } finally {
      for (const name of completed) {
        try {
          if (!currentAssignments(resolveForm(), name, args[name]).every((edit) => edit.control[edit.property] === edit.value)) {
            completed.delete(name);
          }
        } catch { completed.delete(name); }
      }
      executions -= 1;
      setTimeout(() => scheduleScan([form]), 0);
    }
    const populated = completed.size;
    const failed = Math.max(1, Object.keys(args || {}).length) - populated;
    if (!failed) {
      form.dispatchEvent(new Event("toolactivated", { bubbles: true, composed: true }));
    }
    return {
      ...(failed ? { isError: true } : {}),
      content: [{ type: "text", text: failed
        ? `Verified ${populated} field(s); ${failed} field(s) could not be verified. Review the form before continuing.`
        : `Populated ${populated} field(s). Review and submit manually.` }],
      structuredContent: { populatedFields: populated, failedFields: failed, submitted: false },
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

  async function publishStatus() {
    const revision = ++statusRevision;
    let status;
    try {
      const tools = await context.getTools();
      const names = tools.map(({ name }) => cleanText(name, 128)).filter(Boolean);
      status = { count: tools.length, names: names.slice(0, 20), error: false };
    } catch {
      status = { count: 0, names: [], error: true };
    }
    if (revision !== statusRevision) return;
    const root = document.documentElement;
    const value = JSON.stringify(status);
    if (root && root.getAttribute("data-webmcp-registry-status") !== value) {
      root.setAttribute("data-webmcp-registry-status", value);
    }
  }

  function unregister(form) {
    const current = registrations.get(form);
    if (!current) return;
    current.controller.abort();
    registrations.delete(form);
  }

  async function executeWidget(widget, kind, args) {
    if (!widget.isConnected || controlUtils.widgetKind(widget) !== kind) return { isError: true, content: [{type: "text", text: "This control is no longer available. Discover tools again."}] };
    let selected;
    if (kind === "choose") {
      selected = controlUtils.options(widget).find(choice => choice.token === args?.option);
      if (!selected) return { isError: true, content: [{type: "text", text: "This option is no longer available. Discover tools again."}] };
    }
    const owners = kind === "choose" && widget.id ? [...document.querySelectorAll('input[aria-controls]')]
      .filter(input => input.getAttribute('aria-controls').split(/\s+/).includes(widget.id))
      .map(input => ({input, value: input.value})) : [];
    const done = () => {
      if (kind === "choose") {
        const live = controlUtils.options(widget).find(choice => choice.token === args.option)?.option;
        return Boolean(widget.isConnected && live && (live.getAttribute("aria-selected") === "true" || live.getAttribute("aria-checked") === "true")) ||
          owners.some(({input, value}) => input.isConnected && input.value !== value &&
            selected.title && cleanText(input.value, 150) === selected.title);
      }
      return widget.isConnected && (widget.getAttribute("aria-expanded") === "true" ||
        widget.parentElement?.tagName === "DETAILS" && widget.parentElement.open ||
        Boolean(controlUtils.popup(widget) && controlUtils.visible(controlUtils.popup(widget))));
    };
    executions += 1;
    try {
      if (!done()) (selected?.option || widget).click();
      await new Promise(resolve => setTimeout(resolve, 0));
      // ponytail: bounded observation, not event guessing or automatic retries.
      for (let attempt = 0; attempt < 20 && !done(); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      const verified = done();
      return {
        structuredContent: {activated: true, verified},
        content: [{type: "text", text: verified
          ? kind === "choose" ? "Option selected. Review the page." : "Controls opened. Discover tools again for the visible choices."
          : "Control activated, but the resulting state could not be verified. Review the page before continuing."}],
      };
    } finally {
      executions -= 1;
      setTimeout(() => scheduleScan(), 0);
    }
  }

  async function register(form, usedNames) {
    let name = cleanText(form.getAttribute("data-webmcp-complete-tool"), 128);
    const current = registrations.get(form);
    const kind = form.getAttribute("data-webmcp-tool-kind");
    if (!name || !form.isConnected || !form.matches?.(TOOL_SELECTOR) || (kind ? controlUtils.widgetKind(form) !== kind : !controlsByName(form).size)) {
      unregister(form);
      return;
    }
    const choices = kind === "choose" ? controlUtils.options(form) : [];
    const schema = kind ? {
      type: "object",
      properties: kind === "choose" ? { option: {
        type: "string", enum: choices.map(choice => choice.token),
        anyOf: choices.map(({token, title}) => ({const: token, title})),
        description: "Choose from currently rendered options only.",
      } } : {},
      ...(kind === "choose" ? {required: ["option"]} : {}),
      additionalProperties: false,
    } : inputSchema(form);
    const nextSignature = signature(form, schema);
    if (current?.signature === nextSignature) return schema;
    if (current) {
      usedNames.delete(current.name);
      unregister(form);
    }
    const base = name;
    for (let suffix = 2; usedNames.has(name); suffix += 1) {
      const ending = `_${suffix}`;
      name = `${base.slice(0, 30 - ending.length)}${ending}`;
    }
    if (name !== base) form.setAttribute("data-webmcp-complete-tool", name);
    const controller = new AbortController();
    try {
      await context.registerTool({
        name,
        title: cleanText(form.getAttribute("data-webmcp-tool-title"), 150),
        description: cleanText(
          kind ? form.getAttribute("data-webmcp-tool-description") : `Populate supported controls. Omitted fields remain unchanged. Review and submit manually. ${form.getAttribute("data-webmcp-tool-description")}`,
          500,
        ),
        inputSchema: schema,
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (args) => kind ? executeWidget(form, kind, args) : executeForm(form, args),
      }, { signal: controller.signal });
      registrations.set(form, { name, controller, signature: signature(form, schema) });
      usedNames.add(name);
    } catch {
      controller.abort();
      console.warn("[Auto WebMCP] Could not register a form tool.");
    }
    return schema;
  }

  async function registerSearch(form, usedNames, fillSchema) {
    const route = searchTools.plan(form);
    const current = searches.get(form);
    const remove = () => {
      if (current) { current.controller.abort(); searches.delete(form); usedNames.delete(current.name); }
    };
    if (!route || !form.isConnected) { remove(); return; }
    const schema = {...(route.schema || fillSchema || inputSchema(form))};
    schema.description = route.adapter ? "Navigate once to matching marketplace results. Omitted filters reset to defaults." : "Navigate to search results using the declared GET route. Omitted fields use current values. No form events are dispatched.";
    const fingerprint = JSON.stringify([route.action, route.adapter, route.submitter?.name, route.submitter?.value, schema]);
    if (current?.signature === fingerprint) return;
    remove();
    const base = route.name || `search_${(form.getAttribute("data-webmcp-complete-tool") || "form").replace(/^fill_/, "")}`.slice(0,30);
    let name = base;
    for (let n=2; usedNames.has(name); n++) name = `${base.slice(0,26)}_${n}`;
    const controller = new AbortController();
    try {
      await context.registerTool({name, title: route.title || "Search this site",
        description: route.adapter
          ? "Search Willhaben in one navigation with supported area, price, condition and sorting filters. Omitted filters reset to defaults."
          : "Run this site's declared GET search in the current tab without filling or opening controls. Sends search parameters to the website and navigates away.",
        inputSchema: schema,
        annotations: {readOnlyHint: false, openWorldHint: true},
        execute: args => {
          try {
            if (!args || typeof args !== "object" || Array.isArray(args) || !Object.keys(args).length) throw new Error("Provide search fields.");
            const live = searchTools.plan(form);
            if (!live || live.action !== route.action || live.submitter !== route.submitter) throw new Error("Search routing changed. Discover tools again.");
            const target = searchTools.url(form,args,currentAssignments);
            setTimeout(() => location.assign(target.href),50);
            return {content:[{type:"text",text:"Search navigation scheduled. Inspect the destination page for results."}],structuredContent:{navigationScheduled:true}};
          } catch (error) {
            return {isError:true,content:[{type:"text",text:cleanText(error.message,200)}]};
          }
        },
      },{signal:controller.signal});
      searches.set(form,{name,controller,signature:fingerprint});
      usedNames.add(name);
    } catch { controller.abort(); }
  }

  async function scan() {
    scanScheduled = false;
    if (scanning || executions) return;
    scanning = true;
    markRuntime();
    const forms = scanAll ? new Set(document.querySelectorAll(TOOL_SELECTOR)) : new Set(dirtyForms);
    scanAll = false;
    dirtyForms.clear();
    try {
      const usedNames = new Set((await context.getTools()).map(({ name }) => name));
      if (executions) {
        for (const form of forms) dirtyForms.add(form);
        return;
      }
      for (const form of registrations.keys()) {
        if (!form.isConnected || !form.matches?.(TOOL_SELECTOR)) {
          usedNames.delete(registrations.get(form).name);
          unregister(form);
        }
      }
      for (const [form, search] of searches) {
        if (!form.isConnected) { search.controller.abort(); searches.delete(form); }
      }
      await registerSearch(document.documentElement, usedNames);
      for (const form of forms) {
        try { const schema = await register(form, usedNames); await registerSearch(form, usedNames, schema); }
        catch { console.warn("[Auto WebMCP] Could not inspect a form tool."); }
      }
    } finally {
      scanning = false;
      await publishStatus();
      if (scanAll || dirtyForms.size) scheduleScan([]);
    }
  }

  function scheduleScan(forms) {
    if (!forms) scanAll = true;
    else for (const form of forms) dirtyForms.add(form);
    if (scanScheduled || scanning || executions) return;
    scanScheduled = true;
    queueMicrotask(() => { void scan().catch(() => publishStatus()); });
  }

  function affectedToolForms(mutations) {
    const forms = new Set();
    let needsFullScan = false;
    for (const mutation of mutations) {
      if (!controlUtils.relevantMutation(mutation)) continue;
      const target = mutation.target.nodeType === 3 ? mutation.target.parentElement : mutation.target;
      if (["form", "id"].includes(mutation.attributeName)) needsFullScan = true;
      if (mutation.type === "attributes") {
        const form =
          target.tagName === "FORM"
            ? target
            : target.matches?.(controlUtils.selector) ? controlUtils.scope(target) : target.closest?.(TOOL_SELECTOR);
        if (form) forms.add(form);
        for (const childForm of target.querySelectorAll?.(TOOL_SELECTOR) || []) forms.add(childForm);
        continue;
      }
      const owner = target.matches?.(controlUtils.selector) ? controlUtils.scope(target) : target.closest?.(TOOL_SELECTOR);
      if (owner) forms.add(owner);
      for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
        if (node.matches?.(controlUtils.selector)) forms.add(controlUtils.scope(node));
        if (node.matches?.("[form]") || node.querySelector?.("[form]")) needsFullScan = true;
      }
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
      "disabled", "readonly", "hidden", "aria-hidden", "inert", "form", "id", "class", "style", "role",
      "data-webmcp-field-key", "data-webmcp-tool-kind", "aria-disabled", "aria-selected", "aria-checked", "aria-expanded", "aria-controls", "open",
      "action", "method", "target", "formaction", "formmethod", "formtarget", "dirname",
      "min", "max", "step", "pattern", "minlength", "maxlength", "list",
      "data-webmcp-tool-title", "label",
      "data-webmcp-complete-tool",
      "multiple",
      "name",
      "required",
      "toolparamdescription",
      "type",
      "value",
    ],
    childList: true,
    characterData: true,
    subtree: true,
  });
  context.addEventListener?.("toolchange", () => { void publishStatus(); });
  scheduleScan();
})();

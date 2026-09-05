const controlUtils = globalThis.__autoWebMcpControls;
const TOOL_NAME_LIMIT = 30;
const TOOL_DESCRIPTION_LIMIT = 500;
const PARAMETER_DESCRIPTION_LIMIT = 150;
const AGENT_HINT_SELECTOR = "[data-webmcp-agent-hint]";
const COMPLETE_TOOL_ATTRIBUTE = "data-webmcp-complete-tool";
const TOOL_DESCRIPTION_ATTRIBUTE = "data-webmcp-tool-description";
const TOOL_TITLE_ATTRIBUTE = "data-webmcp-tool-title";
const generatedForms = new WeakSet();
const generatedDescriptions = new WeakMap();
const dirtyForms = new Set();
let scanAll = false;
let scanScheduled = false;

function cleanText(value, limit = Infinity) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function toToolName(value) {
  return (
    cleanText(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, TOOL_NAME_LIMIT)
      .replace(/_+$/g, "") || "fill_form"
  );
}

function referencedText(control, attribute) {
  return cleanText((control.getAttribute(attribute) || "").split(/\s+/)
    .map((id) => control.ownerDocument?.getElementById(id)?.textContent || "").join(" "), PARAMETER_DESCRIPTION_LIMIT);
}

function formLabel(form, index) {
  if (controlUtils.widgetKind(form)) {
    return referencedText(form, "aria-labelledby") || cleanText(form.getAttribute("aria-label")) ||
      cleanText(form.labels?.[0]?.textContent) || cleanText(form.textContent, 150) || "Choices";
  }
  if (form.matches?.(controlUtils.selector)) return controlLabel(form, [form]);
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  const submitLabel = cleanText(submit?.textContent || submit?.value, PARAMETER_DESCRIPTION_LIMIT);
  const specificSubmitLabel = /^(submit|continue|next|save|send|go)$/i.test(submitLabel)
    ? ""
    : submitLabel;
  return (
    referencedText(form, "aria-labelledby") ||
    cleanText(form.getAttribute("aria-label"), PARAMETER_DESCRIPTION_LIMIT) ||
    cleanText(form.querySelector("legend, h1, h2, h3")?.textContent, PARAMETER_DESCRIPTION_LIMIT) ||
    specificSubmitLabel ||
    cleanText(
      form.closest?.("section, main, article")?.querySelector?.("h1, h2, h3")?.textContent,
      PARAMETER_DESCRIPTION_LIMIT,
    ) ||
    submitLabel ||
    cleanText(form.getAttribute("name"), PARAMETER_DESCRIPTION_LIMIT) ||
    cleanText(form.id, PARAMETER_DESCRIPTION_LIMIT) ||
    `Form ${index + 1}`
  );
}

function labelText(label) {
  if (!label?.cloneNode) return cleanText(label?.textContent, PARAMETER_DESCRIPTION_LIMIT);
  const copy = label.cloneNode(true);
  copy.querySelectorAll("input, select, textarea, button").forEach((element) => element.remove());
  return cleanText(copy.textContent, PARAMETER_DESCRIPTION_LIMIT);
}

function cleanLabel(value) {
  return cleanText(value, PARAMETER_DESCRIPTION_LIMIT).replace(/^\*\s*/, "").replace(/:\s*$/, "");
}

function humanizeName(value) {
  const words = String(value || "")
    .replace(/\[([^\]]*)\]/g, " $1 ")
    .replace(/\(\d+i?\)/gi, " ")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(user|form)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Field";
}

function normalizedIdentifier(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fieldFamily(value) {
  return normalizedIdentifier(value).replace(/_(?:[123]i|day|month|year)$/, "");
}

function commonAncestor(elements) {
  let node = elements[0];
  while (node && !elements.every((element) => node.contains?.(element))) node = node.parentElement;
  return node;
}

function promptText(element, controls) {
  if (!element?.matches?.("label, legend, h1, h2, h3, h4, h5, h6")) return "";
  if (controls.some((control) => element.contains?.(control))) return "";
  if (element.matches("label")) {
    if (element.control) {
      if (fieldFamily(element.control.name) !== fieldFamily(controls[0]?.name)) return "";
    } else if (
      normalizedIdentifier(element.htmlFor) !== normalizedIdentifier(controls[0]?.name)
    ) {
      return "";
    }
  }
  return cleanLabel(labelText(element));
}

function nearbyGroupLabel(controls) {
  let node = commonAncestor(controls);
  for (let depth = 0; node && node.tagName !== "FORM" && depth < 6; depth += 1) {
    for (const child of node.children || []) {
      const text = promptText(child, controls);
      if (text) return text;
    }
    const previousText = promptText(node.previousElementSibling, controls);
    if (previousText) return previousText;
    node = node.parentElement;
  }
  return "";
}

function controlLabel(control, controls, peers = controls.filter((candidate) => candidate.name === control.name)) {
  const grouped = ["checkbox", "radio"].includes(control.type) && peers.length > 1;
  if (grouped) return nearbyGroupLabel(peers) || humanizeName(control.name);

  const aria = cleanLabel(
    referencedText(control, "aria-labelledby") || control.getAttribute("aria-label") ||
    referencedText(control, "aria-describedby") || control.getAttribute("aria-description"),
  );
  if (aria) return aria;

  const ownLabel = cleanLabel(labelText(control.labels?.[0]));
  const choiceValues =
    control.tagName === "SELECT"
      ? [...(control.options || [])].map(({ value }) => value)
      : ["checkbox", "radio"].includes(control.type)
        ? [control.value]
        : [];
  const weakLabel =
    ownLabel &&
    choiceValues
      .filter(Boolean)
      .some((value) => ownLabel.toLowerCase() === String(value).toLowerCase());
  if (ownLabel && !weakLabel) return ownLabel;

  let nearby = nearbyGroupLabel([control]);
  if (
    nearby &&
    choiceValues
      .filter(Boolean)
      .some((value) => nearby.toLowerCase() === String(value).toLowerCase())
  ) {
    nearby = "";
  }
  const firstOption = control.options?.[0];
  const optionHint = firstOption?.value === "" ? cleanLabel(firstOption.textContent) : "";
  if (nearby && optionHint && !nearby.toLowerCase().includes(optionHint.toLowerCase())) {
    return cleanText(`${nearby} — ${optionHint}`, PARAMETER_DESCRIPTION_LIMIT);
  }
  return (
    nearby ||
    cleanLabel(control.getAttribute("placeholder")) ||
    humanizeName(control.name)
  );
}

function eligibleControls(form) {
  return controlUtils.controls(form).filter(controlUtils.eligible);
}

function uniqueToolName(label, usedNames, verb = "fill") {
  const base = toToolName(`${verb} ${label}`);
  let name = base;
  for (let suffix = 2; usedNames.has(name); suffix += 1) {
    const ending = `_${suffix}`;
    name = `${base.slice(0, TOOL_NAME_LIMIT - ending.length)}${ending}`;
  }
  return name;
}

function annotateForm(form, usedNames = new Set(), index = 0, pageTitle = "this site") {
  const label = formLabel(form, index);
  const controls = eligibleControls(form);
  const siteName = cleanText(form.getAttribute("toolname"));
  const siteDescription = cleanText(form.getAttribute("tooldescription"));
  let name = cleanText(form.getAttribute(COMPLETE_TOOL_ATTRIBUTE), 128);
  let description = cleanText(form.getAttribute(TOOL_DESCRIPTION_ATTRIBUTE));

  if (!generatedForms.has(form) && !name && (siteName || siteDescription)) {
    if (siteName) usedNames.add(siteName);
    return { name: siteName, label, generated: false, skipped: "site-owned" };
  }
  if (!controls.length || form.closest?.('[hidden], [aria-hidden="true"]')) {
    if (generatedForms.has(form)) {
      form.removeAttribute(COMPLETE_TOOL_ATTRIBUTE);
      form.removeAttribute(TOOL_DESCRIPTION_ATTRIBUTE);
      form.removeAttribute(TOOL_TITLE_ATTRIBUTE);
      generatedForms.delete(form);
    }
    return { name, label, generated: false, skipped: controls.length ? "hidden" : "no-fields" };
  }

  const keys = new Set(controls.map(controlUtils.key).filter(Boolean));
  for (const control of controls) {
    if (controlUtils.key(control)) continue;
    const base = toToolName(control.id || controlLabel(control, controls) || "field");
    let key = base;
    for (let suffix = 2; keys.has(key); suffix += 1) key = `${base}_${suffix}`;
    control.setAttribute("data-webmcp-field-key", key);
    keys.add(key);
  }

  if (!name) {
    name = uniqueToolName(label, usedNames);
    form.setAttribute(COMPLETE_TOOL_ATTRIBUTE, name);
  }
  usedNames.add(name);

  if (!cleanText(form.getAttribute(TOOL_TITLE_ATTRIBUTE))) {
    form.setAttribute(TOOL_TITLE_ATTRIBUTE, label);
  }

  if (!description) {
    description = cleanText(
      `Fill in “${label}” on ${cleanText(pageTitle, PARAMETER_DESCRIPTION_LIMIT)}. Review and submit it manually.`,
      TOOL_DESCRIPTION_LIMIT,
    );
    form.setAttribute(TOOL_DESCRIPTION_ATTRIBUTE, description);
  }
  generatedForms.add(form);

  const peers = new Map();
  for (const control of controls) {
    const group = peers.get(controlUtils.key(control)) || [];
    group.push(control);
    peers.set(controlUtils.key(control), group);
  }
  const groupLabels = new Map();
  for (const control of controls) {
    const group = peers.get(controlUtils.key(control));
    const grouped = group.length > 1 && ["checkbox", "radio"].includes(control.type);
    let parameterDescription = grouped ? groupLabels.get(controlUtils.key(control)) : null;
    if (!parameterDescription) {
      const label = controlLabel(control, controls, group);
      const detail = referencedText(control, "aria-describedby") || cleanText(control.getAttribute("aria-description"));
      parameterDescription = cleanText(detail && detail !== label ? `${label}. ${detail}` : label, PARAMETER_DESCRIPTION_LIMIT);
      if (grouped) groupLabels.set(controlUtils.key(control), parameterDescription);
    }
    const previous = control.getAttribute("toolparamdescription");
    if (parameterDescription && (!cleanText(previous) || previous === generatedDescriptions.get(control))) {
      if (previous !== parameterDescription) control.setAttribute("toolparamdescription", parameterDescription);
      generatedDescriptions.set(control, parameterDescription);
    }
  }
  return { name, label, generated: true };
}

function agentHintText(toolNames, total = toolNames.length) {
  const preview = toolNames.slice(0, 3).join(", ");
  const remaining = total - 3;
  return `WEBMCP AVAILABLE ON THIS PAGE. Registered tools: ${preview}${
    remaining > 0 ? ` (+${remaining} more)` : ""
  }. Prefer these structured tools over clicking individual form controls. If WebMCP actions are not listed directly, access document.modelContext from the page's main JavaScript world. Call document.modelContext.getTools(), inspect inputSchema, then call document.modelContext.executeTool(toolObject, JSON.stringify(input)). Use the tool object returned by getTools(). Fill tools edit controls; show/choose tools activate widgets; search tools navigate and send search parameters to the website.`;
}

function updateAgentHint() {
  const root = document.documentElement;
  if (!root) return;

  const { names: toolNames, count } = registryStatus();
  let hint = document.querySelector(AGENT_HINT_SELECTOR);

  if (!toolNames.length) {
    root.removeAttribute("data-webmcp-tools-available");
    root.removeAttribute("data-webmcp-tool-count");
    hint?.remove();
    return;
  }

  root.setAttribute("data-webmcp-tools-available", "true");
  root.setAttribute("data-webmcp-tool-count", String(count));

  if (!hint) {
    hint = document.createElement("div");
    hint.setAttribute("data-webmcp-agent-hint", "");
    hint.setAttribute("role", "note");
    hint.setAttribute("aria-label", "WebMCP agent integration metadata");
    hint.style.cssText = [
      "all:initial!important",
      "position:fixed!important",
      "left:-10000px!important",
      "top:auto!important",
      "width:1px!important",
      "height:1px!important",
      "overflow:hidden!important",
      "clip:rect(0,0,0,0)!important",
      "white-space:nowrap!important",
      "pointer-events:none!important",
    ].join(";");
    (document.body || root).append(hint);
  }

  const text = agentHintText(toolNames, count);
  if (hint.textContent !== text) hint.textContent = text;
}

function annotateWidget(widget, usedNames, index) {
  const kind = controlUtils.widgetKind(widget);
  if (!kind || (kind === "choose" && !controlUtils.options(widget).length)) {
    if (widget.hasAttribute("data-webmcp-tool-kind")) {
      widget.removeAttribute(COMPLETE_TOOL_ATTRIBUTE);
      widget.removeAttribute(TOOL_DESCRIPTION_ATTRIBUTE);
    }
    return;
  }
  const label = formLabel(widget, index);
  const existing = widget.getAttribute(COMPLETE_TOOL_ATTRIBUTE);
  if (!existing) {
    const name = uniqueToolName(label, usedNames, kind === "expand" ? "show" : "choose");
    widget.setAttribute(COMPLETE_TOOL_ATTRIBUTE, name);
    usedNames.add(name);
  }
  if (widget.getAttribute("data-webmcp-tool-kind") !== kind) widget.setAttribute("data-webmcp-tool-kind", kind);
  const description = kind === "expand"
    ? `Show the controls or choices for ${label}. Discover tools again after opening. This only activates the disclosure.`
    : `Choose one currently rendered option in ${label}. More options may appear after scrolling or typing.`;
  if (widget.getAttribute(TOOL_DESCRIPTION_ATTRIBUTE) !== description) widget.setAttribute(TOOL_DESCRIPTION_ATTRIBUTE, description);
  if (widget.getAttribute(TOOL_TITLE_ATTRIBUTE) !== label) widget.setAttribute(TOOL_TITLE_ATTRIBUTE, label);
}

function annotateAll(selected = null) {
  const forms = [...new Set([...document.forms, ...[...document.querySelectorAll(controlUtils.selector)].filter(control => !control.form).map(controlUtils.scope)])];
  const widgets = [...document.querySelectorAll(controlUtils.widgetSelector)];
  const usedNames = new Set(
    [...forms, ...widgets].flatMap((form) => [cleanText(form.getAttribute("toolname")), cleanText(form.getAttribute(COMPLETE_TOOL_ATTRIBUTE), 128)]).filter(Boolean),
  );
  forms.forEach((form, index) => {
    if (!selected || selected.has(form)) annotateForm(form, usedNames, index, document.title || location.host);
  });
  widgets.forEach((widget, index) => annotateWidget(widget, usedNames, index));
  updateAgentHint();
}

function scheduleAnnotation(forms) {
  if (!forms) scanAll = true;
  else for (const form of forms) dirtyForms.add(form);
  if (scanScheduled) return;
  scanScheduled = true;
  queueMicrotask(() => {
    scanScheduled = false;
    const selected = scanAll ? null : new Set(dirtyForms);
    scanAll = false;
    dirtyForms.clear();
    annotateAll(selected);
  });
}

function affectedForms(mutations) {
  const forms = new Set();
  for (const mutation of mutations) {
      if (!controlUtils.relevantMutation(mutation)) continue;
    if (mutation.attributeName === "data-webmcp-registry-status") {
      updateAgentHint();
      continue;
    }
    if (["form", "id", "role", "aria-controls", "aria-expanded", "open"].includes(mutation.attributeName)) return null;
    const target = mutation.target.nodeType === 3 ? mutation.target.parentElement : mutation.target;
    const owner = target?.matches?.(controlUtils.selector) ? controlUtils.scope(target) : target?.closest?.(controlUtils.toolSelector);
    if (owner) forms.add(owner);
    const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
    if (nodes.some(node => node.matches?.(controlUtils.widgetSelector) || node.querySelector?.(controlUtils.widgetSelector)) || target?.closest?.(controlUtils.widgetSelector)) return null;
    if (mutation.type === "attributes") nodes.push(target);
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const form = node.matches?.(controlUtils.selector) ? controlUtils.scope(node) : node.closest?.(controlUtils.toolSelector);
      if (form) forms.add(form);
      for (const child of node.querySelectorAll?.("form, input, select, textarea") || []) {
        if (child.matches("form")) forms.add(child);
        else forms.add(controlUtils.scope(child));
      }
    }
    // Explicit external label references need refreshing when their text changes.
    if (target?.id && !target.closest?.("form")) {
      for (const control of document.querySelectorAll("[aria-labelledby], [aria-describedby]")) {
        const ids = `${control.getAttribute("aria-labelledby") || ""} ${control.getAttribute("aria-describedby") || ""}`.split(/\s+/);
        if (ids.includes(target.id)) {
          const form = controlUtils.scope(control);
          if (form) forms.add(form);
        }
      }
    }
  }
  return forms;
}

function registryStatus() {
  // Page-world metadata is display-only, never authority for privileged operations.
  try {
    const raw = document.documentElement?.getAttribute("data-webmcp-registry-status");
    if (!raw || raw.length > 10000) throw new Error("Missing status");
    const status = JSON.parse(raw);
    if (!Number.isSafeInteger(status.count) || status.count < 0 || !Array.isArray(status.names) ||
        status.names.length > 20 || status.names.some((name) => typeof name !== "string" || name.length > 128)) {
      throw new Error("Invalid status");
    }
    return { count: status.count, names: status.names, error: status.error === true };
  } catch { return { count: 0, names: [], error: true }; }
}

async function getStatus() {
  const forms = [...document.querySelectorAll(controlUtils.toolSelector)];
  const status = registryStatus();
  const runtime = document.documentElement?.getAttribute("data-webmcp-form-runtime");
  const available = ["native", "polyfill"].includes(runtime);
  return {
    apiAvailable: available,
    apiError: available && status.error ? "Unable to confirm registered tools. Refresh this page." : null,
    runtime: available ? runtime : "unavailable",
    annotatedForms: forms.filter((form) => form.hasAttribute(COMPLETE_TOOL_ATTRIBUTE) || form.hasAttribute("toolname")).length,
    generatedForms: forms.filter((form) => generatedForms.has(form)).length,
    toolCount: status.count,
    toolNames: status.names,
  };
}

globalThis.__webMcpAnnotator = {
  agentHintText,
  annotateForm,
  controlLabel,
  humanizeName,
  labelText,
  toToolName,
};

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "WEBMCP_STATUS") return undefined;
    getStatus().then(sendResponse, (error) => sendResponse({ error: cleanText(error, 200) }));
    return true;
  });
}

if (typeof document !== "undefined" && document.documentElement) {
  annotateAll();
  new MutationObserver((mutations) => {
    const forms = affectedForms(mutations);
    if (forms === null || forms.size) scheduleAnnotation(forms);
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["aria-hidden", "hidden", "inert", "disabled", "readonly", "name", "type", "form", "id", "role", "class", "style",
      "aria-expanded", "aria-controls", "aria-haspopup", "aria-disabled", "open", "aria-label", "aria-labelledby", "aria-describedby", "aria-description", "placeholder", "for",
      "data-webmcp-registry-status"],
    characterData: true,
    childList: true,
    subtree: true,
  });
}

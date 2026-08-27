const TOOL_NAME_LIMIT = 30;
const TOOL_DESCRIPTION_LIMIT = 500;
const PARAMETER_DESCRIPTION_LIMIT = 150;
const AGENT_HINT_SELECTOR = "[data-webmcp-agent-hint]";
const COMPLETE_TOOL_ATTRIBUTE = "data-webmcp-complete-tool";
const TOOL_DESCRIPTION_ATTRIBUTE = "data-webmcp-tool-description";
const TOOL_TITLE_ATTRIBUTE = "data-webmcp-tool-title";
const generatedForms = new WeakSet();
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

function formLabel(form, index) {
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  const submitLabel = cleanText(submit?.textContent || submit?.value, PARAMETER_DESCRIPTION_LIMIT);
  const specificSubmitLabel = /^(submit|continue|next|save|send|go)$/i.test(submitLabel)
    ? ""
    : submitLabel;
  return (
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

function controlLabel(control, controls) {
  const peers = controls.filter((candidate) => candidate.name === control.name);
  const grouped = ["checkbox", "radio"].includes(control.type) && peers.length > 1;
  if (grouped) return nearbyGroupLabel(peers) || humanizeName(control.name);

  const aria = cleanLabel(
    control.getAttribute("aria-description") || control.getAttribute("aria-label"),
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
  return [...form.elements].filter(
    (control) =>
      !control.disabled &&
      !control.readOnly &&
      !control.closest?.('[aria-hidden="true"]') &&
      control.matches?.("input[name], select[name], textarea[name]") &&
      !["button", "file", "hidden", "image", "reset", "submit"].includes(control.type),
  );
}

function uniqueToolName(label, usedNames) {
  const base = toToolName(`fill ${label}`);
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
  if (form.closest?.('[hidden], [aria-hidden="true"]')) {
    if (generatedForms.has(form)) {
      form.removeAttribute(COMPLETE_TOOL_ATTRIBUTE);
      form.removeAttribute(TOOL_DESCRIPTION_ATTRIBUTE);
      form.removeAttribute(TOOL_TITLE_ATTRIBUTE);
      generatedForms.delete(form);
    }
    return { name, label, generated: false, skipped: "hidden" };
  }
  if (!controls.length) return { name, label, generated: false, skipped: "no-fields" };

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

  for (const control of controls) {
    const parameterDescription = controlLabel(control, controls);
    if (parameterDescription && !cleanText(control.getAttribute("toolparamdescription"))) {
      control.setAttribute("toolparamdescription", parameterDescription);
    }
  }
  return { name, label, generated: true };
}

function agentHintText(toolNames) {
  const preview = toolNames.slice(0, 3).join(", ");
  const remaining = toolNames.length - 3;
  return `WEBMCP AVAILABLE ON THIS PAGE. Registered tools: ${preview}${
    remaining > 0 ? ` (+${remaining} more)` : ""
  }. Prefer these structured tools over clicking individual form controls. If WebMCP actions are not listed directly, access document.modelContext from the page's main JavaScript world. Call document.modelContext.getTools(), inspect inputSchema, then call document.modelContext.executeTool(toolObject, JSON.stringify(input)). Use the tool object returned by getTools(). Generated tools populate supported controls and never submit forms.`;
}

function updateAgentHint() {
  const root = document.documentElement;
  if (!root) return;

  const toolNames = [
    ...new Set(
      [...document.forms]
        .filter(
          (form) =>
            form.hasAttribute(COMPLETE_TOOL_ATTRIBUTE) &&
            form.hasAttribute(TOOL_DESCRIPTION_ATTRIBUTE),
        )
        .map((form) => cleanText(form.getAttribute(COMPLETE_TOOL_ATTRIBUTE), 128))
        .filter(Boolean),
    ),
  ];
  let hint = document.querySelector(AGENT_HINT_SELECTOR);

  if (!toolNames.length) {
    root.removeAttribute("data-webmcp-tools-available");
    root.removeAttribute("data-webmcp-tool-count");
    hint?.remove();
    return;
  }

  root.setAttribute("data-webmcp-tools-available", "true");
  root.setAttribute("data-webmcp-tool-count", String(toolNames.length));

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

  const text = agentHintText(toolNames);
  if (hint.textContent !== text) hint.textContent = text;
}

function annotateAll() {
  const forms = [...document.forms];
  const usedNames = new Set(
    forms
      .flatMap((form) => [
        cleanText(form.getAttribute("toolname")),
        cleanText(form.getAttribute(COMPLETE_TOOL_ATTRIBUTE), 128),
      ])
      .filter(Boolean),
  );
  forms.forEach((form, index) => annotateForm(form, usedNames, index, document.title || location.host));
  updateAgentHint();
}

function scheduleAnnotation() {
  if (scanScheduled) return;
  scanScheduled = true;
  queueMicrotask(() => {
    scanScheduled = false;
    annotateAll();
  });
}

function touchesForm(mutations) {
  return mutations.some((mutation) => {
    if (mutation.type === "attributes") {
      return mutation.target.matches?.("form") || mutation.target.querySelector?.("form");
    }
    return [...mutation.addedNodes].some(
      (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node.closest?.("form") || node.querySelector?.("form")),
    );
  });
}

async function getStatus() {
  const forms = [...document.forms];
  const annotated = forms.filter(
    (form) =>
      (form.hasAttribute(COMPLETE_TOOL_ATTRIBUTE) &&
        form.hasAttribute(TOOL_DESCRIPTION_ATTRIBUTE)) ||
      (form.hasAttribute("toolname") && form.hasAttribute("tooldescription")),
  );
  const runtime =
    document.documentElement?.getAttribute("data-webmcp-form-runtime") ||
    (typeof document.modelContext?.getTools === "function" ? "native" : "unavailable");
  const apiAvailable = runtime !== "unavailable";
  let tools = [];
  let apiError = null;

  if (runtime === "native" && typeof document.modelContext?.getTools === "function") {
    try {
      tools = await document.modelContext.getTools();
    } catch (error) {
      apiError = cleanText(error, 200);
    }
  } else if (runtime === "polyfill") {
    tools = annotated.map((form) => ({
      name: cleanText(
        form.getAttribute(COMPLETE_TOOL_ATTRIBUTE) || form.getAttribute("toolname"),
        100,
      ),
    }));
  }

  return {
    apiAvailable,
    apiError,
    runtime,
    annotatedForms: annotated.length,
    generatedForms: forms.filter((form) => generatedForms.has(form)).length,
    toolCount: tools.length,
    toolNames: tools.slice(0, 20).map(({ name }) => cleanText(name, 100)),
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
    if (touchesForm(mutations)) scheduleAnnotation();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["aria-hidden", "hidden"],
    childList: true,
    subtree: true,
  });
}

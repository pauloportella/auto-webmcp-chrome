const state = document.querySelector("#state");
const generated = document.querySelector("#generated");
const available = document.querySelector("#available");
const tools = document.querySelector("#tools");
const compatibility = document.querySelector("#compatibility");

function setState(text, kind = "") {
  state.textContent = text;
  state.className = `state ${kind}`.trim();
}

function renderTools(names) {
  tools.replaceChildren(
    ...names.map((name) => {
      const item = document.createElement("li");
      item.textContent = name;
      item.title = name;
      return item;
    }),
  );
}

async function refresh() {
  setState("Checking this page…");
  generated.textContent = "—";
  available.textContent = "—";
  compatibility.textContent = "";
  renderTools([]);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) throw new Error("No active tab.");
    const status = await chrome.tabs.sendMessage(tab.id, { type: "WEBMCP_STATUS" });
    if (status?.error) throw new Error(status.error);

    generated.textContent = String(status.generatedForms);
    available.textContent = status.apiAvailable ? String(status.toolCount) : "Off";
    renderTools(status.toolNames || []);

    if (status.apiError) {
      setState("WebMCP returned an error", "error");
      compatibility.textContent = status.apiError;
    } else if (!status.apiAvailable) {
      setState("WebMCP runtime unavailable", "error");
      compatibility.textContent = "Reload the extension from chrome://extensions and refresh this page.";
    } else {
      setState(`${status.annotatedForms} form(s) ready`);
      compatibility.textContent =
        status.runtime === "polyfill"
          ? "Packaged WebMCP page runtime active."
          : "Chrome’s native WebMCP runtime is active.";
    }
  } catch {
    setState("Unavailable on this page", "error");
    compatibility.textContent =
      "Chrome blocks extensions on protected pages such as chrome:// and the Chrome Web Store.";
  }
}

document.querySelector("#refresh").addEventListener("click", refresh);
void refresh();

const SERVER = "http://127.0.0.1:7891";
const BYTES_PER_TIB = 1024 ** 4;
const DEFAULT_COST_PER_TIB = 6.25;

const btn = document.getElementById("calculate");
const cardEl = document.getElementById("result-card");
const costEl = document.getElementById("result-cost");
const bytesEl = document.getElementById("result-bytes");
const projEl = document.getElementById("result-proj");
const errorEl = document.getElementById("result-error");
const selectEl = document.getElementById("project-select");
const refreshEl = document.getElementById("project-refresh");
const sqlTextareaEl = document.getElementById("sql-input");
const settingsToggleEl = document.getElementById("settings-toggle");
const settingsPanelEl = document.getElementById("settings-panel");
const priceInputEl = document.getElementById("price-input");

const editor = CodeMirror.fromTextArea(sqlTextareaEl, {
  mode: "text/x-sql",
  lineNumbers: true,
  matchBrackets: true,
  styleActiveLine: true,
  indentUnit: 2,
  tabSize: 2,
  viewportMargin: Infinity,
});

init();

async function init() {
  const { cachedProjects = [], selectedProject, costPerTib } = await chrome.storage.local.get([
    "cachedProjects",
    "selectedProject",
    "costPerTib",
  ]);

  priceInputEl.value = Number.isFinite(costPerTib) && costPerTib >= 0 ? costPerTib : DEFAULT_COST_PER_TIB;

  if (cachedProjects.length) {
    renderProjects(cachedProjects, selectedProject);
  } else {
    await refreshProjects();
  }

  await prefillFromSelection();

  selectEl.addEventListener("change", () => {
    chrome.storage.local.set({ selectedProject: selectEl.value });
  });

  settingsToggleEl.addEventListener("click", () => {
    settingsPanelEl.classList.toggle("open");
  });

  priceInputEl.addEventListener("change", () => {
    const price = readPrice();
    priceInputEl.value = price;
    chrome.storage.local.set({ costPerTib: price });
  });

  refreshEl.addEventListener("click", refreshProjects);
  btn.addEventListener("click", calculate);
}

function readPrice() {
  const v = parseFloat(priceInputEl.value);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_COST_PER_TIB;
}

async function prefillFromSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab?.id) {
      const text = await readPageSelection(tab.id);
      if (text && text.trim()) {
        setEditorText(text);
        chrome.storage.session.remove("pendingSql");
        return;
      }

      // Fallback for virtualized editors (Monaco / CodeMirror) where
      // window.getSelection() returns nothing: dispatch a copy event, which
      // the editor will hook to put the real selected text on the clipboard.
      if (await tryCopyTrickPrefill(tab.id)) {
        chrome.storage.session.remove("pendingSql");
        return;
      }
    }

    // Last resort: consume anything the context menu stashed on a prior right-click.
    const { pendingSql } = await chrome.storage.session.get("pendingSql");
    if (pendingSql) {
      setEditorText(pendingSql);
      chrome.storage.session.remove("pendingSql");
    }
  } catch {
    // Restricted pages (chrome://, Web Store, etc.) — silently skip.
  }
}

function setEditorText(text) {
  editor.setValue(text);
  editor.setCursor(0, 0);
}

async function readPageSelection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.getSelection()?.toString() ?? "",
    });
    for (const r of results || []) {
      if (r?.result && r.result.trim()) return r.result;
    }
  } catch {}
  return "";
}

async function tryCopyTrickPrefill(tabId) {
  let previousClipboard = null;
  try {
    try { previousClipboard = await navigator.clipboard.readText(); } catch {}

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try { return document.execCommand("copy"); } catch { return false; }
      },
    });
    const copied = results?.[0]?.result === true;
    if (!copied) return false;

    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { return false; }

    if (text && text.trim() && text !== previousClipboard) {
      setEditorText(text);
      return true;
    }
    return false;
  } finally {
    if (previousClipboard !== null) {
      try { await navigator.clipboard.writeText(previousClipboard); } catch {}
    }
  }
}

async function refreshProjects() {
  refreshEl.disabled = true;
  const originalText = refreshEl.textContent;
  refreshEl.textContent = "…";

  try {
    const resp = await fetch(`${SERVER}/projects`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Server error");

    const projects = data.projects || [];
    await chrome.storage.local.set({ cachedProjects: projects });

    const { selectedProject } = await chrome.storage.local.get(["selectedProject"]);
    renderProjects(projects, selectedProject);
    errorEl.style.display = "none";
  } catch (err) {
    const msg = err.message.includes("Failed to fetch")
      ? "Cannot reach server. Is bqcheck-server running?"
      : err.message;
    if (!selectEl.options.length) {
      selectEl.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(server unreachable)";
      opt.disabled = true;
      selectEl.appendChild(opt);
    }
    showError(msg);
  } finally {
    refreshEl.disabled = false;
    refreshEl.textContent = originalText;
  }
}

function renderProjects(projects, selectedProject) {
  selectEl.innerHTML = "";
  if (!projects.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no projects)";
    opt.disabled = true;
    selectEl.appendChild(opt);
    return;
  }

  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.projectId;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  }

  const remembered = selectedProject && projects.some((p) => p.projectId === selectedProject)
    ? selectedProject
    : null;
  const desired = remembered || projects[0].projectId;
  selectEl.value = desired;
  if (desired !== selectedProject) {
    chrome.storage.local.set({ selectedProject: desired });
  }
}

async function calculate() {
  btn.disabled = true;
  btn.textContent = "Calculating...";
  cardEl.style.display = "none";
  errorEl.style.display = "none";

  try {
    const project = selectEl.value;
    if (!project) {
      showError("Pick a project first.");
      return;
    }

    const sql = editor.getValue();
    if (!sql.trim()) {
      showError("Paste some SQL first.");
      return;
    }

    const resp = await fetch(`${SERVER}/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, project }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Server error");

    const price = readPrice();
    const cost = (data.total_bytes_processed / BYTES_PER_TIB) * price;

    costEl.textContent = `$${cost.toFixed(4)}`;
    bytesEl.textContent = data.bytes_human;
    projEl.textContent = `project: ${data.project || project} · $${price}/TiB`;
    cardEl.style.display = "block";

    chrome.action.setBadgeText({ text: formatCost(cost) });
    chrome.action.setBadgeBackgroundColor({ color: "#4285F4" });
  } catch (err) {
    const msg = err.message.includes("Failed to fetch")
      ? "Cannot reach server. Run: uv run bqcheck-server"
      : err.message;
    showError(msg);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "&#9654; Calculate Cost";
  }
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

function formatCost(cost) {
  if (cost < 0.01) return "<1c";
  if (cost < 1) return `${Math.ceil(cost * 100)}c`;
  return `$${cost.toFixed(0)}`;
}

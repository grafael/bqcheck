import {
  SERVER,
  BYTES_PER_TIB,
  DEFAULT_COST_PER_TIB,
  formatCost,
  readSelection,
} from "./shared.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "bqcheck-estimate",
    title: "Check BQ cost",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== "bqcheck-estimate" || !info.selectionText) return;
  chrome.storage.session.set({ pendingSql: info.selectionText });
  estimateAndBadge(info.selectionText);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "bqcheck-estimate-selection") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const sql = await readSelection(tab.id);
  if (!sql || !sql.trim()) {
    setBadge("?", "#888888");
    return;
  }
  chrome.storage.session.set({ pendingSql: sql });
  estimateAndBadge(sql);
});

async function estimateAndBadge(sql) {
  setBadge("...", "#888888");

  const { selectedProject, costPerTib } = await chrome.storage.local.get([
    "selectedProject",
    "costPerTib",
  ]);
  const price = Number.isFinite(costPerTib) && costPerTib >= 0 ? costPerTib : DEFAULT_COST_PER_TIB;

  try {
    const resp = await fetch(`${SERVER}/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, project: selectedProject || undefined }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Server error");

    const cost = (data.total_bytes_processed / BYTES_PER_TIB) * price;
    setBadge(formatCost(cost), "#4285F4");
  } catch {
    setBadge("ERR", "#CC0000");
  }
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

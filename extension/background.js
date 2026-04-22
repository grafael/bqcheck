const SERVER = "http://127.0.0.1:7891";
const BYTES_PER_TIB = 1024 ** 4;
const DEFAULT_COST_PER_TIB = 6.25;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "bqcheck-estimate",
    title: "Check BQ cost",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "bqcheck-estimate" || !info.selectionText) return;

  setBadge("...", "#888888");

  // Stash the selection so the popup can prefill from it if opened next.
  chrome.storage.session.set({ pendingSql: info.selectionText });

  const { selectedProject, costPerTib } = await chrome.storage.local.get([
    "selectedProject",
    "costPerTib",
  ]);
  const price = Number.isFinite(costPerTib) && costPerTib >= 0 ? costPerTib : DEFAULT_COST_PER_TIB;

  try {
    const resp = await fetch(`${SERVER}/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: info.selectionText, project: selectedProject || undefined }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Server error");

    const cost = (data.total_bytes_processed / BYTES_PER_TIB) * price;
    setBadge(formatCost(cost), "#4285F4");
  } catch {
    setBadge("ERR", "#CC0000");
  }
});

function formatCost(cost) {
  if (cost < 0.01) return "<1c";
  if (cost < 1) return `${Math.ceil(cost * 100)}c`;
  return `$${cost.toFixed(0)}`;
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

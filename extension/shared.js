export const SERVER = "http://127.0.0.1:7891";
export const BYTES_PER_TIB = 1024 ** 4;
export const DEFAULT_COST_PER_TIB = 6.25;

export function formatCost(cost) {
  if (cost < 0.01) return "<1c";
  if (cost < 1) return `${Math.ceil(cost * 100)}c`;
  return `$${cost.toFixed(0)}`;
}

// Read the user's text selection from the active tab. Tries window.getSelection()
// first, then falls back to dispatching a copy event for virtualized editors
// (Monaco / CodeMirror) whose selection isn't visible to getSelection(). The
// fallback preserves the prior clipboard contents.
export async function readSelection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.getSelection()?.toString() ?? "",
    });
    for (const r of results || []) {
      if (r?.result && r.result.trim()) return r.result;
    }
  } catch {}

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        let prev = null;
        try { prev = await navigator.clipboard.readText(); } catch {}
        const copied = (() => {
          try { return document.execCommand("copy"); } catch { return false; }
        })();
        if (!copied) return "";
        let text = "";
        try { text = await navigator.clipboard.readText(); } catch { return ""; }
        if (prev !== null && text !== prev) {
          try { await navigator.clipboard.writeText(prev); } catch {}
        }
        return text && text !== prev ? text : "";
      },
    });
    return results?.[0]?.result || "";
  } catch {
    return "";
  }
}

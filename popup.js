import {DEFAULT_SETTINGS} from "./core.mjs";
const $ = id => document.getElementById(id);
let busy = false;

function status(text, kind = "info") {
  $("message").textContent = text;
  $("message").className = `message ${kind === "info" ? "" : kind}`;
}

async function settings() {
  const data = await chrome.storage.local.get("settings");
  return {...DEFAULT_SETTINGS, ...(data.settings || {})};
}

async function updateSettingsPreview() {
  const data = await settings();
  $("model").textContent = data.model || "No model configured";
  $("detail").textContent = `${data.target} / ${data.style}${data.review ? " / review ON" : ""}`;
}

async function currentTab() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  const tab = tabs[0];
  if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) {
    throw new Error("Open an ordinary http/https webpage. Chrome internal pages and PDF viewers cannot be translated in this MVP.");
  }
  return tab;
}

async function communicate(type, preferences) {
  const tab = await currentTab();
  let installed = false;
  try { installed = !!(await chrome.tabs.sendMessage(tab.id, {type: "CF_PING"}))?.ok; }
  catch {}
  if (!installed) {
    await chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ["content.css"]});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
  }
  return await chrome.tabs.sendMessage(tab.id, {type, preferences});
}

async function runAction(kind) {
  if (busy) return;
  busy = true;
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  try {
    if (kind === "CF_START") {
      const config = await settings();
      if (!config.model.trim()) throw new Error("First open Settings and enter an OpenAI-compatible model ID.");
      status("Starting the translation...", "info");
      const result = await communicate(kind, {maxBlocks: config.maxBlocks});
      status(result.started
        ? `Started with ${result.found} content blocks. Follow progress in the page's bottom-right corner.`
        : "No article paragraphs found on this webpage.", result.started ? "success" : "error");
    } else if (kind === "CF_STOP") {
      await communicate(kind);
      status("Stopped scheduling new batches. An in-flight API call may still incur charges.", "success");
    } else if (kind === "CF_CLEAR") {
      await communicate(kind);
      status("Translation overlays removed. Original text is unchanged.", "success");
    }
  } catch (error) {
    status(String(error?.message || error), "error");
  } finally {
    busy = false;
    for (const button of document.querySelectorAll("button")) button.disabled = false;
  }
}

$("start").addEventListener("click", () => runAction("CF_START"));
$("stop").addEventListener("click", () => runAction("CF_STOP"));
$("clear").addEventListener("click", () => runAction("CF_CLEAR"));
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
void updateSettingsPreview().catch(error => status(String(error?.message || error), "error"));

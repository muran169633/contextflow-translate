import {DEFAULT_SETTINGS} from "./core.mjs";
import {formatDiscussion} from "./discussion-core.mjs";
import {setupLanguage, translate} from "./ui-language.mjs";
import {contentMessages} from "./i18n.mjs";
import {DEFAULT_ENGINE, FREE_ORIGIN, LANGUAGE_CODES, normalizeEngine} from "./free-translate.mjs";
const $ = id => document.getElementById(id);
let busy = false;
let language = "en";
let engine = {...DEFAULT_ENGINE};
let saveQueue = Promise.resolve();
const t = (key, values) => translate(language, key, values);

function renderEngine() {
  $("provider").value = engine.provider;
  $("free-controls").hidden = engine.provider !== "mymemory";
  $("ai-controls").hidden = engine.provider !== "ai";
  const names = new Intl.DisplayNames([language], {type: "language"});
  for (const [id, selected] of [["freeSource", engine.source], ["freeTarget", engine.target]]) {
    const select = $(id);
    select.replaceChildren(...LANGUAGE_CODES.map(code => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = names.of(code) || code;
      return option;
    }));
    select.value = selected;
  }
}

function persistEngine(snapshot = {...engine}) {
  saveQueue = saveQueue.catch(() => {}).then(() => chrome.storage.local.set({translationEngine: snapshot}));
  return saveQueue;
}

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
  $("model").textContent = data.model || t("noModel");
  $("detail").textContent = `${data.target} / ${t(data.style)}${data.review ? ` / ${t("reviewOn")}` : ""}`;
}

async function currentTab() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  const tab = tabs[0];
  if (!tab?.id || !/^https?:\/\//.test(tab.url || "")) {
    throw new Error(t("invalidTab"));
  }
  return tab;
}

async function communicate(type, preferences) {
  const tab = await currentTab();
  let ping;
  try { ping = await chrome.tabs.sendMessage(tab.id, {type: "CF_PING"}); }
  catch {}
  if (ping?.ok && ping.protocol !== 2) throw new Error(t("refreshPage"));
  if (!ping?.ok) {
    await chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ["content.css"]});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
  }
  return await chrome.tabs.sendMessage(tab.id, {type, preferences});
}

async function copyDiscussion() {
  if (busy) return;
  busy = true;
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  try {
    status(t("readingDiscussion"));
    const tab = await currentTab();
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["discussion.js"]});
    const result = await chrome.tabs.sendMessage(tab.id, {type: "CF_COPY_DISCUSSION"});
    if (!result?.ok) throw new Error(result?.errorKey ? t(result.errorKey, result.values) : result?.error || t("copyError"));
    const formatted = formatDiscussion(result.topic, {emptyMessage: t("noDiscussion")});
    await navigator.clipboard.writeText(formatted.text);
    const warning = result.warningKey ? t(result.warningKey, result.warningValues) : "";
    status(`${t("copied", {count: formatted.count})}${warning}`, warning ? "info" : "success");
  } catch (error) {
    status(String(error?.message || error), "error");
  } finally {
    busy = false;
    for (const button of document.querySelectorAll("button")) button.disabled = false;
  }
}

async function runAction(kind) {
  if (busy) return;
  const selectedEngine = {...engine};
  let permission;
  if (kind === "CF_START" && selectedEngine.provider === "mymemory") {
    if (selectedEngine.source === selectedEngine.target) { status(t("sameLanguage"), "error"); return; }
    // Called synchronously from the click handler to preserve the user gesture.
    permission = chrome.permissions.request({origins: [FREE_ORIGIN]});
  }
  busy = true;
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  for (const id of ["provider", "freeSource", "freeTarget"]) $(id).disabled = true;
  try {
    if (kind === "CF_START") {
      const config = await settings();
      if (selectedEngine.provider === "ai" && !config.model.trim()) throw new Error(t("needModel"));
      if (permission && !await permission) throw new Error(t("permissionFree"));
      let protocol;
      try { protocol = await chrome.runtime.sendMessage({type: "CF_ENGINE_PROTOCOL"}); }
      catch { throw new Error(t("reloadExtension")); }
      if (!protocol?.ok || protocol.protocol !== 2) throw new Error(t("reloadExtension"));
      await persistEngine(selectedEngine);
      status(t("starting"), "info");
      const result = await communicate(kind, {engine: selectedEngine, maxBlocks: config.maxBlocks, messages: contentMessages(language)});
      status(result.started
        ? t("started", {count: result.found})
        : t("noParagraphs"), result.started ? "success" : "error");
    } else if (kind === "CF_STOP") {
      await communicate(kind);
      status(t("stopped"), "success");
    } else if (kind === "CF_CLEAR") {
      await communicate(kind);
      status(t("cleared"), "success");
    }
  } catch (error) {
    status(String(error?.message || error), "error");
  } finally {
    busy = false;
    for (const button of document.querySelectorAll("button")) button.disabled = false;
    for (const id of ["provider", "freeSource", "freeTarget"]) $(id).disabled = false;
  }
}

$("start").addEventListener("click", () => runAction("CF_START"));
$("stop").addEventListener("click", () => runAction("CF_STOP"));
$("clear").addEventListener("click", () => runAction("CF_CLEAR"));
$("copy-discussion").addEventListener("click", () => void copyDiscussion());
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
for (const [id, key] of [["provider", "provider"], ["freeSource", "source"], ["freeTarget", "target"]]) {
  $(id).addEventListener("change", () => {
    engine[key] = $(id).value;
    renderEngine();
    void persistEngine().catch(error => status(String(error?.message || error), "error"));
  });
}
void (async () => {
  const config = await settings();
  const stored = await chrome.storage.local.get("translationEngine");
  engine = normalizeEngine(stored.translationEngine, !!config.model.trim());
  await setupLanguage(next => {
    language = next;
    renderEngine();
    void updateSettingsPreview().catch(error => status(String(error?.message || error), "error"));
  });
  for (const id of ["provider", "freeSource", "freeTarget", "start"]) $(id).disabled = false;
})().catch(error => status(String(error?.message || error), "error"));

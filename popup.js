import {DEFAULT_SETTINGS} from "./core.mjs";
import {formatDiscussion} from "./discussion-core.mjs";
import {setupLanguage, translate} from "./ui-language.mjs";
import {contentMessages} from "./i18n.mjs";
import {DEFAULT_ENGINE, FREE_ORIGIN, LANGUAGE_CODES, normalizeEngine, supportsAutoSource} from "./free-translate.mjs";
import {GOOGLE_TRANSLATE_ORIGIN} from "./google-translate.mjs";
import {GOOGLE_WEB_ORIGIN} from "./google-web-translate.mjs";
import {YOUDAO_ORIGIN} from "./youdao-translate.mjs";
import {MICROSOFT_ORIGIN} from "./microsoft-translate.mjs";
import {LIBRE_LOCAL_ORIGIN} from "./libre-local.mjs";
import {BAIDU_ORIGIN} from "./baidu-translate.mjs";
import {KAGGLE_NOTEBOOK_ORIGIN, isKaggleNotebook, sendToKaggleNotebook} from "./kaggle-frames.mjs";
const $ = id => document.getElementById(id);
let busy = false;
let language = "en";
let engine = {...DEFAULT_ENGINE};
let saveQueue = Promise.resolve();
let quickSetup = Promise.resolve();
let quickReady = false;
let googleKeyPresent = false;
let youdaoKeysPresent = false;
let microsoftKeyPresent = false;
let baiduKeysPresent = false;
let displayMode = "bilingual";
let displayQueue = Promise.resolve();
let activeTabUrl = "";
const t = (key, values) => translate(language, key, values);

function renderDisplayMode() {
  for (const mode of ["bilingual", "original"]) $("mode-" + mode).setAttribute("aria-pressed", String(displayMode === mode));
}

async function setDisplayMode(mode) {
  if (busy) return;
  try {
    await quickSetup;
    if (mode === displayMode) return;
    const result = await communicate("CF_SET_DISPLAY", {mode});
    if (!result?.ok) throw new Error(t("displayError"));
    displayMode = result.displayMode;
    renderDisplayMode();
    const warning = result.notebookStatus && result.notebookStatus !== "ok" ? ` ${t("kaggleFrameWarning")}` : "";
    status(t(mode === "original" ? "showingOriginal" : "showingBilingual") + warning, warning ? "error" : "success");
  } catch (error) { status(String(error?.message || error), "error"); }
}

function renderEngine() {
  $("provider").value = engine.provider;
  $("free-controls").hidden = engine.provider === "ai";
  $("mymemory-info").hidden = engine.provider !== "mymemory";
  $("google-info").hidden = engine.provider !== "google";
  $("google-web-info").hidden = engine.provider !== "google-web";
  $("youdao-info").hidden = engine.provider !== "youdao";
  $("microsoft-info").hidden = engine.provider !== "microsoft";
  $("libre-info").hidden = engine.provider !== "libre-local";
  $("baidu-info").hidden = engine.provider !== "baidu";
  $("autoSourceInfo").hidden = engine.source !== "auto" || !supportsAutoSource(engine.provider);
  $("ai-controls").hidden = engine.provider !== "ai";
  $("swapLanguages").title = t(engine.source === "auto" ? "swapAutoUnavailable" : "swapLanguages");
  const names = new Intl.DisplayNames([language], {type: "language"});
  for (const [id, selected] of [["freeSource", engine.source], ["freeTarget", engine.target]]) {
    const select = $(id);
    const codes = id === "freeSource" && supportsAutoSource(engine.provider) ? ["auto", ...LANGUAGE_CODES] : LANGUAGE_CODES;
    select.replaceChildren(...codes.map(code => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = code === "auto" ? t("auto") : names.of(code) || code;
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
  googleKeyPresent = !!String(data.googleTranslateKey || "").trim();
  microsoftKeyPresent = !!String(data.microsoftKey || "").trim();
  youdaoKeysPresent = !!String(data.youdaoAppKey || "").trim() && !!String(data.youdaoAppSecret || "").trim();
  baiduKeysPresent = !!String(data.baiduAppId || "").trim() && !!String(data.baiduAppSecret || "").trim();
  $("dynamicInfo").textContent = t(data.dynamic ? "dynamicEnabled" : "dynamicDisabled");
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
  try { ping = await chrome.tabs.sendMessage(tab.id, {type: "CF_PING"}, {frameId: 0}); }
  catch {}
  if (ping?.ok && ping.protocol !== 19) throw new Error(t("refreshPage"));
  if (!ping?.ok) {
    await chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ["content.css"]});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ["content.js"]});
  }
  const message = type === "CF_SET_DISPLAY" ? {type, mode: preferences.mode} : {type, preferences: preferences ? {...preferences, documentTitle: tab.title || ""} : preferences};
  const result = await chrome.tabs.sendMessage(tab.id, message, {frameId: 0});
  if (!isKaggleNotebook(tab.url) || !["CF_START", "CF_CONTINUE", "CF_STOP", "CF_CLEAR", "CF_SET_DISPLAY"].includes(type)) return result;
  let frameMessage = message;
  if (["CF_START", "CF_CONTINUE"].includes(type)) {
    const view = await chrome.tabs.sendMessage(tab.id, {type: "CF_NOTEBOOK_VIEWPORT"}, {frameId: 0});
    frameMessage = {...message, preferences: {...message.preferences, viewport: view?.viewport || null}};
  }
  const frame = await sendToKaggleNotebook(tab.id, frameMessage, ["CF_START", "CF_CONTINUE"].includes(type));
  return {...result, notebookStatus: frame.status, found: (result?.found || 0) + frame.found,
    started: !!result?.started || frame.started, truncated: !!result?.truncated || frame.truncated};
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
  const notebook = isKaggleNotebook(activeTabUrl);
  let origin;
  if (["CF_START", "CF_CONTINUE"].includes(kind) && ["mymemory", "google-web", "google", "youdao", "microsoft", "libre-local", "baidu"].includes(selectedEngine.provider)) {
    if (selectedEngine.source === selectedEngine.target) { status(t("sameLanguage"), "error"); return; }
    if (selectedEngine.provider === "google" && !googleKeyPresent) { status(t("googleNeedKey"), "error"); return; }
    if (selectedEngine.provider === "youdao" && !youdaoKeysPresent) { status(t("youdaoNeedKey"), "error"); return; }
    if (selectedEngine.provider === "microsoft" && !microsoftKeyPresent) { status(t("microsoftNeedKey"), "error"); return; }
    if (selectedEngine.provider === "baidu" && !baiduKeysPresent) { status(t("baiduNeedKey"), "error"); return; }
    // Called synchronously from the click handler to preserve the user gesture.
    origin = selectedEngine.provider === "baidu" ? BAIDU_ORIGIN : selectedEngine.provider === "libre-local" ? LIBRE_LOCAL_ORIGIN : selectedEngine.provider === "microsoft" ? MICROSOFT_ORIGIN : selectedEngine.provider === "youdao" ? YOUDAO_ORIGIN : selectedEngine.provider === "google" ? GOOGLE_TRANSLATE_ORIGIN : selectedEngine.provider === "google-web" ? GOOGLE_WEB_ORIGIN : FREE_ORIGIN;
  }
  if (["CF_START", "CF_CONTINUE"].includes(kind) && (origin || notebook)) {
    status(t("starting"), "info");
    try { permission = chrome.permissions.request({origins: [origin, notebook ? KAGGLE_NOTEBOOK_ORIGIN : null].filter(Boolean), ...(notebook ? {permissions: ["webNavigation"]} : {})}); }
    catch (error) { status(String(error?.message || error), "error"); return; }
  }
  busy = true;
  for (const button of document.querySelectorAll("button")) button.disabled = true;
  for (const id of ["provider", "freeSource", "freeTarget"]) $(id).disabled = true;
  try {
    if (["CF_START", "CF_CONTINUE"].includes(kind)) {
      if (!permission) status(t("starting"), "info");
      const config = await settings();
      if (selectedEngine.provider === "ai" && !config.model.trim()) throw new Error(t("needModel"));
      if (permission && !await permission) throw new Error(t(notebook ? "kagglePermission" : selectedEngine.provider === "baidu" ? "permissionBaidu" : selectedEngine.provider === "libre-local" ? "permissionLibre" : selectedEngine.provider === "mymemory" ? "permissionFree" : selectedEngine.provider === "youdao" ? "permissionYoudao" : selectedEngine.provider === "microsoft" ? "permissionMicrosoft" : "permissionGoogle"));
      let protocol;
      try { protocol = await chrome.runtime.sendMessage({type: "CF_ENGINE_PROTOCOL"}); }
      catch { throw new Error(t("reloadExtension")); }
      if (!protocol?.ok || protocol.protocol !== 19) throw new Error(t("reloadExtension"));
      await persistEngine(selectedEngine);
      status(t("starting"), "info");
      await quickSetup;
      const result = await communicate(kind, {engine: selectedEngine, target: config.target, maxBlocks: config.maxBlocks, dynamic: config.dynamic, messages: contentMessages(language)});
      const statusText = result.started
        ? t("started", {count: result.found}) + (result.truncated ? ` ${t("limitWarning", {limit: config.maxBlocks})}` : "")
        : t(kind === "CF_CONTINUE" ? "noNewParagraphs" : "noParagraphs");
      const notebookWarning = result.notebookStatus && result.notebookStatus !== "ok" ? ` ${t("kaggleFrameWarning")}` : "";
      status(statusText + notebookWarning, notebookWarning ? "error" : result.started && !result.truncated ? "success" : result.started ? "info" : "error");
    } else if (kind === "CF_STOP") {
      const result = await communicate(kind);
      const warning = result?.notebookStatus && result.notebookStatus !== "ok" ? ` ${t("kaggleFrameWarning")}` : "";
      status(t("stopped") + warning, warning ? "error" : "success");
    } else if (kind === "CF_CLEAR") {
      const result = await communicate(kind);
      const warning = result?.notebookStatus && result.notebookStatus !== "ok" ? ` ${t("kaggleFrameWarning")}` : "";
      status(t("cleared") + warning, warning ? "error" : "success");
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
$("continue").addEventListener("click", () => runAction("CF_CONTINUE"));
$("stop").addEventListener("click", () => runAction("CF_STOP"));
$("clear").addEventListener("click", () => runAction("CF_CLEAR"));
$("copy-discussion").addEventListener("click", () => void copyDiscussion());
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("swapLanguages").addEventListener("click", () => {
  if (busy) return;
  if (engine.source === "auto") { status(t("swapAutoUnavailable"), "info"); return; }
  [engine.source, engine.target] = [engine.target, engine.source];
  renderEngine();
  void persistEngine().catch(error => status(String(error?.message || error), "error"));
});
for (const mode of ["bilingual", "original"]) {
  $("mode-" + mode).addEventListener("click", () => {
    displayQueue = displayQueue.then(() => setDisplayMode(mode)).catch(error => status(String(error?.message || error), "error"));
  });
}
for (const [id, key] of [["provider", "provider"], ["freeSource", "source"], ["freeTarget", "target"]]) {
  $(id).addEventListener("change", () => {
    engine[key] = $(id).value;
    if (key === "provider" && engine.source === "auto" && !supportsAutoSource(engine.provider)) {
      engine.source = "en";
      status(t("autoUnsupported"), "info");
    }
    renderEngine();
    void persistEngine().catch(error => status(String(error?.message || error), "error"));
  });
}
void (async () => {
  const config = await settings();
  googleKeyPresent = !!String(config.googleTranslateKey || "").trim();
  microsoftKeyPresent = !!String(config.microsoftKey || "").trim();
  youdaoKeysPresent = !!String(config.youdaoAppKey || "").trim() && !!String(config.youdaoAppSecret || "").trim();
  baiduKeysPresent = !!String(config.baiduAppId || "").trim() && !!String(config.baiduAppSecret || "").trim();
  const stored = await chrome.storage.local.get("translationEngine");
  activeTabUrl = (await currentTab().catch(() => null))?.url || "";
  $("kaggleInfo").hidden = !isKaggleNotebook(activeTabUrl);
  engine = normalizeEngine(stored.translationEngine, !!config.model.trim());
  await setupLanguage(next => {
    language = next;
    renderEngine();
    void updateSettingsPreview().catch(error => status(String(error?.message || error), "error"));
    if (quickReady) quickSetup = quickSetup.then(() => communicate("CF_QUICK_SHOW", {messages: contentMessages(language)})).catch(() => {});
  });
  // Opening the extension grants activeTab access for this page only.
  quickSetup = communicate("CF_QUICK_SHOW", {messages: contentMessages(language)})
    .then(() => communicate("CF_PING"))
    .then(result => { displayMode = result?.displayMode === "original" ? "original" : "bilingual"; renderDisplayMode(); })
    .catch(() => {});
  quickReady = true;
  for (const id of ["provider", "freeSource", "freeTarget", "swapLanguages", "start", "continue"]) $(id).disabled = false;
})().catch(error => status(String(error?.message || error), "error"));

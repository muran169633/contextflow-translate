import {DEFAULT_SETTINGS} from "./core.mjs";
import {MODEL_BASE_URLS, modelPermission, providerBase, providerName} from "./model-adapters.mjs";
import {setupLanguage, translate} from "./ui-language.mjs";
import {localizeError} from "./i18n.mjs";
let language = "en";
const t = (key, values) => translate(language, key, values);
const $ = id => document.getElementById(id);
let currentProvider = "compatible";
let connections = {};

function rememberConnection() {
  connections[currentProvider] = {
    endpoint: $("endpoint").value.trim(), model: $("model").value.trim(), apiKey: $("apiKey").value.trim()
  };
}
function showConnection(provider) {
  currentProvider = provider;
  const draft = connections[provider] || {};
  $("aiProvider").value = provider;
  $("endpoint").readOnly = provider !== "compatible";
  $("endpoint").value = provider === "compatible" ? (draft.endpoint || MODEL_BASE_URLS.compatible) : MODEL_BASE_URLS[provider];
  $("model").value = draft.model || "";
  $("apiKey").value = draft.apiKey || "";
  $("endpointHelp").textContent = t(provider === "compatible" ? "endpointHelp" : "nativeEndpointHelp");
}

function status(text, kind = "info") {
  $("message").textContent = text;
  $("message").className = `message ${kind === "info" ? "" : kind}`;
}
function settingsFromForm() {
  const maxBlocks = Number.parseInt($("maxBlocks").value, 10);
  rememberConnection();
  return {
    aiProvider: currentProvider,
    connections,
    googleTranslateKey: $("googleTranslateKey").value.trim(),
    youdaoAppKey: $("youdaoAppKey").value.trim(),
    youdaoAppSecret: $("youdaoAppSecret").value.trim(),
    baiduAppId: $("baiduAppId").value.trim(),
    baiduAppSecret: $("baiduAppSecret").value.trim(),
    microsoftKey: $("microsoftKey").value.trim(),
    microsoftRegion: $("microsoftRegion").value.trim(),
    endpoint: $("endpoint").value.trim(),
    model: $("model").value.trim(),
    apiKey: $("apiKey").value.trim(),
    source: $("source").value,
    target: $("target").value.trim() || DEFAULT_SETTINGS.target,
    style: $("style").value,
    glossary: $("glossary").value,
    review: $("review").checked,
    cache: $("cache").checked,
    dynamic: $("dynamic").checked,
    maxBlocks: Math.max(1, Math.min(150, Number.isFinite(maxBlocks) ? maxBlocks : 50))
  };
}
async function restore() {
  const data = await chrome.storage.local.get("settings");
  const s = {...DEFAULT_SETTINGS, ...(data.settings || {})};
  currentProvider = providerName(s);
  connections = {...(s.connections || {})};
  connections[currentProvider] = {endpoint: s.endpoint, model: s.model, apiKey: s.apiKey};
  showConnection(currentProvider);
  for (const name of ["googleTranslateKey", "youdaoAppKey", "youdaoAppSecret", "baiduAppId", "baiduAppSecret", "microsoftKey", "microsoftRegion", "source", "target", "style", "glossary", "maxBlocks"]) {
    $(name).value = s[name];
  }
  $("review").checked = !!s.review;
  $("cache").checked = !!s.cache;
  $("dynamic").checked = !!s.dynamic;
}
async function saveAndMaybeTest(test) {
  const save = $("save");
  const testButton = $("test");
  save.disabled = testButton.disabled = true;
  try {
    const data = settingsFromForm();
    if (!test && !data.model) {
      await chrome.storage.local.set({settings: data});
      status(t("preferencesSaved"), "success");
      return;
    }
    const endpoint = providerBase(data);
    const pattern = modelPermission(data);
    if (test && !data.model) throw new Error(t("needTestModel"));
    // Request exactly one origin, even though optional patterns cover HTTPS broadly.
    // Request directly from this button's user gesture.
    const permitted = await chrome.permissions.request({origins: [pattern]});
    if (!permitted) throw new Error(t("permissionDenied"));
    await chrome.storage.local.set({settings: data});
    if (!test) {
      status(t("saved", {endpoint}), "success");
      return;
    }
    status(t("testing"), "info");
    const response = await chrome.runtime.sendMessage({type: "CF_TEST"});
    if (!response?.ok) throw new Error(response?.error || t("testError"));
    status(t("connected", {sample: response.sample, reviewed: response.reviewed ? t("reviewed") : ""}), "success");
  } catch (error) {
    status(localizeError(language, error), "error");
  } finally {
    save.disabled = testButton.disabled = false;
  }
}
$("save").addEventListener("click", () => saveAndMaybeTest(false));
$("test").addEventListener("click", () => saveAndMaybeTest(true));
$("saveGoogleKey").addEventListener("click", async () => {
  try {
    const data = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({settings: {...(data.settings || {}), googleTranslateKey: $("googleTranslateKey").value.trim()}});
    status(t("googleKeySaved"), "success");
  } catch (error) { status(String(error?.message || error), "error"); }
});
$("saveYoudaoKey").addEventListener("click", async () => {
  try {
    const data = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({settings: {...(data.settings || {}), youdaoAppKey: $("youdaoAppKey").value.trim(), youdaoAppSecret: $("youdaoAppSecret").value.trim()}});
    status(t("youdaoKeySaved"), "success");
  } catch (error) { status(String(error?.message || error), "error"); }
});
$("saveMicrosoftKey").addEventListener("click", async () => {
  try {
    const data = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({settings: {...(data.settings || {}), microsoftKey: $("microsoftKey").value.trim(), microsoftRegion: $("microsoftRegion").value.trim()}});
    status(t("microsoftKeySaved"), "success");
  } catch (error) { status(String(error?.message || error), "error"); }
});
$("saveBaiduKey").addEventListener("click", async () => {
  try {
    const data = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({settings: {...(data.settings || {}), baiduAppId: $("baiduAppId").value.trim(), baiduAppSecret: $("baiduAppSecret").value.trim()}});
    status(t("baiduKeySaved"), "success");
  } catch (error) { status(String(error?.message || error), "error"); }
});
$("aiProvider").addEventListener("change", () => {
  rememberConnection();
  showConnection($("aiProvider").value);
});
$("clearCache").addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove("translationCache");
    status(t("cacheCleared"), "success");
  } catch (error) { status(String(error?.message || error), "error"); }
});
void restore().catch(error => status(String(error?.message || error), "error"));

void setupLanguage(next => {
  language = next;
  $("endpointHelp").textContent = t(currentProvider === "compatible" ? "endpointHelp" : "nativeEndpointHelp");
}).catch(error => status(String(error?.message || error), "error"));

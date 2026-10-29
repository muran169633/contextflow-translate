import {DEFAULT_SETTINGS, normalizeEndpoint, hostPermissionPattern} from "./core.mjs";
import {setupLanguage, translate} from "./ui-language.mjs";
import {localizeError} from "./i18n.mjs";
let language = "en";
const t = (key, values) => translate(language, key, values);
const $ = id => document.getElementById(id);

function status(text, kind = "info") {
  $("message").textContent = text;
  $("message").className = `message ${kind === "info" ? "" : kind}`;
}
function settingsFromForm() {
  const maxBlocks = Number.parseInt($("maxBlocks").value, 10);
  return {
    endpoint: $("endpoint").value.trim(),
    model: $("model").value.trim(),
    apiKey: $("apiKey").value.trim(),
    source: $("source").value,
    target: $("target").value.trim() || DEFAULT_SETTINGS.target,
    style: $("style").value,
    glossary: $("glossary").value,
    review: $("review").checked,
    cache: $("cache").checked,
    maxBlocks: Math.max(1, Math.min(150, Number.isFinite(maxBlocks) ? maxBlocks : 50))
  };
}
async function restore() {
  const data = await chrome.storage.local.get("settings");
  const s = {...DEFAULT_SETTINGS, ...(data.settings || {})};
  for (const name of ["endpoint", "model", "apiKey", "source", "target", "style", "glossary", "maxBlocks"]) {
    $(name).value = s[name];
  }
  $("review").checked = !!s.review;
  $("cache").checked = !!s.cache;
}
async function saveAndMaybeTest(test) {
  const save = $("save");
  const testButton = $("test");
  save.disabled = testButton.disabled = true;
  try {
    const data = settingsFromForm();
    normalizeEndpoint(data.endpoint);
    const pattern = hostPermissionPattern(data.endpoint);
    if (test && !data.model) throw new Error(t("needTestModel"));
    // Request exactly one origin, even though optional patterns cover HTTPS broadly.
    // Request directly from this button's user gesture.
    const permitted = await chrome.permissions.request({origins: [pattern]});
    if (!permitted) throw new Error(t("permissionDenied"));
    await chrome.storage.local.set({settings: data});
    if (!test) {
      status(t("saved", {endpoint: normalizeEndpoint(data.endpoint)}), "success");
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
$("clearCache").addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove("translationCache");
    status(t("cacheCleared"), "success");
  } catch (error) { status(String(error?.message || error), "error"); }
});
void restore().catch(error => status(String(error?.message || error), "error"));

void setupLanguage(next => { language = next; }).catch(error => status(String(error?.message || error), "error"));

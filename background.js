import {
  DEFAULT_SETTINGS,
  makeTranslationMessages, makeReviewMessages,
  parseModelTranslations, normalizeEntries
} from "./core.mjs";
import {FREE_ORIGIN, LANGUAGE_CODES, normalizeEngine, supportsAutoSource, translateFree} from "./free-translate.mjs";
import {GOOGLE_TRANSLATE_ORIGIN, translateGoogle} from "./google-translate.mjs";
import {GOOGLE_WEB_ORIGIN, translateGoogleWeb} from "./google-web-translate.mjs";
import {YOUDAO_ORIGIN, translateYoudao} from "./youdao-translate.mjs";
import {MICROSOFT_ORIGIN, translateMicrosoft} from "./microsoft-translate.mjs";
import {LIBRE_LOCAL_ORIGIN, translateLibreLocal} from "./libre-local.mjs";
import {BAIDU_ORIGIN, translateBaidu} from "./baidu-translate.mjs";
import {KAGGLE_NOTEBOOK_ORIGIN, isKaggleNotebook, sendToKaggleNotebook} from "./kaggle-frames.mjs";
import {buildModelRequest, modelEndpoint, modelPermission, parseModelResponse, providerName} from "./model-adapters.mjs";
import {contentMessages, resolveLanguage, translate} from "./i18n.mjs";

// Keep API credentials away from content scripts. Options/popup/service worker remain trusted.
chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"}).catch(() => {});

async function readSettings() {
  const data = await chrome.storage.local.get("settings");
  return {...DEFAULT_SETTINGS, ...(data.settings || {})};
}

const quickPending = new Set();

async function quickLocale() {
  const {uiLanguage} = await chrome.storage.local.get("uiLanguage");
  return resolveLanguage(uiLanguage || chrome.i18n?.getUILanguage?.() || "en");
}

async function ensureQuickPage(tabId, language) {
  let ping;
  try { ping = await chrome.tabs.sendMessage(tabId, {type: "CF_PING"}, {frameId: 0}); } catch {}
  if (ping?.ok && ping.protocol !== 21) throw new Error(translate(language, "refreshPage"));
  if (!ping?.ok) {
    await chrome.scripting.insertCSS({target: {tabId}, files: ["content.css"]});
    await chrome.scripting.executeScript({target: {tabId}, files: ["content.js"]});
    ping = await chrome.tabs.sendMessage(tabId, {type: "CF_PING"}, {frameId: 0});
    if (!ping?.ok || ping.protocol !== 21) throw new Error(translate(language, "refreshPage"));
  }
  await chrome.tabs.sendMessage(tabId, {type: "CF_QUICK_SHOW", preferences: {messages: contentMessages(language)}}, {frameId: 0});
  return ping;
}

async function quickTranslate(tab) {
  if (!Number.isInteger(tab?.id) || (tab.url && !/^https?:\/\//.test(tab.url))) throw new Error("Open an ordinary HTTP or HTTPS page.");
  const language = await quickLocale();
  if (quickPending.has(tab.id)) throw new Error(translate(language, "quickRunning"));
  quickPending.add(tab.id);
  try {
    const ping = await ensureQuickPage(tab.id, language);
    if (ping.running) throw new Error(translate(language, "quickRunning"));
    const settings = await readSettings();
    const stored = await chrome.storage.local.get("translationEngine");
    const engine = normalizeEngine(stored.translationEngine, !!String(settings.model || "").trim());
    if (engine.provider !== "ai" && engine.source === engine.target) throw new Error(translate(language, "sameLanguage"));
    if (engine.provider === "ai" && !String(settings.model || "").trim()) throw new Error(translate(language, "needModel"));
    if (engine.provider === "google" && !String(settings.googleTranslateKey || "").trim()) throw new Error(translate(language, "googleNeedKey"));
    if (engine.provider === "youdao" && (!String(settings.youdaoAppKey || "").trim() || !String(settings.youdaoAppSecret || "").trim())) throw new Error(translate(language, "youdaoNeedKey"));
    if (engine.provider === "microsoft" && !String(settings.microsoftKey || "").trim()) throw new Error(translate(language, "microsoftNeedKey"));
    if (engine.provider === "baidu" && (!String(settings.baiduAppId || "").trim() || !String(settings.baiduAppSecret || "").trim())) throw new Error(translate(language, "baiduNeedKey"));
    const origin = engine.provider === "baidu" ? BAIDU_ORIGIN : engine.provider === "libre-local" ? LIBRE_LOCAL_ORIGIN : engine.provider === "microsoft" ? MICROSOFT_ORIGIN : engine.provider === "youdao" ? YOUDAO_ORIGIN : engine.provider === "mymemory" ? FREE_ORIGIN : engine.provider === "google-web" ? GOOGLE_WEB_ORIGIN : engine.provider === "google" ? GOOGLE_TRANSLATE_ORIGIN : modelPermission(settings);
    if (!await chrome.permissions.contains({origins: [origin]})) throw new Error(translate(language, "quickAuthorize"));
    if (isKaggleNotebook(tab.url) && !await chrome.permissions.contains({permissions: ["webNavigation"], origins: [KAGGLE_NOTEBOOK_ORIGIN]})) throw new Error(translate(language, "kagglePermission"));
    const message = {type: "CF_START", preferences: {engine, target: settings.target, documentTitle: tab.title || "", maxBlocks: settings.maxBlocks, dynamic: settings.dynamic, messages: contentMessages(language)}};
    const result = await chrome.tabs.sendMessage(tab.id, message, {frameId: 0});
    if (!result?.ok) throw new Error(translate(language, "quickError"));
    if (isKaggleNotebook(tab.url)) {
      const view = await chrome.tabs.sendMessage(tab.id, {type: "CF_NOTEBOOK_VIEWPORT"}, {frameId: 0});
      const frameMessage = {...message, preferences: {...message.preferences, viewport: view?.viewport || null}};
      const frame = await sendToKaggleNotebook(tab.id, frameMessage, true);
      if (frame.status !== "ok") throw new Error(translate(language, "kaggleFrameWarning"));
      result.started ||= frame.started;
      result.found = (result.found || 0) + frame.found;
      result.truncated ||= frame.truncated;
    }
    try {
      if (chrome.action?.setBadgeText) await chrome.action.setBadgeText({tabId: tab.id, text: ""});
      if (chrome.action?.setTitle) await chrome.action.setTitle({tabId: tab.id, title: "ContextFlow Translate"});
    } catch {}
    return result;
  } finally {
    quickPending.delete(tab.id);
  }
}

async function toggleDisplay(tab) {
  if (!Number.isInteger(tab?.id) || (tab.url && !/^https?:\/\//.test(tab.url))) throw new Error("Open an ordinary HTTP or HTTPS page.");
  const language = await quickLocale();
  const ping = await ensureQuickPage(tab.id, language);
  const mode = ping.displayMode === "original" ? "bilingual" : "original";
  const message = {type: "CF_SET_DISPLAY", mode};
  const result = await chrome.tabs.sendMessage(tab.id, message, {frameId: 0});
  if (!result?.ok) throw new Error(translate(language, "displayError"));
  if (isKaggleNotebook(tab.url)) {
    const frame = await sendToKaggleNotebook(tab.id, message, false);
    if (frame.status !== "ok") throw new Error(translate(language, "kaggleFrameWarning"));
  }
  await chrome.tabs.sendMessage(tab.id, {type: "CF_QUICK_NOTICE", kind: "info", text: translate(language, mode === "original" ? "showingOriginal" : "showingBilingual"), preferences: {messages: contentMessages(language)}}, {frameId: 0});
}

chrome.commands?.onCommand?.addListener((command, tab) => {
  if (!["quick-translate", "toggle-display"].includes(command)) return;
  void (async () => {
    const active = tab?.id ? tab : (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    try {
      if (command === "toggle-display") await toggleDisplay(active);
      else await quickTranslate(active);
    } catch (error) {
      const message = String(error?.message || error);
      try {
        const language = await quickLocale();
        const shown = await chrome.tabs.sendMessage(active.id, {type: "CF_QUICK_NOTICE", text: message, preferences: {messages: contentMessages(language)}}, {frameId: 0});
        if (!shown?.ok) throw new Error(message);
      } catch {
        if (active?.id && chrome.action?.setBadgeText) {
          await chrome.action.setBadgeText({tabId: active.id, text: "!"});
          await chrome.action.setTitle({tabId: active.id, title: message});
        }
      }
    }
  })();
});

function safeContext(context) {
  return {
    title: String(context?.title || "").slice(0, 240),
    opening: String(context?.opening || "").slice(0, 700),
    before: String(context?.before || "").slice(0, 350),
    after: String(context?.after || "").slice(0, 350)
  };
}

async function modelRequest(messages, settings) {
  const {url, headers, body: requestBody} = buildModelRequest(messages, settings);
  const pattern = modelPermission(settings);
  const allowed = await chrome.permissions.contains({origins: [pattern]});
  if (!allowed) throw new Error("API host access is not granted. Open Settings and save the connection again.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 27000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) {
      let detail = "";
      try {
        const issue = JSON.parse(body);
        detail = String(issue.error?.message || issue.message || "").slice(0, 180);
      } catch {}
      throw new Error(`API returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    if (body.length > 400000) throw new Error("API response is unexpectedly large.");
    let data;
    try { data = JSON.parse(body); }
    catch { throw new Error("API returned non-JSON data. Check the provider and endpoint."); }
    return parseModelResponse(data, settings);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("API timed out after 27 seconds. Use a faster model or reduce server load.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

let cacheWriteQueue = Promise.resolve();
const googleWebFlights = new Map();
async function translateGoogleWebShared(entries, engine, keys, force) {
  if (force) return translateGoogleWeb(entries, engine);
  // 仅共享完全相同的请求；按顺序保存译文，避免不同页面的段落 ID 串用。
  const flightKey = keys.join(":");
  let flight = googleWebFlights.get(flightKey);
  if (!flight) {
    flight = translateGoogleWeb(entries, engine).then(result => entries.map(entry => result[entry.id]));
    googleWebFlights.set(flightKey, flight);
  }
  try {
    const values = await flight;
    return Object.fromEntries(entries.map((entry, index) => [entry.id, values[index]]));
  } finally {
    if (googleWebFlights.get(flightKey) === flight) googleWebFlights.delete(flightKey);
  }
}
async function storeCache(keys, entries, translations, reviewed) {
  const write = cacheWriteQueue.catch(() => {}).then(async () => {
    const {translationCache = {}} = await chrome.storage.local.get("translationCache");
    const now = Date.now();
    for (let i = 0; i < keys.length; i++) {
      const values = keys.length === 1 && entries.length > 1 ? entries.map(entry => translations[entry.id]) : [translations[entries[i].id]];
      translationCache[keys[i]] = {time: now, values, reviewed};
    }
    const cleaned = Object.fromEntries(
      Object.entries(translationCache)
        .filter(([, value]) => value && Number.isFinite(value.time) && now - value.time < 7 * 24 * 3600000)
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, 200)
    );
    await chrome.storage.local.set({translationCache: cleaned});
  });
  cacheWriteQueue = write;
  try { await write; }
  catch (error) { console.warn("Translation cache could not be saved:", String(error?.message || error)); }
}

async function translationWithCache(entries, context, force = false, forceAi = false, requestedEngine = null) {
  const settings = await readSettings();
  const {translationEngine} = await chrome.storage.local.get("translationEngine");
  if (requestedEngine && (!['mymemory', 'google-web', 'google', 'youdao', 'microsoft', 'libre-local', 'baidu', 'ai'].includes(requestedEngine.provider) || !(LANGUAGE_CODES.includes(requestedEngine.source) || (requestedEngine.source === 'auto' && supportsAutoSource(requestedEngine.provider))) || !LANGUAGE_CODES.includes(requestedEngine.target))) {
    throw new Error("Invalid translation engine selection.");
  }
  const engine = forceAi ? normalizeEngine({provider: "ai"}) : normalizeEngine(requestedEngine || translationEngine, !!String(settings.model || "").trim());
  if (engine.provider === "ai" && !String(settings.model || "").trim()) throw new Error("Configure a model and API endpoint in Settings first.");
  const url = engine.provider === "ai" ? modelEndpoint(settings) : engine.provider === "baidu" ? BAIDU_ORIGIN : engine.provider === "libre-local" ? LIBRE_LOCAL_ORIGIN : engine.provider === "google" ? GOOGLE_TRANSLATE_ORIGIN : engine.provider === "google-web" ? GOOGLE_WEB_ORIGIN : engine.provider === "youdao" ? YOUDAO_ORIGIN : engine.provider === "microsoft" ? MICROSOFT_ORIGIN : FREE_ORIGIN;
  const cacheInput = {version: 4, engine, texts: entries.map(entry => entry.text)};
  if (engine.provider === "ai") Object.assign(cacheInput, {
    provider: providerName(settings), endpoint: url, model: settings.model, source: settings.source,
    target: settings.target, style: settings.style, glossary: settings.glossary, review: !!settings.review, context
  });
  const machine = engine.provider !== "ai";
  const keys = machine ? await Promise.all(entries.map(entry => sha256(JSON.stringify({...cacheInput, texts: [entry.text]})))) : [await sha256(JSON.stringify(cacheInput))];
  let pendingEntries = entries;
  let pendingKeys = keys;
  const cachedTranslations = {};

  if (settings.cache && !force) {
    const {translationCache = {}} = await chrome.storage.local.get("translationCache");
    const valid = (hit, count) => hit && Date.now() - hit.time < 7 * 24 * 3600000 && Array.isArray(hit.values) && hit.values.length === count && hit.values.every(value => typeof value === "string" && value.trim());
    if (machine) {
      pendingEntries = [];
      pendingKeys = [];
      entries.forEach((entry, index) => {
        const hit = translationCache[keys[index]];
        if (valid(hit, 1)) cachedTranslations[entry.id] = hit.values[0];
        else { pendingEntries.push(entry); pendingKeys.push(keys[index]); }
      });
      if (!pendingEntries.length) return {translations: cachedTranslations, cacheHit: true, reviewed: false};
    } else {
      const hit = translationCache[keys[0]];
      if (valid(hit, entries.length)) return {translations: Object.fromEntries(entries.map((entry, index) => [entry.id, hit.values[index]])), cacheHit: true, reviewed: !!hit.reviewed};
    }
  }

  let translations;
  let reviewed = false;
  let reviewWarning = "";
  if (["mymemory", "google-web", "google", "youdao", "microsoft", "libre-local", "baidu"].includes(engine.provider)) {
    try {
      if (!await chrome.permissions.contains({origins: [url]})) throw new Error("Translation provider host access is not granted.");
      translations = engine.provider === "baidu" ? await translateBaidu(pendingEntries, engine, settings.baiduAppId, settings.baiduAppSecret) : engine.provider === "libre-local" ? await translateLibreLocal(pendingEntries, engine) : engine.provider === "microsoft" ? await translateMicrosoft(pendingEntries, engine, settings.microsoftKey, settings.microsoftRegion) : engine.provider === "youdao" ? await translateYoudao(pendingEntries, engine, settings.youdaoAppKey, settings.youdaoAppSecret) : engine.provider === "google" ? await translateGoogle(pendingEntries, engine, settings.googleTranslateKey) : engine.provider === "google-web" ? await translateGoogleWebShared(pendingEntries, engine, pendingKeys, force) : await translateFree(pendingEntries, engine);
    } catch (error) {
      if (error.fatal !== false) error.fatal = true;
      throw error;
    }
  } else {
    const first = await modelRequest(makeTranslationMessages(entries, context, settings), settings);
    translations = parseModelTranslations(first, entries.map(e => e.id));
  }
  if (engine.provider === "ai" && settings.review) {
    try {
      const candidates = entries.map(e => ({id: e.id, text: translations[e.id]}));
      const revised = await modelRequest(makeReviewMessages(entries, candidates, context, settings), settings);
      translations = parseModelTranslations(revised, entries.map(e => e.id));
      reviewed = true;
    } catch (error) {
      reviewWarning = `Second-pass review unavailable: ${String(error?.message || error)}`;
    }
  }

  if (settings.cache) await storeCache(pendingKeys, pendingEntries, translations, reviewed);
  if (machine) translations = {...cachedTranslations, ...translations};
  return {translations, cacheHit: false, reviewed, reviewWarning};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  (async () => {
    if (message?.type === "CF_ENGINE_PROTOCOL") {
      if (sender.tab) throw new Error("Protocol check must originate from the extension.");
      return {protocol: 21};
    }
    if (message?.type === "CF_NOTEBOOK_VIEWPORT") {
      if (!sender.tab || sender.frameId !== 0 || !isKaggleNotebook(sender.tab.url)) throw new Error("Invalid notebook viewport sender.");
      const viewport = message.viewport;
      if (!Number.isFinite(viewport?.top) || !Number.isFinite(viewport?.bottom) || viewport.top < 0 || viewport.bottom < viewport.top || viewport.bottom > 100000000) throw new Error("Invalid notebook viewport.");
      return await sendToKaggleNotebook(sender.tab.id, {type: "CF_SET_VIEWPORT", viewport}, false);
    }
    if (message?.type === "CF_QUICK_START") {
      if (!sender.tab) throw new Error("Quick translation must originate from a webpage.");
      return await quickTranslate(sender.tab);
    }
    if (message?.type === "CF_TRANSLATE") {
      if (!sender.tab) throw new Error("Translation requests must originate from an active webpage.");
      const entries = normalizeEntries(message.entries);
      const context = safeContext(message.context);
      return await translationWithCache(entries, context, message.force === true, false, message.engine);
    }
    if (message?.type === "CF_TEST") {
      if (sender.tab) throw new Error("Connection test must be triggered from the extension settings.");
      const entries = [{id: "cf-1", text: "The model may be correct, but the evidence is not conclusive."}];
      const context = {title: "Translation accuracy check", opening: "", before: "", after: ""};
      const result = await translationWithCache(entries, context, true, true);
      return {sample: result.translations["cf-1"], reviewed: result.reviewed};
    }
    throw new Error("Unsupported request.");
  })().then(
    result => sendResponse({ok: true, ...result}),
    error => sendResponse({ok: false, error: String(error?.message || error).slice(0, 500), fatal: error?.fatal === true})
  );
  return true;
});

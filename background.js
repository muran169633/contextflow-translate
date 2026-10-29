import {
  DEFAULT_SETTINGS,
  makeTranslationMessages, makeReviewMessages,
  parseModelTranslations, normalizeEntries
} from "./core.mjs";
import {FREE_ORIGIN, LANGUAGE_CODES, normalizeEngine, translateFree} from "./free-translate.mjs";
import {GOOGLE_TRANSLATE_ORIGIN, translateGoogle} from "./google-translate.mjs";
import {GOOGLE_WEB_ORIGIN, translateGoogleWeb} from "./google-web-translate.mjs";
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
  try { ping = await chrome.tabs.sendMessage(tabId, {type: "CF_PING"}); } catch {}
  if (ping?.ok && ping.protocol !== 6) throw new Error(translate(language, "refreshPage"));
  if (!ping?.ok) {
    await chrome.scripting.insertCSS({target: {tabId}, files: ["content.css"]});
    await chrome.scripting.executeScript({target: {tabId}, files: ["content.js"]});
    ping = await chrome.tabs.sendMessage(tabId, {type: "CF_PING"});
    if (!ping?.ok || ping.protocol !== 6) throw new Error(translate(language, "refreshPage"));
  }
  await chrome.tabs.sendMessage(tabId, {type: "CF_QUICK_SHOW", preferences: {messages: contentMessages(language)}});
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
    const origin = engine.provider === "mymemory" ? FREE_ORIGIN : engine.provider === "google-web" ? GOOGLE_WEB_ORIGIN : engine.provider === "google" ? GOOGLE_TRANSLATE_ORIGIN : modelPermission(settings);
    if (!await chrome.permissions.contains({origins: [origin]})) throw new Error(translate(language, "quickAuthorize"));
    const result = await chrome.tabs.sendMessage(tab.id, {type: "CF_START", preferences: {engine, target: settings.target, maxBlocks: settings.maxBlocks, messages: contentMessages(language)}});
    if (!result?.ok) throw new Error(translate(language, "quickError"));
    try {
      if (chrome.action?.setBadgeText) await chrome.action.setBadgeText({tabId: tab.id, text: ""});
      if (chrome.action?.setTitle) await chrome.action.setTitle({tabId: tab.id, title: "ContextFlow Translate"});
    } catch {}
    return result;
  } finally {
    quickPending.delete(tab.id);
  }
}

chrome.commands?.onCommand?.addListener((command, tab) => {
  if (command !== "quick-translate") return;
  void (async () => {
    const active = tab?.id ? tab : (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    try {
      await quickTranslate(active);
    } catch (error) {
      const message = String(error?.message || error);
      try {
        const language = await quickLocale();
        const shown = await chrome.tabs.sendMessage(active.id, {type: "CF_QUICK_NOTICE", text: message, preferences: {messages: contentMessages(language)}});
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
async function storeCache(key, entries, translations, reviewed) {
  const write = cacheWriteQueue.catch(() => {}).then(async () => {
    const {translationCache = {}} = await chrome.storage.local.get("translationCache");
    const now = Date.now();
    translationCache[key] = {time: now, values: entries.map(entry => translations[entry.id]), reviewed};
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
  if (requestedEngine && (!['mymemory', 'google-web', 'google', 'ai'].includes(requestedEngine.provider) || !LANGUAGE_CODES.includes(requestedEngine.source) || !LANGUAGE_CODES.includes(requestedEngine.target))) {
    throw new Error("Invalid translation engine selection.");
  }
  const engine = forceAi ? normalizeEngine({provider: "ai"}) : normalizeEngine(requestedEngine || translationEngine, !!String(settings.model || "").trim());
  if (engine.provider === "ai" && !String(settings.model || "").trim()) throw new Error("Configure a model and API endpoint in Settings first.");
  const url = engine.provider === "ai" ? modelEndpoint(settings) : engine.provider === "google" ? GOOGLE_TRANSLATE_ORIGIN : engine.provider === "google-web" ? GOOGLE_WEB_ORIGIN : FREE_ORIGIN;
  const cacheInput = {version: 4, engine, texts: entries.map(entry => entry.text)};
  if (engine.provider === "ai") Object.assign(cacheInput, {
    provider: providerName(settings), endpoint: url, model: settings.model, source: settings.source,
    target: settings.target, style: settings.style, glossary: settings.glossary, review: !!settings.review, context
  });
  const key = await sha256(JSON.stringify(cacheInput));

  if (settings.cache && !force) {
    const {translationCache = {}} = await chrome.storage.local.get("translationCache");
    const hit = translationCache[key];
    if (hit && Date.now() - hit.time < 7 * 24 * 3600000 && Array.isArray(hit.values) && hit.values.length === entries.length && hit.values.every(value => typeof value === "string" && value.trim())) {
      return {translations: Object.fromEntries(entries.map((entry, index) => [entry.id, hit.values[index]])), cacheHit: true, reviewed: !!hit.reviewed};
    }
  }

  let translations;
  let reviewed = false;
  let reviewWarning = "";
  if (engine.provider === "mymemory" || engine.provider === "google-web" || engine.provider === "google") {
    try {
      if (!await chrome.permissions.contains({origins: [url]})) throw new Error("Translation provider host access is not granted.");
      translations = engine.provider === "google" ? await translateGoogle(entries, engine, settings.googleTranslateKey) : engine.provider === "google-web" ? await translateGoogleWeb(entries, engine) : await translateFree(entries, engine);
    } catch (error) {
      error.fatal = true;
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

  if (settings.cache) await storeCache(key, entries, translations, reviewed);
  return {translations, cacheHit: false, reviewed, reviewWarning};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  (async () => {
    if (message?.type === "CF_ENGINE_PROTOCOL") {
      if (sender.tab) throw new Error("Protocol check must originate from the extension.");
      return {protocol: 6};
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

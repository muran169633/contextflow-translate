import {
  DEFAULT_SETTINGS,
  makeTranslationMessages, makeReviewMessages,
  parseModelTranslations, normalizeEntries
} from "./core.mjs";
import {FREE_ORIGIN, LANGUAGE_CODES, normalizeEngine, translateFree} from "./free-translate.mjs";
import {buildModelRequest, modelEndpoint, modelPermission, parseModelResponse, providerName} from "./model-adapters.mjs";

// Keep API credentials away from content scripts. Options/popup/service worker remain trusted.
chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"}).catch(() => {});

async function readSettings() {
  const data = await chrome.storage.local.get("settings");
  return {...DEFAULT_SETTINGS, ...(data.settings || {})};
}

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

async function translationWithCache(entries, context, force = false, forceAi = false, requestedEngine = null) {
  const settings = await readSettings();
  const {translationEngine} = await chrome.storage.local.get("translationEngine");
  if (requestedEngine && (!['mymemory', 'ai'].includes(requestedEngine.provider) || !LANGUAGE_CODES.includes(requestedEngine.source) || !LANGUAGE_CODES.includes(requestedEngine.target))) {
    throw new Error("Invalid translation engine selection.");
  }
  const engine = forceAi ? normalizeEngine({provider: "ai"}) : normalizeEngine(requestedEngine || translationEngine, !!String(settings.model || "").trim());
  if (engine.provider === "ai" && !String(settings.model || "").trim()) throw new Error("Configure a model and API endpoint in Settings first.");
  const url = engine.provider === "ai" ? modelEndpoint(settings) : FREE_ORIGIN;
  const key = await sha256(JSON.stringify({
    version: 3, engine, provider: engine.provider === "ai" ? providerName(settings) : "mymemory", endpoint: url, model: settings.model, source: settings.source,
    target: settings.target, style: settings.style, glossary: settings.glossary,
    review: !!settings.review, context, entries
  }));

  if (settings.cache && !force) {
    const {translationCache = {}} = await chrome.storage.local.get("translationCache");
    const hit = translationCache[key];
    if (hit && Date.now() - hit.time < 7 * 24 * 3600000) {
      return {translations: hit.translations, cacheHit: true, reviewed: !!hit.reviewed};
    }
  }

  let translations;
  let reviewed = false;
  let reviewWarning = "";
  if (engine.provider === "mymemory") {
    try {
      if (!await chrome.permissions.contains({origins: [FREE_ORIGIN]})) throw new Error("MyMemory host access is not granted.");
      translations = await translateFree(entries, engine);
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

  if (settings.cache) {
    const {translationCache = {}} = await chrome.storage.local.get("translationCache");
    const now = Date.now();
    translationCache[key] = {time: now, translations, reviewed};
    const cleaned = Object.fromEntries(
      Object.entries(translationCache)
        .filter(([, value]) => value && Number.isFinite(value.time) && now - value.time < 7 * 24 * 3600000)
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, 200)
    );
    await chrome.storage.local.set({translationCache: cleaned});
  }
  return {translations, cacheHit: false, reviewed, reviewWarning};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  (async () => {
    if (message?.type === "CF_ENGINE_PROTOCOL") {
      if (sender.tab) throw new Error("Protocol check must originate from the extension.");
      return {protocol: 2};
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

import {
  DEFAULT_SETTINGS, normalizeEndpoint, hostPermissionPattern,
  makeTranslationMessages, makeReviewMessages,
  parseModelTranslations, normalizeEntries
} from "./core.mjs";

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
  const endpoint = normalizeEndpoint(settings.endpoint);
  const pattern = hostPermissionPattern(endpoint);
  const allowed = await chrome.permissions.contains({origins: [pattern]});
  if (!allowed) throw new Error("API host access is not granted. Open Settings and save the connection again.");
  if (!String(settings.model || "").trim()) throw new Error("Set a model ID in Settings first.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 27000);
  const headers = {"Content-Type": "application/json"};
  if (String(settings.apiKey || "").trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model.trim(),
        messages,
        temperature: 0.1,
        stream: false
      }),
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
    catch { throw new Error("API returned non-JSON data. Use an OpenAI-compatible chat/completions endpoint."); }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("API response is missing choices[0].message.content.");
    return content;
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

async function translationWithCache(entries, context, force = false) {
  const settings = await readSettings();
  if (!String(settings.model || "").trim()) throw new Error("Configure a model and API endpoint in Settings first.");
  const url = normalizeEndpoint(settings.endpoint);
  const key = await sha256(JSON.stringify({
    version: 1, endpoint: url, model: settings.model, source: settings.source,
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

  const first = await modelRequest(makeTranslationMessages(entries, context, settings), settings);
  let translations = parseModelTranslations(first, entries.map(e => e.id));
  let reviewed = false;
  let reviewWarning = "";
  if (settings.review) {
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
    if (message?.type === "CF_TRANSLATE") {
      if (!sender.tab) throw new Error("Translation requests must originate from an active webpage.");
      const entries = normalizeEntries(message.entries);
      const context = safeContext(message.context);
      return await translationWithCache(entries, context, message.force === true);
    }
    if (message?.type === "CF_TEST") {
      if (sender.tab) throw new Error("Connection test must be triggered from the extension settings.");
      const entries = [{id: "cf-1", text: "The model may be correct, but the evidence is not conclusive."}];
      const context = {title: "Translation accuracy check", opening: "", before: "", after: ""};
      const result = await translationWithCache(entries, context, true);
      return {sample: result.translations["cf-1"], reviewed: result.reviewed};
    }
    throw new Error("Unsupported request.");
  })().then(
    result => sendResponse({ok: true, ...result}),
    error => sendResponse({ok: false, error: String(error?.message || error).slice(0, 500)})
  );
  return true;
});

(() => {
  if (globalThis.__contextFlowInstalled) return;
  globalThis.__contextFlowInstalled = true;

  const ROOT_CLASS = "cf-translation";
  const BLOCK_SELECTOR = "h1,h2,h3,h4,p,li,blockquote,figcaption,td,th,dd,dt";
  const SKIP_ANCESTORS = "nav,header,footer,aside,form,button,textarea,select,pre,code,script,style,svg,[role='navigation'],[role='menu'],[aria-hidden='true'],[contenteditable='true'],.cf-translation";
  const state = {token: 0, running: false, stop: false, done: 0, failed: 0, failureReason: "", total: 0, items: [], messages: {}, engine: null, target: "", truncated: false};
  function uiText(key, values = {}) {
    const template = state.messages[key] || key;
    return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }

  function rootElement() {
    const main = document.querySelector("main") || document.querySelector("[role='main']");
    const article = document.querySelector("article");
    // Forums often place the topic and each reply in separate article elements.
    if (main && article && main.contains(article) && main.querySelectorAll("article").length > 1) return main;
    if (!main && article && document.querySelectorAll("article").length > 1) return document.body;
    return article || main ||
      document.querySelector(".markdown-body") ||
      document.querySelector("#content") || document.body;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sourceText(element) {
    if (!element.querySelector(".cf-translation")) return cleanText(element.textContent);
    const copy = element.cloneNode(true);
    for (const node of copy.querySelectorAll(".cf-translation")) node.remove();
    return cleanText(copy.textContent);
  }

  function getParagraphs(maxBlocks, excluded = new Set()) {
    const root = rootElement();
    const items = [];
    let truncated = false;
    const limit = Math.max(1, Math.min(150, Number(maxBlocks) || 50));
    for (const element of root.querySelectorAll(BLOCK_SELECTOR)) {
      if (excluded.has(element)) continue;
      if (element.closest(SKIP_ANCESTORS)) continue;
      if (element.querySelector("p,li,blockquote,h1,h2,h3,h4,table,ul,ol")) continue;
      if (!element.getClientRects().length) continue;
      const css = getComputedStyle(element);
      if (css.visibility === "hidden" || css.display === "none") continue;
      const value = sourceText(element);
      const isHeading = /^H[1-4]$/.test(element.tagName);
      const minimum = isHeading ? 8 : ["P", "LI", "BLOCKQUOTE", "DD"].includes(element.tagName) ? 2 : 22;
      if (value.length < minimum || !/\p{L}/u.test(value)) continue;
      if (/^(https?:\/\/\S+|[\w-]+\.[\w-]+)$/.test(value)) continue;
      if ((value.match(/[{};=<>]/g) || []).length > value.length / 8) continue;
      if (items.length >= limit) { truncated = true; break; }
      items.push({id: `cf-${items.length + 1}`, element, text: value});
    }
    return {items, truncated};
  }

  function splitParagraph(value) {
    const parts = [];
    let offset = 0;
    while (offset < value.length) {
      let end = Math.min(offset + 1600, value.length);
      if (end < value.length) {
        if (/[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
        const breakAt = value.lastIndexOf(" ", end - 1);
        if (breakAt > offset + 800) end = breakAt + 1;
      }
      parts.push(value.slice(offset, end));
      offset = end;
    }
    return parts;
  }

  async function translateGroup(items, context, force, token = state.token) {
    const chunks = items.length === 1 ? splitParagraph(items[0].text) : null;
    const groups = chunks ? chunks.map(text => [{id: items[0].id, text}]) : [items.map(item => ({id: item.id, text: item.text}))];
    const parts = [];
    let lastResponse;
    for (const entries of groups) {
      if ((state.stop && !force) || state.token !== token) return null;
      const response = await chrome.runtime.sendMessage({type: "CF_TRANSLATE", entries, context, engine: state.engine, force});
      if ((state.stop && !force) || state.token !== token) return null;
      if (!response?.ok) {
        const error = new Error(response?.error || "Unexpected translation failure");
        error.fatal = response?.fatal === true;
        throw error;
      }
      if (entries.some(entry => typeof response.translations?.[entry.id] !== "string" || !response.translations[entry.id].trim())) {
        throw new Error("Translation response is incomplete.");
      }
      lastResponse = response;
      if (chunks) parts.push(response.translations[items[0].id]);
    }
    if (chunks) {
      const target = state.engine?.provider === "ai" ? state.target : state.engine?.target || "";
      const separator = /chinese|japanese|^zh\b|^ja\b/i.test(target) ? "" : " ";
      lastResponse.translations[items[0].id] = parts.map(part => part.trim()).join(separator);
    }
    return lastResponse;
  }

  function showToast(message, kind = "info") {
    let toast = document.getElementById("cf-floating-status");
    if (!toast) {
      toast = document.createElement("aside");
      toast.id = "cf-floating-status";
      toast.setAttribute("data-contextflow-owned", "true");
      document.body.appendChild(toast);
    }
    toast.dataset.kind = kind;
    toast.textContent = message;
  }

  function clearTranslations() {
    for (const node of document.querySelectorAll(".cf-translation")) node.remove();
    document.getElementById("cf-floating-status")?.remove();
  }

  function positionTranslation(source, translation) {
    if (["LI", "TD", "TH", "DD", "DT"].includes(source.tagName)) {
      source.appendChild(translation);
    } else {
      source.insertAdjacentElement("afterend", translation);
    }
  }

  function renderTranslation(item, text, {failed = false, notice = ""} = {}) {
    if (!item.element.isConnected) return;
    if (item.translatedNode?.isConnected) item.translatedNode.remove();
    const box = document.createElement("div");
    box.className = ROOT_CLASS;
    box.setAttribute("data-contextflow-owned", "true");
    if (failed) box.classList.add("cf-error");

    const toolbar = document.createElement("div");
    toolbar.className = "cf-translation-toolbar";
    const label = document.createElement("span");
    label.textContent = failed ? uiText("translationFailed") : uiText("translationLabel");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = uiText("retry");
    retry.title = notice || uiText("retryTitle");
    retry.addEventListener("click", () => retryParagraph(item, box));
    toolbar.append(label, retry);

    const body = document.createElement("div");
    body.className = "cf-translation-body";
    body.textContent = text;
    box.append(toolbar, body);
    positionTranslation(item.element, box);
    item.translatedNode = box;
  }

  function getContext(items, firstIndex, lastIndex) {
    return {
      title: cleanText(document.title).slice(0, 240),
      opening: items.slice(0, 4).map(item => item.text).join("\n").slice(0, 700),
      before: firstIndex > 0 ? items[firstIndex - 1].text.slice(0, 350) : "",
      after: lastIndex < items.length ? items[lastIndex].text.slice(0, 350) : ""
    };
  }

  async function retryParagraph(item, node) {
    if (!node?.isConnected) return;
    const body = node.querySelector(".cf-translation-body");
    const button = node.querySelector("button");
    button.disabled = true;
    body.textContent = uiText("rechecking");
    try {
      const position = state.items.indexOf(item);
      const context = position >= 0 ? getContext(state.items, position, position + 1) : {
        title: cleanText(document.title).slice(0, 240),
        opening: item.text, before: "", after: ""
      };
      const result = await translateGroup([item], context, true);
      if (!result) return;
      renderTranslation(item, result.translations[item.id]);
      item.completed = true;
    } catch (error) {
      renderTranslation(item, uiText("requestFailed", {error: String(error.message || error)}), {failed: true});
      item.completed = false;
    }
  }

  async function processParagraphs(items, token) {
    // The free service translates individual paragraphs; retain earlier successes if a later one fails.
    const batchSize = state.engine?.provider === "mymemory" ? 1 : 5;
    for (let index = 0; index < items.length;) {
      if (state.stop || state.token !== token) break;
      let group = items.slice(index, index + batchSize);
      const longIndex = group.findIndex(item => item.text.length > 1600);
      if (longIndex >= 0) group = longIndex === 0 ? [group[0]] : group.slice(0, longIndex);
      showToast(uiText("translating", {from: index + 1, to: index + group.length, total: items.length}));
      try {
        const response = await translateGroup(group, getContext(items, index, index + group.length), false, token);
        if (state.stop || state.token !== token) break;
        if (!response) break;
        for (const item of group) {
          renderTranslation(item, response.translations[item.id], {notice: response.reviewWarning || ""});
          item.completed = true;
          state.done++;
        }
      } catch (error) {
        if (state.stop || state.token !== token) break;
        for (const item of group) {
          renderTranslation(item, uiText("requestFailed", {error: String(error.message || error)}), {failed: true});
          state.failed++;
        }
        if (error.fatal) {
          state.failureReason = String(error.message || error);
          state.stop = true;
        }
      }
      index += group.length;
    }
    if (state.token !== token) return;
    state.running = false;
    if (state.stop) {
      showToast(uiText(state.failureReason ? "progressFailed" : "progressStopped", {done: state.done, failed: state.failed, error: state.failureReason}), "warn");
    } else {
      const limitNote = state.truncated ? ` ${uiText("limitWarning", {limit: state.total})}` : "";
      showToast(uiText("progressDone", {done: state.done, failed: state.failed}) + limitNote, state.failed || state.truncated ? "warn" : "done");
    }
  }

  function startTranslation(preferences, continuing = false) {
    const previous = continuing ? state.items : [];
    const completed = previous.filter(item => item.completed && item.element.isConnected);
    const completedElements = new Set(completed.map(item => item.element));
    const previousByElement = new Map(previous.map(item => [item.element, item]));
    state.messages = preferences?.messages || {};
    state.engine = preferences?.engine ? {...preferences.engine} : null;
    state.target = preferences?.target || "";
    state.token++;
    state.stop = false;
    state.done = 0;
    state.failed = 0;
    state.failureReason = "";
    state.running = true;
    if (!continuing) clearTranslations();
    const {items: entries, truncated} = getParagraphs(preferences?.maxBlocks || 50, completedElements);
    for (const item of entries) item.translatedNode = previousByElement.get(item.element)?.translatedNode;
    state.truncated = truncated;
    state.total = entries.length;
    state.items = continuing ? [...completed, ...entries] : entries;
    if (!entries.length) {
      state.running = false;
      showToast(uiText(continuing ? "noNewParagraphs" : "noParagraphs"), "warn");
      return {started: false, found: 0};
    }
    const token = state.token;
    void processParagraphs(entries, token).catch(error => {
      if (state.token === token) {
        state.running = false;
        showToast(uiText("progressError", {error: String(error.message || error)}), "warn");
      }
    });
    return {started: true, found: entries.length, truncated};
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CF_PING") {
      sendResponse({ok: true, protocol: 4, running: state.running, count: state.total});
    } else if (message?.type === "CF_START") {
      sendResponse({ok: true, ...startTranslation(message.preferences)});
    } else if (message?.type === "CF_CONTINUE") {
      sendResponse({ok: true, ...startTranslation(message.preferences, true)});
    } else if (message?.type === "CF_STOP") {
      state.stop = true;
      sendResponse({ok: true, stopped: true});
    } else if (message?.type === "CF_CLEAR") {
      state.stop = true;
      state.token++;
      state.running = false;
      clearTranslations();
      sendResponse({ok: true, cleared: true});
    }
  });
})();

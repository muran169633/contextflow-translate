(() => {
  if (globalThis.__contextFlowInstalled) return;
  globalThis.__contextFlowInstalled = true;

  const ROOT_CLASS = "cf-translation";
  const BLOCK_SELECTOR = "h1,h2,h3,h4,p,li,blockquote,figcaption,td,th,dd,dt";
  const SKIP_ANCESTORS = "nav,header,footer,aside,form,button,textarea,select,pre,code,script,style,svg,[role='navigation'],[role='menu'],[aria-hidden='true'],[contenteditable='true'],.cf-translation";
  const state = {token: 0, running: false, stop: false, done: 0, failed: 0, failureReason: "", total: 0, items: [], messages: {}, engine: null};
  function uiText(key, values = {}) {
    const template = state.messages[key] || key;
    return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }

  function rootElement() {
    return document.querySelector("article") ||
      document.querySelector("main article") ||
      document.querySelector("[role='main']") ||
      document.querySelector("main") ||
      document.querySelector(".markdown-body") ||
      document.querySelector("#content") || document.body;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getParagraphs(maxBlocks) {
    const root = rootElement();
    const items = [];
    const limit = Math.max(1, Math.min(150, Number(maxBlocks) || 50));
    for (const element of root.querySelectorAll(BLOCK_SELECTOR)) {
      if (items.length >= limit) break;
      if (element.closest(SKIP_ANCESTORS)) continue;
      if (element.querySelector("p,li,blockquote,h1,h2,h3,h4,table,ul,ol")) continue;
      if (!element.getClientRects().length) continue;
      const css = getComputedStyle(element);
      if (css.visibility === "hidden" || css.display === "none") continue;
      const value = cleanText(element.textContent);
      const isHeading = /^H[1-4]$/.test(element.tagName);
      if (value.length < (isHeading ? 8 : 22) || value.length > 1600) continue;
      if (/^(https?:\/\/\S+|[\w-]+\.[\w-]+)$/.test(value)) continue;
      if ((value.match(/[{};=<>]/g) || []).length > value.length / 8) continue;
      items.push({id: `cf-${items.length + 1}`, element, text: value});
    }
    return items;
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
      const result = await chrome.runtime.sendMessage({
        type: "CF_TRANSLATE", entries: [{id: item.id, text: item.text}], context, engine: state.engine, force: true
      });
      if (!result?.ok) throw new Error(result?.error || "Unknown API error");
      renderTranslation(item, result.translations[item.id]);
    } catch (error) {
      renderTranslation(item, uiText("requestFailed", {error: String(error.message || error)}), {failed: true});
    }
  }

  async function processParagraphs(items, token) {
    // The free service translates individual paragraphs; retain earlier successes if a later one fails.
    const batchSize = state.engine?.provider === "mymemory" ? 1 : 5;
    for (let index = 0; index < items.length; index += batchSize) {
      if (state.stop || state.token !== token) break;
      const group = items.slice(index, index + batchSize);
      showToast(uiText("translating", {from: index + 1, to: index + group.length, total: items.length}));
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CF_TRANSLATE",
          entries: group.map(item => ({id: item.id, text: item.text})),
          engine: state.engine,
          context: getContext(items, index, index + group.length)
        });
        if (state.stop || state.token !== token) break;
        if (!response?.ok) {
          const error = new Error(response?.error || "Unexpected translation failure");
          error.fatal = response?.fatal === true;
          throw error;
        }
        for (const item of group) {
          renderTranslation(item, response.translations[item.id], {notice: response.reviewWarning || ""});
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
    }
    if (state.token !== token) return;
    state.running = false;
    if (state.stop) {
      showToast(uiText(state.failureReason ? "progressFailed" : "progressStopped", {done: state.done, failed: state.failed, error: state.failureReason}), "warn");
    } else {
      showToast(uiText("progressDone", {done: state.done, failed: state.failed}), state.failed ? "warn" : "done");
    }
  }

  function startTranslation(preferences) {
    state.messages = preferences?.messages || {};
    state.engine = preferences?.engine ? {...preferences.engine} : null;
    state.token++;
    state.stop = false;
    state.done = 0;
    state.failed = 0;
    state.failureReason = "";
    state.running = true;
    clearTranslations();
    const entries = getParagraphs(preferences?.maxBlocks || 50);
    state.total = entries.length;
    state.items = entries;
    if (!entries.length) {
      state.running = false;
      showToast(uiText("noParagraphs"), "warn");
      return {started: false, found: 0};
    }
    const token = state.token;
    void processParagraphs(entries, token).catch(error => {
      if (state.token === token) {
        state.running = false;
        showToast(uiText("progressError", {error: String(error.message || error)}), "warn");
      }
    });
    return {started: true, found: entries.length};
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CF_PING") {
      sendResponse({ok: true, protocol: 3, running: state.running, count: state.total});
    } else if (message?.type === "CF_START") {
      sendResponse({ok: true, ...startTranslation(message.preferences)});
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

(() => {
  if (globalThis.__contextFlowInstalled) return;
  globalThis.__contextFlowInstalled = true;

  const ROOT_CLASS = "cf-translation";
  const MAX_INITIAL_BLOCKS = 300;
  const BLOCK_SELECTOR = "h1,h2,h3,h4,p,li,blockquote,figcaption,td,th,dd,dt";
  const SKIP_ANCESTORS = "nav,header,footer,aside,form,button,textarea,select,pre,code,script,style,svg,[role='navigation'],[role='menu'],[aria-hidden='true'],[contenteditable='true'],.cf-translation";
  const state = {token: 0, running: false, stop: false, done: 0, failed: 0, failureReason: "", total: 0, items: [], messages: {}, engine: null, target: "", documentTitle: "", viewport: null, truncated: false, initialRemaining: 0, dynamic: false, dynamicDirty: false, maxBlocks: 50, displayMode: "bilingual"};
  let observer, dynamicTimer, viewportTimer;
  let quickControl, quickTranslateButton, quickCloseButton;
  let quickPosition = null;
  function uiText(key, values = {}) {
    const template = state.messages[key] || key;
    return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }

  function rootElement() {
    if (globalThis.location?.hostname === "www.kaggleusercontent.com" && globalThis.location?.pathname.startsWith("/kf/")) return document.body;
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

  function validViewport(value) {
    return Number.isFinite(value?.top) && Number.isFinite(value?.bottom) && value.top >= 0 && value.bottom >= value.top && value.bottom <= 100000000
      ? {top: value.top, bottom: value.bottom} : null;
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
      const minimum = isHeading ? 8 : ["P", "LI", "BLOCKQUOTE", "DD", "TH", "TD"].includes(element.tagName) ? 2 : 22;
      if (value.length < minimum || !/\p{L}/u.test(value)) continue;
      if (/^(https?:\/\/\S+|[\w-]+\.[\w-]+)$/.test(value)) continue;
      if (/^[\d\s.,+\-−×xEe^%/()]+$/.test(value)) continue;
      if ((value.match(/[{};=<>]/g) || []).length > value.length / 8) continue;
      const rect = element.getBoundingClientRect?.();
      const top = state.viewport?.top ?? 0;
      const bottom = state.viewport?.bottom ?? globalThis.innerHeight;
      const visible = !!rect && Number.isFinite(bottom) && rect.bottom > top && rect.top < bottom;
      items.push({element, text: value, visible});
    }
    const truncated = items.length > limit;
    // 先选择当前视口内的段落，再按文档顺序保留上下文。
    const selected = new Set([...items.filter(item => item.visible), ...items.filter(item => !item.visible)].slice(0, limit));
    const chosen = items.filter(item => selected.has(item));
    chosen.forEach((item, index) => { item.id = `cf-${index + 1}`; });
    return {items: chosen, truncated};
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

  function disambiguateQuantumTerms(text, context) {
    if (state.engine?.source !== "en" || !["zh-CN", "zh-TW"].includes(state.engine?.target)) return text;
    if (!/\bquantum\s+(?:circuits?|comput(?:er|ing|ation))\b/i.test(context?.title || "")) return text;
    if (!/\b(?:quantum|qubits?|circuits?|toffolis?|gates?|decod(?:e|er|es|ing)|syndromes?)\b/i.test(text)) return text;
    const adjusted = text.replace(/\bshots\b/gi, match => match[0] === "S" ? "Circuit runs" : "circuit runs")
      .replace(/\bshot\b/gi, match => match[0] === "S" ? "Circuit run" : "circuit run")
      .replace(/\btoffolis\b/gi, "Toffoli gates");
    return text.length <= 1600 && adjusted.length > 1600 ? text : adjusted;
  }

  function prepareGoogleParagraph(item, context) {
    const selector = "code, .katex, .MathJax, math";
    if (!item.element.querySelector(selector)) return {id: item.id, text: disambiguateQuantumTerms(item.text, context), tokens: []};
    if (typeof item.element.cloneNode !== "function") return {id: item.id, text: item.text, tokens: []};
    const copy = item.element.cloneNode(true);
    for (const node of copy.querySelectorAll(".cf-translation")) node.remove();
    const tokens = [];
    for (const node of copy.querySelectorAll(selector)) {
      if (node.parentElement?.closest(selector)) continue;
      const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      const value = tex ? `$${tex}$` : node.textContent;
      if (!value?.trim()) continue;
      let marker = `CFKEEP${tokens.length}TOKEN`;
      while (item.text.includes(marker)) marker = `X${marker}`;
      tokens.push({marker, value});
      node.replaceWith(document.createTextNode(marker));
    }
    const text = cleanText(copy.textContent);
    const adjusted = disambiguateQuantumTerms(text, context);
    // 长段落会再次切分；只保护完整放入一次请求的段落，避免标记被切断。
    return tokens.length && utf8Length(adjusted) <= 1200 ? {id: item.id, text: adjusted, tokens} : {id: item.id, text: item.text, tokens: []};
  }

  async function translateGroup(items, context, force, token = state.token) {
    const prepared = items.map(item => state.engine?.provider === "google-web" ? prepareGoogleParagraph(item, context) : {id: item.id, text: item.text, tokens: []});
    const chunks = prepared.length === 1 ? splitParagraph(prepared[0].text) : null;
    const groups = chunks ? chunks.map(text => [{id: prepared[0].id, text}]) : [prepared.map(item => ({id: item.id, text: item.text}))];
    const responses = [];
    let next = 0;
    let failure;
    async function worker() {
      while (!failure && next < groups.length && !(state.stop && !force) && state.token === token) {
        const index = next++;
        const entries = groups[index];
        try {
          const response = await chrome.runtime.sendMessage({type: "CF_TRANSLATE", entries, context, engine: state.engine, force});
          if ((state.stop && !force) || state.token !== token) return;
          if (!response?.ok) {
            const error = new Error(response?.error || "Unexpected translation failure");
            error.fatal = response?.fatal === true;
            throw error;
          }
          if (entries.some(entry => typeof response.translations?.[entry.id] !== "string" || !response.translations[entry.id].trim())) throw new Error("Translation response is incomplete.");
          responses[index] = response;
        } catch (error) { failure ||= error; }
      }
    }
    const concurrency = state.engine?.provider === "google-web" && chunks?.length > 1 ? Math.min(3, groups.length) : 1;
    await Promise.all(Array.from({length: concurrency}, () => worker()));
    if ((state.stop && !force) || state.token !== token) return null;
    if (failure) throw failure;
    const lastResponse = responses[responses.length - 1];
    if (chunks) {
      const target = state.engine?.provider === "ai" ? state.target : state.engine?.target || "";
      const separator = /chinese|japanese|^zh\b|^ja\b/i.test(target) ? "" : " ";
      lastResponse.translations[items[0].id] = responses.map(response => response.translations[items[0].id].trim()).join(separator);
    }
    for (const entry of prepared) {
      let translated = lastResponse.translations[entry.id];
      for (const {marker, value} of entry.tokens) {
        const first = translated.indexOf(marker);
        if (first < 0 || first !== translated.lastIndexOf(marker)) throw new Error(uiText("preserveError"));
        translated = translated.slice(0, first) + value + translated.slice(first + marker.length);
      }
      lastResponse.translations[entry.id] = translated;
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

  function moveQuickControl(left, top) {
    if (!quickControl?.isConnected) return;
    const rect = quickControl.getBoundingClientRect();
    const x = Math.max(0, Math.min(left, Math.max(0, globalThis.innerWidth - rect.width)));
    const y = Math.max(0, Math.min(top, Math.max(0, globalThis.innerHeight - rect.height)));
    quickPosition = {left: x, top: y};
    quickControl.style.setProperty("left", `${x}px`, "important");
    quickControl.style.setProperty("top", `${y}px`, "important");
    quickControl.style.setProperty("right", "auto", "important");
    quickControl.style.setProperty("bottom", "auto", "important");
  }

  globalThis.addEventListener?.("resize", () => {
    if (quickPosition) moveQuickControl(quickPosition.left, quickPosition.top);
  });

  function showQuickControl(messages) {
    state.messages = {...state.messages, ...(messages || {})};
    if (quickControl?.isConnected) {
      quickTranslateButton.textContent = uiText("quickTranslate");
      quickTranslateButton.title = `${uiText("quickTranslateTitle")} · ${uiText("quickMove")}`;
      quickTranslateButton.setAttribute("aria-label", quickTranslateButton.title);
      quickCloseButton.title = uiText("quickClose");
      quickCloseButton.setAttribute("aria-label", uiText("quickClose"));
      return;
    }
    quickControl = document.createElement("div");
    quickControl.className = "cf-quick-control";
    quickControl.setAttribute("data-contextflow-owned", "true");
    const translate = document.createElement("button");
    translate.type = "button";
    translate.className = "cf-quick-translate";
    translate.textContent = uiText("quickTranslate");
    translate.title = `${uiText("quickTranslateTitle")} · ${uiText("quickMove")}`;
    translate.setAttribute("aria-label", translate.title);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cf-quick-close";
    close.textContent = "×";
    close.title = uiText("quickClose");
    close.setAttribute("aria-label", uiText("quickClose"));
    let pointer = null;
    let suppressClick = false;
    translate.addEventListener("pointerdown", event => {
      if (event.button !== 0 || pointer) return;
      suppressClick = false;
      const rect = quickControl.getBoundingClientRect();
      pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false};
      translate.setPointerCapture(event.pointerId);
      event.stopPropagation();
    });
    translate.addEventListener("pointermove", event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (!pointer.moved && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 10) return;
      pointer.moved = true;
      moveQuickControl(pointer.left + event.clientX - pointer.x, pointer.top + event.clientY - pointer.y);
      event.preventDefault();
      event.stopPropagation();
    });
    const endDrag = event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      suppressClick = event.type === "pointerup" && pointer.moved;
      pointer = null;
      event.stopPropagation();
    };
    translate.addEventListener("pointerup", endDrag);
    translate.addEventListener("pointercancel", endDrag);
    translate.addEventListener("lostpointercapture", endDrag);
    translate.addEventListener("keydown", event => {
      const direction = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
      if (!direction) return;
      const rect = quickControl.getBoundingClientRect();
      const step = event.shiftKey ? 50 : 10;
      moveQuickControl(rect.left + direction[0] * step, rect.top + direction[1] * step);
      event.preventDefault();
      event.stopPropagation();
    });
    quickTranslateButton = translate;
    quickCloseButton = close;
    close.addEventListener("click", () => quickControl.remove());
    translate.addEventListener("click", async event => {
      if (suppressClick && event.detail !== 0) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Page scripts can see the button but cannot initiate a translation on the user's behalf.
      if (!event.isTrusted || translate.disabled) return;
      translate.disabled = true;
      showToast(uiText("quickStarting"));
      try {
        const result = await chrome.runtime.sendMessage({type: "CF_QUICK_START"});
        if (!result?.ok) showToast(result?.error || uiText("quickError"), "warn");
      } catch (error) {
        showToast(String(error?.message || error), "warn");
      } finally {
        translate.disabled = false;
      }
    });
    quickControl.append(translate, close);
    document.body.appendChild(quickControl);
    if (quickPosition) moveQuickControl(quickPosition.left, quickPosition.top);
  }

  function clearTranslations() {
    for (const node of document.querySelectorAll(".cf-translation")) node.remove();
    document.getElementById("cf-floating-status")?.remove();
  }

  function positionTranslation(source, translation) {
    if (["LI", "TD", "TH", "DD", "DT"].includes(source.tagName)) {
      source.appendChild(translation);
    } else {
      // 横向 flex 容器会把译文当成并列项目，导致标题被挤成竖排。
      let anchor = source;
      while (anchor.parentElement && anchor.parentElement !== document.body) {
        const parentStyle = getComputedStyle(anchor.parentElement);
        if (!["flex", "inline-flex"].includes(parentStyle.display) || String(parentStyle.flexDirection || "row").startsWith("column")) break;
        anchor = anchor.parentElement;
      }
      anchor.insertAdjacentElement("afterend", translation);
    }
  }

  function renderTranslation(item, text, {failed = false, notice = ""} = {}) {
    if (!item.element.isConnected) return;
    if (item.translatedNode?.isConnected) item.translatedNode.remove();
    const box = document.createElement("div");
    box.className = ROOT_CLASS;
    box.setAttribute("data-contextflow-owned", "true");
    if (state.displayMode === "original") box.classList.add("cf-hidden");
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
      title: cleanText(state.documentTitle || document.title).slice(0, 240),
      opening: items.slice(0, 4).map(item => item.text).join("\n").slice(0, 700),
      before: firstIndex > 0 ? items[firstIndex - 1].text.slice(0, 350) : "",
      after: lastIndex < items.length ? items[lastIndex].text.slice(0, 350) : ""
    };
  }

  function stopDynamic() {
    state.dynamic = false;
    state.dynamicDirty = false;
    observer?.disconnect();
    observer = null;
    if (dynamicTimer) clearTimeout(dynamicTimer);
    if (viewportTimer) clearTimeout(viewportTimer);
    dynamicTimer = null;
    viewportTimer = null;
    globalThis.removeEventListener?.("scroll", onDynamicChange, true);
    globalThis.removeEventListener?.("resize", onDynamicChange);
  }

  function notebookViewport() {
    if (globalThis.location?.hostname !== "www.kaggle.com" || !/^\/code\/[^/]+\/[^/]+(?:\/|$)/.test(globalThis.location.pathname)) return null;
    const frame = document.querySelector("iframe#rendered-kernel-content");
    const rect = frame?.getBoundingClientRect();
    if (!rect || !Number.isFinite(globalThis.innerHeight)) return null;
    return {top: Math.max(0, -rect.top), bottom: Math.max(0, globalThis.innerHeight - rect.top)};
  }

  function onDynamicChange(event) {
    if (!state.dynamic || state.stop) return;
    if (["scroll", "resize"].includes(event?.type) && !viewportTimer && notebookViewport()) {
      viewportTimer = setTimeout(() => {
        viewportTimer = null;
        const viewport = notebookViewport();
        if (state.dynamic && !state.stop && viewport) void chrome.runtime.sendMessage({type: "CF_NOTEBOOK_VIEWPORT", viewport}).catch(() => {});
      }, 150);
    }
    state.dynamicDirty = true;
    if (state.running || dynamicTimer) return;
    dynamicTimer = setTimeout(() => {
      dynamicTimer = null;
      if (!state.dynamic || state.stop || state.running) return;
      state.dynamicDirty = false;
      const previous = state.items.filter(item => item.element.isConnected);
      const previousByElement = new Map(previous.map(item => [item.element, item]));
      const unchanged = new Set(previous.filter(item => sourceText(item.element) === item.text).map(item => item.element));
      const background = state.initialRemaining > 0;
      const {items, truncated} = getParagraphs(background ? Math.min(state.maxBlocks, state.initialRemaining) : state.maxBlocks, unchanged);
      const entries = background ? items : items.filter(item => item.visible);
      if (!entries.length) return;
      const replaced = new Set(entries.map(item => item.element));
      for (const item of entries) previousByElement.get(item.element)?.translatedNode?.remove();
      state.items = [...previous.filter(item => !replaced.has(item.element)), ...entries];
      state.running = true;
      state.total += entries.length;
      if (background) state.initialRemaining -= entries.length;
      state.truncated = background && truncated;
      if (!background && entries.length === state.maxBlocks) state.dynamicDirty = true;
      const token = state.token;
      void processParagraphs(entries, token).catch(error => {
        if (state.token === token) {
          state.running = false;
          stopDynamic();
          showToast(uiText("progressError", {error: String(error.message || error)}), "warn");
        }
      });
    }, 250);
  }

  function currentParagraph(item) {
    if (!item.element.isConnected) return false;
    if (sourceText(item.element) === item.text) return true;
    if (state.dynamic) state.dynamicDirty = true;
    return false;
  }

  function startDynamic() {
    if (typeof MutationObserver !== "function") return;
    state.dynamic = true;
    observer = new MutationObserver(records => {
      const isOwned = node => {
        const element = node.nodeType === 1 ? node : node.parentElement;
        return !!element?.closest?.("[data-contextflow-owned]");
      };
      if (records.some(record => !isOwned(record.target) &&
        (record.type !== "childList" || [...record.addedNodes, ...record.removedNodes].some(node => !isOwned(node))))) onDynamicChange();
    });
    observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-expanded", "aria-hidden"]});
    globalThis.addEventListener?.("scroll", onDynamicChange, {capture: true, passive: true});
    globalThis.addEventListener?.("resize", onDynamicChange, {passive: true});
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

  function utf8Length(text) {
    let total = 0;
    for (const character of text) {
      const point = character.codePointAt(0);
      total += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    }
    return total;
  }

  async function processMachineParagraphs(items, token, batchSize, concurrency, maxBytes = Infinity) {
    const priority = items.map((item, index) => ({item, index})).sort((a, b) => Number(b.item.visible) - Number(a.item.visible) || a.index - b.index);
    const jobs = [];
    for (let index = 0; index < priority.length;) {
      let count = Math.min(batchSize, priority.length - index);
      const longIndex = priority.slice(index, index + count).findIndex(entry => entry.item.text.length > 1600);
      if (longIndex >= 0) count = longIndex === 0 ? 1 : longIndex;
      let bytes = 0;
      for (let offset = 0; offset < count; offset++) {
        const next = utf8Length(priority[index + offset].item.text) + (offset ? 2 : 0);
        if (offset > 0 && bytes + next > maxBytes) { count = offset; break; }
        bytes += next;
      }
      jobs.push(priority.slice(index, index + count));
      index += count;
    }
    let next = 0;
    showToast(uiText("progressParallel", {done: state.done, total: state.total, failed: state.failed}));
    async function worker() {
      while (!state.stop && state.token === token) {
        const job = jobs[next];
        if (!job) return;
        next++;
        const group = job.map(entry => entry.item);
        try {
          const first = job[0].index;
          const response = await translateGroup(group, getContext(items, first, first + 1), false, token);
          if (state.stop || state.token !== token || !response) return;
          for (const item of group) {
            if (!currentParagraph(item)) continue;
            renderTranslation(item, response.translations[item.id], {notice: response.reviewWarning || ""});
            item.completed = true;
            state.done++;
          }
        } catch (error) {
          if (state.stop || state.token !== token) return;
          // 批量中某段文本异常时逐段重试，避免无关段落一起失败。
          if (!error.fatal && job.length > 1) {
            jobs.splice(next, 0, ...job.map(entry => [entry]));
            continue;
          }
          for (const item of group) {
            if (!currentParagraph(item)) continue;
            renderTranslation(item, uiText("requestFailed", {error: String(error.message || error)}), {failed: true});
            state.failed++;
          }
          if (error.fatal) {
            state.failureReason = String(error.message || error);
            state.stop = true;
            showToast(uiText("progressFailed", {done: state.done, failed: state.failed, error: state.failureReason}), "warn");
          }
        }
        if (!state.stop && state.token === token) showToast(uiText("progressParallel", {done: state.done, total: state.total, failed: state.failed}));
      }
    }
    await Promise.all(Array.from({length: Math.min(concurrency, jobs.length)}, () => worker()));
  }

  async function processParagraphs(items, token) {
    const provider = state.engine?.provider;
    const individualService = ["mymemory", "youdao", "libre-local"].includes(provider) || (["google-web", "baidu"].includes(provider) && state.engine?.source === "auto");
    const webService = provider === "google-web" && !individualService;
    const baiduService = provider === "baidu" && !individualService;
    const batchService = ["google", "microsoft"].includes(provider);
    if (individualService || batchService || webService || baiduService) await processMachineParagraphs(items, token, individualService ? 1 : 5, provider === "baidu" ? 1 : individualService || webService ? 3 : 2, webService ? 1200 : baiduService ? 900 : Infinity);
    else {
      const jobs = [];
      for (let index = 0; index < items.length;) {
        let group = items.slice(index, index + 5);
        const longIndex = group.findIndex(item => item.text.length > 1600);
        if (longIndex >= 0) group = longIndex === 0 ? [group[0]] : group.slice(0, longIndex);
        jobs.push({index, group, visible: group.some(item => item.visible)});
        index += group.length;
      }
      jobs.sort((a, b) => Number(b.visible) - Number(a.visible) || a.index - b.index);
      for (const {index, group} of jobs) {
        if (state.stop || state.token !== token) break;
        showToast(uiText("translating", {from: index + 1, to: index + group.length, total: items.length}));
        try {
          const response = await translateGroup(group, getContext(items, index, index + group.length), false, token);
          if (state.stop || state.token !== token) break;
          if (!response) break;
          for (const item of group) {
            if (!currentParagraph(item)) continue;
            renderTranslation(item, response.translations[item.id], {notice: response.reviewWarning || ""});
            item.completed = true;
            state.done++;
          }
        } catch (error) {
          if (state.stop || state.token !== token) break;
          for (const item of group) {
            if (!currentParagraph(item)) continue;
            renderTranslation(item, uiText("requestFailed", {error: String(error.message || error)}), {failed: true});
            state.failed++;
          }
          if (error.fatal) {
            state.failureReason = String(error.message || error);
            state.stop = true;
          }
        }
      }
    }
    if (state.token !== token) return;
    state.running = false;
    if (state.stop) {
      stopDynamic();
      showToast(uiText(state.failureReason ? "progressFailed" : "progressStopped", {done: state.done, failed: state.failed, error: state.failureReason}), "warn");
    } else {
      if (state.truncated && state.initialRemaining > 0) {
        const previous = state.items.filter(item => item.element.isConnected);
        // 已尝试过的段落（包括失败段落）不会在同一次自动处理时重复请求。
        const unchanged = new Set(previous.filter(item => sourceText(item.element) === item.text).map(item => item.element));
        const {items: nextItems, truncated} = getParagraphs(Math.min(state.maxBlocks, state.initialRemaining), unchanged);
        if (nextItems.length) {
          const replaced = new Set(nextItems.map(item => item.element));
          const previousByElement = new Map(previous.map(item => [item.element, item]));
          for (const item of nextItems) item.translatedNode = previousByElement.get(item.element)?.translatedNode;
          state.items = [...previous.filter(item => !replaced.has(item.element)), ...nextItems];
          state.initialRemaining -= nextItems.length;
          state.total += nextItems.length;
          state.truncated = truncated;
          state.running = true;
          await processParagraphs(nextItems, token);
          return;
        }
        state.truncated = false;
      }
      const limitNote = state.truncated ? ` ${uiText("limitWarning", {limit: state.total})}` : "";
      showToast(uiText("progressDone", {done: state.done, failed: state.failed}) + limitNote, state.failed || state.truncated ? "warn" : "done");
      if (state.dynamicDirty) onDynamicChange();
    }
  }

  function startTranslation(preferences, continuing = false) {
    stopDynamic();
    const previous = continuing ? state.items : [];
    const completed = previous.filter(item => item.completed && item.element.isConnected && sourceText(item.element) === item.text);
    const completedElements = new Set(completed.map(item => item.element));
    const previousByElement = new Map(previous.map(item => [item.element, item]));
    state.messages = preferences?.messages || {};
    state.engine = preferences?.engine ? {...preferences.engine} : null;
    state.target = preferences?.target || "";
    state.documentTitle = String(preferences?.documentTitle || "").slice(0, 240);
    state.viewport = validViewport(preferences?.viewport);
    state.maxBlocks = Math.max(1, Math.min(150, Number(preferences?.maxBlocks) || 50));
    state.token++;
    state.stop = false;
    state.done = 0;
    state.failed = 0;
    state.failureReason = "";
    state.running = true;
    if (!continuing) clearTranslations();
    const {items: entries, truncated} = getParagraphs(state.maxBlocks, completedElements);
    for (const item of entries) item.translatedNode = previousByElement.get(item.element)?.translatedNode;
    state.truncated = truncated;
    state.initialRemaining = MAX_INITIAL_BLOCKS - entries.length;
    state.total = entries.length;
    state.items = continuing ? [...completed, ...entries] : entries;
    if (preferences?.dynamic === true) startDynamic();
    if (!entries.length) {
      state.running = false;
      showToast(uiText(continuing ? "noNewParagraphs" : "noParagraphs"), "warn");
      return {started: false, found: 0};
    }
    const token = state.token;
    void processParagraphs(entries, token).catch(error => {
      if (state.token === token) {
        state.running = false;
        stopDynamic();
        showToast(uiText("progressError", {error: String(error.message || error)}), "warn");
      }
    });
    return {started: true, found: entries.length, truncated};
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CF_PING") {
      sendResponse({ok: true, protocol: 22, running: state.running, count: state.total, displayMode: state.displayMode});
    } else if (message?.type === "CF_NOTEBOOK_VIEWPORT") {
      sendResponse({ok: true, viewport: notebookViewport()});
    } else if (message?.type === "CF_SET_VIEWPORT") {
      state.viewport = validViewport(message.viewport);
      if (state.dynamic) onDynamicChange();
      sendResponse({ok: true});
    } else if (message?.type === "CF_SET_DISPLAY") {
      if (!["bilingual", "original"].includes(message.mode)) {
        sendResponse({ok: false});
        return;
      }
      state.displayMode = message.mode;
      for (const node of document.querySelectorAll(".cf-translation")) node.classList.toggle("cf-hidden", state.displayMode === "original");
      sendResponse({ok: true, displayMode: state.displayMode});
    } else if (message?.type === "CF_QUICK_SHOW") {
      showQuickControl(message.preferences?.messages);
      sendResponse({ok: true});
    } else if (message?.type === "CF_QUICK_NOTICE") {
      state.messages = {...state.messages, ...(message.preferences?.messages || {})};
      showToast(String(message.text || ""), message.kind === "info" ? "info" : "warn");
      sendResponse({ok: true});
    } else if (message?.type === "CF_START") {
      sendResponse({ok: true, ...startTranslation(message.preferences)});
    } else if (message?.type === "CF_CONTINUE") {
      sendResponse({ok: true, ...startTranslation(message.preferences, true)});
    } else if (message?.type === "CF_STOP") {
      const wasDynamic = state.dynamic;
      stopDynamic();
      state.stop = true;
      if (state.running || wasDynamic) showToast(uiText("progressStopped", {done: state.done, failed: state.failed}), "warn");
      sendResponse({ok: true, stopped: true});
    } else if (message?.type === "CF_CLEAR") {
      stopDynamic();
      state.stop = true;
      state.token++;
      state.running = false;
      clearTranslations();
      sendResponse({ok: true, cleared: true});
    }
  });
})();

import test from "node:test";
import assert from "node:assert/strict";

test("复制按钮读取当前标签并写入剪贴板", async () => {
  const elements = new Map();
  for (const id of ["message", "model", "detail", "start", "continue", "stop", "clear", "copy-discussion", "settings", "uiLanguage", "provider", "freeSource", "freeTarget", "free-controls", "ai-controls", "mymemory-info", "google-info", "google-web-info", "youdao-info", "microsoft-info"]) {
    elements.set(id, {textContent: "", className: "", disabled: false, replaceChildren() {}, addEventListener(_type, fn) { this.click = fn; }});
  }
  const buttons = ["start", "continue", "stop", "clear", "copy-discussion", "settings"].map(id => elements.get(id));
  const copied = Promise.withResolvers();
  let installed;
  globalThis.document = {documentElement: {}, createElement: () => ({}), getElementById: id => elements.get(id), querySelectorAll: selector => selector === 'button' ? buttons : []};
  Object.defineProperty(globalThis, "navigator", {configurable: true, value: {language: 'zh-CN', clipboard: {writeText: async text => copied.resolve(text)}}});
  globalThis.chrome = {
    storage: {local: {get: async () => ({})}},
    tabs: {query: async () => [{id: 7, url: "https://www.kaggle.com/discussion/123"}], sendMessage: async (_id, message) => {
      if (message.type === 'CF_PING') return {ok: true, protocol: 10};
      if (message.type === 'CF_QUICK_SHOW') return {ok: true};
      assert.equal(message.type, "CF_COPY_DISCUSSION");
      return {ok: true, topic: {firstMessage: {author: {displayName: "甲"}, rawMarkdown: "主题"}, comments: [{author: {displayName: "乙"}, rawMarkdown: "回复"}]}};
    }},
    scripting: {executeScript: async options => { installed = options; }},
    runtime: {openOptionsPage() {}}
  };
  try {
    await import("../popup.js");
    await new Promise(resolve => setImmediate(resolve));
    elements.get("copy-discussion").click();
    assert.equal(await copied.promise, "甲：\n主题\n\n乙 回复 甲：\n回复");
    await new Promise(resolve => setImmediate(resolve));
    assert.match(elements.get("message").textContent, /已复制 2 条/);
    assert.deepEqual(installed, {target: {tabId: 7}, files: ["discussion.js"]});
  } finally {
    delete globalThis.document;
    delete globalThis.chrome;
    delete globalThis.navigator;
  }
});

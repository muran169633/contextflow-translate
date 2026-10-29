import test from "node:test";
import assert from "node:assert/strict";

test("复制按钮读取当前标签并写入剪贴板", async () => {
  const elements = new Map();
  for (const id of ["message", "model", "detail", "start", "stop", "clear", "copy-discussion", "settings"]) {
    elements.set(id, {textContent: "", className: "", disabled: false, addEventListener(_type, fn) { this.click = fn; }});
  }
  const buttons = ["start", "stop", "clear", "copy-discussion", "settings"].map(id => elements.get(id));
  const copied = Promise.withResolvers();
  let installed;
  globalThis.document = {getElementById: id => elements.get(id), querySelectorAll: () => buttons};
  Object.defineProperty(globalThis, "navigator", {configurable: true, value: {clipboard: {writeText: async text => copied.resolve(text)}}});
  globalThis.chrome = {
    storage: {local: {get: async () => ({})}},
    tabs: {query: async () => [{id: 7, url: "https://www.kaggle.com/discussion/123"}], sendMessage: async (_id, message) => {
      assert.equal(message.type, "CF_COPY_DISCUSSION");
      return {ok: true, topic: {firstMessage: {author: {displayName: "甲"}, rawMarkdown: "主题"}, comments: [{author: {displayName: "乙"}, rawMarkdown: "回复"}]}};
    }},
    scripting: {executeScript: async options => { installed = options; }},
    runtime: {openOptionsPage() {}}
  };
  try {
    await import("../popup.js");
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

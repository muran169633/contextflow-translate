import test from 'node:test';
import assert from 'node:assert/strict';

test('免费模式通过弹窗请求权限并启动翻译，无需模型', async () => {
  const nodes = new Map();
  for (const id of ['message', 'model', 'detail', 'start', 'stop', 'clear', 'copy-discussion', 'settings', 'uiLanguage', 'provider', 'freeSource', 'freeTarget', 'free-controls', 'ai-controls', 'mymemory-info', 'google-info']) {
    nodes.set(id, {value: '', disabled: false, textContent: '', className: '', replaceChildren() {}, addEventListener(_type, fn) { this.handler = fn; }});
  }
  const buttons = ['start', 'stop', 'clear', 'copy-discussion', 'settings'].map(id => nodes.get(id));
  const saved = {};
  let requested;
  let started;
  let pingVersion = 3;
  let backgroundVersion = 3;
  let starts = 0;
  globalThis.document = {documentElement: {}, createElement: () => ({}), getElementById: id => nodes.get(id), querySelectorAll: selector => selector === 'button' ? buttons : []};
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {language: 'zh-CN'}});
  globalThis.chrome = {
    storage: {local: {get: async key => ({[key]: saved[key]}), set: async data => Object.assign(saved, data)}},
    permissions: {request: ({origins}) => { requested = origins; return Promise.resolve(true); }},
    tabs: {query: async () => [{id: 1, url: 'https://example.com/article'}], sendMessage: async (_id, message) => {
      if (message.type === 'CF_PING') return {ok: true, protocol: pingVersion};
      if (message.type === 'CF_START') { started = message; starts++; return {started: true, found: 1}; }
      throw new Error('unexpected message');
    }},
    scripting: {}, runtime: {sendMessage: async () => ({ok: true, protocol: backgroundVersion})}
  };
  try {
    await import('../popup.js');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.get('provider').value, 'mymemory');
    nodes.get('start').handler();
    assert.deepEqual(requested, ['https://api.mymemory.translated.net/*']);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saved.translationEngine.provider, 'mymemory');
    assert.equal(saved.translationEngine.source, 'en');
    assert.equal(saved.translationEngine.target, 'zh-CN');
    assert.equal(started.type, 'CF_START');
    assert.deepEqual(started.preferences.engine, {provider: 'mymemory', source: 'en', target: 'zh-CN'});
    assert.match(nodes.get('message').textContent, /已开始翻译/);
    pingVersion = 1;
    nodes.get('start').handler();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 1);
    assert.match(nodes.get('message').textContent, /刷新网页/);
    pingVersion = 3;
    backgroundVersion = 1;
    nodes.get('start').handler();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 1);
    assert.match(nodes.get('message').textContent, /重新加载扩展/);
  } finally {
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.chrome;
  }
});

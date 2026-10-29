import test from 'node:test';
import assert from 'node:assert/strict';

test('有道入口申请对应权限并使用所选服务启动', async () => {
  const nodes = new Map();
  for (const id of ['message', 'model', 'detail', 'start', 'continue', 'stop', 'clear', 'copy-discussion', 'settings', 'uiLanguage', 'provider', 'freeSource', 'freeTarget', 'free-controls', 'ai-controls', 'mymemory-info', 'google-info', 'google-web-info', 'youdao-info', 'microsoft-info', 'dynamicInfo', 'mode-bilingual', 'mode-original']) {
    nodes.set(id, {value: '', disabled: false, textContent: '', className: '', setAttribute(key, value) { this[key] = value; }, replaceChildren() {}, addEventListener(_type, fn) { this.handler = fn; }});
  }
  const buttons = ['start', 'continue', 'stop', 'clear', 'copy-discussion', 'settings'].map(id => nodes.get(id));
  const saved = {settings: {model: '', youdaoAppKey: 'id', youdaoAppSecret: 'secret'}, translationEngine: {provider: 'youdao', source: 'en', target: 'zh-CN'}};
  let origin;
  let started;
  globalThis.document = {documentElement: {}, createElement: () => ({}), getElementById: id => nodes.get(id), querySelectorAll: selector => selector === 'button' ? buttons : []};
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {language: 'zh-CN'}});
  globalThis.chrome = {
    storage: {local: {get: async key => ({[key]: saved[key]}), set: async data => Object.assign(saved, data)}},
    permissions: {request: ({origins}) => { origin = origins[0]; return Promise.resolve(true); }},
    tabs: {query: async () => [{id: 1, url: 'https://example.com/article'}], sendMessage: async (_id, message) => {
      if (message.type === 'CF_PING') return {ok: true, protocol: 14};
      if (message.type === 'CF_QUICK_SHOW') return {ok: true};
      started = message;
      return {started: true, found: 1};
    }}, scripting: {}, runtime: {sendMessage: async () => ({ok: true, protocol: 14})}
  };
  try {
    await import('../popup.js');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.get('provider').value, 'youdao');
    assert.equal(nodes.get('youdao-info').hidden, false);
    nodes.get('start').handler();
    assert.equal(origin, 'https://openapi.youdao.com/*');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.preferences.engine.provider, 'youdao');
  } finally {
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.chrome;
  }
});

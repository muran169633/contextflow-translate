import test from 'node:test';
import assert from 'node:assert/strict';

test('免费模式通过弹窗请求权限并启动翻译，无需模型', async () => {
  const nodes = new Map();
  for (const id of ['message', 'model', 'detail', 'start', 'continue', 'stop', 'clear', 'copy-discussion', 'settings', 'uiLanguage', 'provider', 'freeSource', 'freeTarget', 'free-controls', 'ai-controls', 'mymemory-info', 'google-info', 'google-web-info', 'youdao-info', 'microsoft-info', 'dynamicInfo', 'mode-bilingual', 'mode-original', 'kaggleInfo', 'autoSourceInfo', 'swapLanguages', 'libre-info', 'baidu-info']) {
    nodes.set(id, {value: '', disabled: false, textContent: '', className: '', setAttribute(key, value) { this[key] = value; }, replaceChildren() {}, addEventListener(_type, fn) { this.handler = fn; }});
  }
  const buttons = ['start', 'continue', 'stop', 'clear', 'copy-discussion', 'settings'].map(id => nodes.get(id));
  const saved = {};
  let requested;
  let started;
  let pingVersion = 21;
  let backgroundVersion = 21;
  let starts = 0;
  let quickShown = false;
  let permissionFailure = false;
  globalThis.document = {documentElement: {}, createElement: () => ({}), getElementById: id => nodes.get(id), querySelectorAll: selector => selector === 'button' ? buttons : []};
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {language: 'zh-CN'}});
  globalThis.chrome = {
    storage: {local: {get: async key => ({[key]: saved[key]}), set: async data => Object.assign(saved, data)}},
    permissions: {request: ({origins}) => { if (permissionFailure) throw new Error('权限请求失败'); requested = origins; return Promise.resolve(true); }},
    tabs: {query: async () => [{id: 1, url: 'https://example.com/article'}], sendMessage: async (_id, message) => {
      if (message.type === 'CF_PING') return {ok: true, protocol: pingVersion};
      if (message.type === 'CF_QUICK_SHOW') { quickShown = true; return {ok: true}; }
      if (message.type === 'CF_START' || message.type === 'CF_CONTINUE') { started = message; starts++; return {started: true, found: 1}; }
      throw new Error('unexpected message');
    }},
    scripting: {}, runtime: {sendMessage: async () => ({ok: true, protocol: backgroundVersion})}
  };
  try {
    await import('../popup.js');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes.get('provider').value, 'mymemory');
    assert.match(nodes.get('dynamicInfo').textContent, /自动翻译已开启/);
    assert.equal(quickShown, true);
    nodes.get('start').handler();
    assert.deepEqual(requested, ['https://api.mymemory.translated.net/*']);
    assert.match(nodes.get('message').textContent, /正在启动/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(saved.translationEngine.provider, 'mymemory');
    assert.equal(saved.translationEngine.source, 'en');
    assert.equal(saved.translationEngine.target, 'zh-CN');
    assert.equal(started.type, 'CF_START');
    assert.equal(started.preferences.dynamic, true);
    assert.deepEqual(started.preferences.engine, {provider: 'mymemory', source: 'en', target: 'zh-CN'});
    assert.match(nodes.get('message').textContent, /已开始翻译/);
    nodes.get('continue').handler();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.type, 'CF_CONTINUE');
    assert.equal(starts, 2);
    pingVersion = 1;
    nodes.get('start').handler();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 2);
    assert.match(nodes.get('message').textContent, /刷新网页/);
    pingVersion = 21;
    backgroundVersion = 1;
    nodes.get('start').handler();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(starts, 2);
    assert.match(nodes.get('message').textContent, /重新加载扩展/);
    permissionFailure = true;
    nodes.get('start').handler();
    assert.match(nodes.get('message').textContent, /权限请求失败/);
  } finally {
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.chrome;
  }
});

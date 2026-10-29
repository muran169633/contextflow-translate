import test from 'node:test';
import assert from 'node:assert/strict';

test('切换服务时隔离密钥并保留已有兼容接口配置', async () => {
  const elements = new Map();
  for (const id of ['uiLanguage', 'message', 'aiProvider', 'endpoint', 'endpointHelp', 'model', 'apiKey', 'googleTranslateKey', 'saveGoogleKey', 'youdaoAppKey', 'youdaoAppSecret', 'saveYoudaoKey', 'source', 'target', 'style', 'glossary', 'maxBlocks', 'review', 'cache', 'save', 'test', 'clearCache']) {
    elements.set(id, {value: '', checked: false, disabled: false, textContent: '', className: '', addEventListener(_event, fn) { this.handler = fn; }});
  }
  const store = {settings: {endpoint: 'https://gateway.example/v1', model: 'old-model', apiKey: 'old-key', target: 'Chinese', source: 'auto', style: 'faithful', cache: true, maxBlocks: 50}};
  let origin;
  globalThis.document = {documentElement: {}, getElementById: id => elements.get(id), querySelectorAll: () => []};
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {language: 'zh-CN'}});
  globalThis.chrome = {storage: {local: {get: async key => ({[key]: store[key]}), set: async data => Object.assign(store, data)}}, permissions: {request: async ({origins}) => { origin = origins[0]; return true; }}};
  try {
    await import('../options.js');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('apiKey').value, 'old-key');
    elements.get('aiProvider').value = 'gemini';
    elements.get('aiProvider').handler();
    assert.equal(elements.get('apiKey').value, '');
    assert.equal(elements.get('model').value, '');
    assert.equal(elements.get('endpoint').readOnly, true);
    elements.get('model').value = 'gemini-test';
    elements.get('apiKey').value = 'new-key';
    await elements.get('save').handler();
    assert.equal(origin, 'https://generativelanguage.googleapis.com/*');
    assert.equal(store.settings.aiProvider, 'gemini');
    assert.equal(store.settings.connections.compatible.apiKey, 'old-key');
    assert.equal(store.settings.connections.gemini.apiKey, 'new-key');
    elements.get('aiProvider').value = 'compatible';
    elements.get('aiProvider').handler();
    assert.equal(elements.get('apiKey').value, 'old-key');
    assert.equal(elements.get('endpoint').value, 'https://gateway.example/v1');
    elements.get('googleTranslateKey').value = 'google-key';
    await elements.get('saveGoogleKey').handler();
    assert.equal(store.settings.googleTranslateKey, 'google-key');
    assert.equal(store.settings.connections.gemini.apiKey, 'new-key');
    elements.get('youdaoAppKey').value = 'youdao-id';
    elements.get('youdaoAppSecret').value = 'youdao-secret';
    await elements.get('saveYoudaoKey').handler();
    assert.equal(store.settings.youdaoAppKey, 'youdao-id');
    assert.equal(store.settings.youdaoAppSecret, 'youdao-secret');
    assert.equal(store.settings.googleTranslateKey, 'google-key');
  } finally {
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.chrome;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

test('切换服务时隔离密钥并保留已有兼容接口配置', async () => {
  const elements = new Map();
  for (const id of ['uiLanguage', 'message', 'aiProvider', 'endpoint', 'endpointHelp', 'model', 'apiKey', 'googleTranslateKey', 'saveGoogleKey', 'youdaoAppKey', 'youdaoAppSecret', 'saveYoudaoKey', 'microsoftKey', 'microsoftRegion', 'saveMicrosoftKey', 'source', 'target', 'style', 'glossary', 'maxBlocks', 'review', 'cache', 'dynamic', 'save', 'test', 'clearCache']) {
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
    elements.get('microsoftKey').value = 'ms-key';
    elements.get('microsoftRegion').value = 'eastus';
    await elements.get('saveMicrosoftKey').handler();
    assert.equal(store.settings.microsoftKey, 'ms-key');
    assert.equal(store.settings.microsoftRegion, 'eastus');
    assert.equal(store.settings.youdaoAppSecret, 'youdao-secret');
  } finally {
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.chrome;
  }
});

test('未配置 AI 模型也能关闭自动翻译，不请求额外域名权限', async () => {
  const elements = new Map();
  for (const id of ['uiLanguage','message','aiProvider','endpoint','endpointHelp','model','apiKey','googleTranslateKey','saveGoogleKey','youdaoAppKey','youdaoAppSecret','saveYoudaoKey','microsoftKey','microsoftRegion','saveMicrosoftKey','source','target','style','glossary','maxBlocks','review','cache','dynamic','save','test','clearCache']) {
    elements.set(id, {value:'', checked:false, textContent:'', addEventListener(_event, fn) {this.handler=fn;}});
  }
  const store = {settings:{model:'', dynamic:true}};
  let permissions = 0;
  globalThis.document = {documentElement:{}, getElementById:id => elements.get(id), querySelectorAll:() => []};
  Object.defineProperty(globalThis, 'navigator', {configurable:true, value:{language:'zh-CN'}});
  globalThis.chrome = {storage:{local:{get:async key => ({[key]:store[key]}), set:async data => Object.assign(store,data)}}, permissions:{request:async () => {permissions++; return true;}}};
  try {
    await import('../options.js?dynamic-test');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('dynamic').checked, true);
    elements.get('dynamic').checked = false;
    await elements.get('save').handler();
    assert.equal(store.settings.dynamic, false);
    assert.equal(permissions, 0);
    assert.match(elements.get('message').textContent, /设置已保存/);
  } finally {
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.chrome;
  }
});

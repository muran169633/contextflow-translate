import test from 'node:test';
import assert from 'node:assert/strict';
let commandListener;
let runtimeListener;
let permitted = false;
let installed = true;
let running = false;
let displayMode = 'bilingual';
let injectedCss = 0;
const messages = [];
const saved = {settings: {model: '', target: 'Simplified Chinese (zh-CN)', maxBlocks: 8}, translationEngine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}, uiLanguage: 'zh-CN'};
globalThis.chrome = {
  runtime: {id: 'test', onMessage: {addListener: fn => { runtimeListener = fn; }}},
  commands: {onCommand: {addListener: fn => { commandListener = fn; }}},
  storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: saved[key]}), set: async data => Object.assign(saved, data)}},
  permissions: {contains: async ({origins}) => permitted && ['https://api.mymemory.translated.net/*', 'https://translate.googleapis.com/*', 'https://openapi.youdao.com/*', 'https://api.cognitive.microsofttranslator.com/*', 'http://127.0.0.1/*'].includes(origins[0])},
  tabs: {sendMessage: async (tabId, message) => {
    messages.push({tabId, ...message});
    if (message.type === 'CF_PING') {
      if (!installed) throw new Error('No receiver');
      return {ok: true, protocol: 19, running, displayMode};
    }
    if (message.type === 'CF_QUICK_SHOW' || message.type === 'CF_QUICK_NOTICE') return {ok: true};
    if (message.type === 'CF_START') return {ok: true, started: true, found: 1};
    if (message.type === 'CF_SET_DISPLAY') { displayMode = message.mode; return {ok: true, displayMode}; }
    throw new Error(`Unexpected ${message.type}`);
  }},
  scripting: {insertCSS: async () => { injectedCss++; }, executeScript: async () => { installed = true; }}
};
await import('../background.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('快捷键缺少授权时提示配置，不发送翻译请求', async () => {
  commandListener('quick-translate', {id: 7, url: 'https://example.com/'});
  await tick();
  assert.equal(messages.some(message => message.type === 'CF_START'), false);
  assert.match(messages.find(message => message.type === 'CF_QUICK_NOTICE').text, /完成授权/);
});

test('在尚未注入扩展的新页面按快捷键会先安装界面再翻译', async () => {
  permitted = true;
  installed = false;
  messages.length = 0;
  commandListener('quick-translate', {id: 8, url: 'https://example.com/new'});
  await tick();
  assert.equal(injectedCss, 1);
  assert.equal(messages.find(message => message.type === 'CF_QUICK_SHOW').tabId, 8);
  assert.equal(messages.find(message => message.type === 'CF_START').tabId, 8);
});

test('快捷键和悬浮按钮使用当前配置启动翻译', async () => {
  permitted = true;
  messages.length = 0;
  commandListener('quick-translate', {id: 7, url: 'https://example.com/'});
  await tick();
  const start = messages.find(message => message.type === 'CF_START');
  assert.equal(start.tabId, 7);
  assert.deepEqual(start.preferences.engine, saved.translationEngine);
  assert.equal(start.preferences.maxBlocks, 8);
  const result = await new Promise(resolve => runtimeListener({type: 'CF_QUICK_START'}, {id: 'test', tab: {id: 7, url: 'https://example.com/'}}, resolve));
  assert.equal(result.ok, true);
  assert.equal(messages.filter(message => message.type === 'CF_START').length, 2);
});

test('页面已经在翻译时快捷键不会重启或重复发送', async () => {
  running = true;
  messages.length = 0;
  commandListener('quick-translate', {id: 7, url: 'https://example.com/'});
  await tick();
  assert.equal(messages.some(message => message.type === 'CF_START'), false);
  assert.match(messages.find(message => message.type === 'CF_QUICK_NOTICE').text, /正在翻译/);
  running = false;
});

test('快捷键支持无需模型的 Google 网页翻译', async () => {
  saved.translationEngine = {provider: 'google-web', source: 'en', target: 'zh-CN'};
  messages.length = 0;
  commandListener('quick-translate', {id: 7, url: 'https://example.com/'});
  await tick();
  assert.equal(messages.find(message => message.type === 'CF_START').preferences.engine.provider, 'google-web');
});

test('快捷键使用有道配置且不向网页传递凭据', async () => {
  saved.settings.youdaoAppKey = 'id';
  saved.settings.youdaoAppSecret = 'secret';
  saved.translationEngine = {provider: 'youdao', source: 'en', target: 'zh-CN'};
  messages.length = 0;
  commandListener('quick-translate', {id: 7, url: 'https://example.com/'});
  await tick();
  const start = messages.find(message => message.type === 'CF_START');
  assert.equal(start.preferences.engine.provider, 'youdao');
  assert.equal(JSON.stringify(start).includes('secret'), false);
});

test('快捷键支持微软翻译且不向网页发送密钥', async () => {
  saved.settings.microsoftKey = 'ms-secret';
  saved.settings.microsoftRegion = 'eastus';
  saved.translationEngine = {provider:'microsoft', source:'en', target:'zh-CN'};
  messages.length = 0;
  commandListener('quick-translate', {id:7, url:'https://example.com/'});
  await tick();
  const start = messages.find(message => message.type === 'CF_START');
  assert.equal(start.preferences.engine.provider, 'microsoft');
  assert.equal(JSON.stringify(start).includes('ms-secret'), false);
});

test('原文和双语快捷键只切换显示，不发起翻译', async () => {
  messages.length = 0; displayMode = 'bilingual';
  commandListener('toggle-display', {id: 7, url: 'https://example.com/'});
  await tick();
  assert.equal(displayMode, 'original');
  assert.equal(messages.filter(message => message.type === 'CF_START').length, 0);
  assert.match(messages.find(message => message.type === 'CF_QUICK_NOTICE').text, /原文/);
  messages.length = 0;
  commandListener('toggle-display', {id: 7, url: 'https://example.com/'});
  await tick();
  assert.equal(displayMode, 'bilingual');
  assert.equal(messages.filter(message => message.type === 'CF_START').length, 0);
});

test('快捷翻译支持已授权的本机 LibreTranslate', async () => {
  permitted = true;
  saved.translationEngine = {provider:'libre-local',source:'auto',target:'zh-CN'};
  messages.length = 0;
  commandListener('quick-translate', {id:7,url:'https://example.com/'});
  await tick();
  assert.equal(messages.find(message => message.type === 'CF_START').preferences.engine.provider, 'libre-local');
});

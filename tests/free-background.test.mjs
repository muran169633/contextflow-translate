import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let fetchCount = 0;
let lastUrl;
const store = {translationEngine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}, settings: {model: '', cache: true}};
globalThis.chrome = {
  runtime: {id: 'test', onMessage: {addListener: callback => { listener = callback; }}},
  permissions: {contains: async ({origins}) => ['https://api.mymemory.translated.net/*','https://translate.googleapis.com/*'].includes(origins[0])},
  storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: structuredClone(store[key])}), set: async data => Object.assign(store, structuredClone(data))}}
};
globalThis.fetch = async url => {
  fetchCount++;
  lastUrl = new URL(url);
  assert.equal(new URL(url).searchParams.get('langpair'), 'en|zh-CN');
  return {ok: true, json: async () => ({responseStatus: 200, responseData: {translatedText: '无需模型的翻译'}})};
};
await import('../background.js');
const run = engine => new Promise(resolve => listener({type: 'CF_TRANSLATE', entries: [{id: 'cf-1', text: 'A short test paragraph.'}], context: {}, engine}, {id: 'test', tab: {id: 1}}, resolve));

test('无需模型的免费翻译走正式后台入口并缓存', async () => {
  const first = await run();
  assert.equal(first.ok, true);
  assert.equal(first.translations['cf-1'], '无需模型的翻译');
  const second = await run();
  assert.equal(second.cacheHit, true);
  assert.equal(fetchCount, 1);
});

test('相同原文在页面位置和周边文本变化时复用缓存并映射新段落 ID', async () => {
  const message = {type: 'CF_TRANSLATE', entries: [{id: 'cf-88', text: 'A short test paragraph.'}], context: {title: 'New title'}, engine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}};
  const result = await new Promise(resolve => listener(message, {id: 'test', tab: {id: 1}}, resolve));
  assert.equal(result.cacheHit, true);
  assert.equal(result.translations['cf-88'], '无需模型的翻译');
  assert.equal(fetchCount, 1);
});

test('多个并发请求的缓存写入不会互相覆盖', async () => {
  const engine = {provider: 'mymemory', source: 'en', target: 'zh-CN'};
  const send = index => new Promise(resolve => listener({type: 'CF_TRANSLATE', entries: [{id: `cf-${index}`, text: `Different paragraph number ${index}.`}], context: {}, engine}, {id: 'test', tab: {id: 1}}, resolve));
  const results = await Promise.all([send(2), send(3), send(4)]);
  assert.ok(results.every(result => result.ok));
  assert.equal(Object.keys(store.translationCache).length, 4);
  const before = fetchCount;
  assert.ok((await Promise.all([send(2), send(3), send(4)])).every(result => result.cacheHit));
  assert.equal(fetchCount, before);
});

test('每次运行的服务选择不受后台旧配置影响', async () => {
  store.translationEngine = {provider: 'ai', source: 'en', target: 'zh-CN'};
  const free = await run({provider: 'mymemory', source: 'en', target: 'zh-CN'});
  assert.equal(free.ok, true);
  assert.equal(free.translations['cf-1'], '无需模型的翻译');
  const invalid = await run({provider: 'unknown', source: 'en', target: 'zh-CN'});
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Invalid translation engine/);
});

test('后台仅在用户设置邮箱后发送 MyMemory 联系参数，清除后恢复匿名', async () => {
  store.settings.mymemoryEmail='reader@example.com';
  const send=()=>new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Email setting check.'}],context:{},engine:{provider:'mymemory',source:'en',target:'zh-CN'},force:true},{id:'test',tab:{id:1}},resolve));
  assert.equal((await send()).ok,true);
  assert.equal(lastUrl.searchParams.get('de'),'reader@example.com');
  store.settings.mymemoryEmail='';
  assert.equal((await send()).ok,true);
  assert.equal(lastUrl.searchParams.has('de'),false);
});

test('MyMemory 邮箱不会发送给其他翻译服务', async () => {
  store.settings.mymemoryEmail='reader@example.com';
  let requested;
  globalThis.fetch=async url=>{requested=new URL(url);return {ok:true,json:async()=>[[['译文',requested.searchParams.get('q')]]]};};
  const engine={provider:'google-web',source:'en',target:'zh-CN'};
  const result=await new Promise(resolve=>listener({type:'CF_TRANSLATE',entries:[{id:'cf-1',text:'Other provider check.'}],engine,force:true},{id:'test',tab:{id:1}},resolve));
  assert.equal(result.ok,true);
  assert.equal(requested.hostname,'translate.googleapis.com');
  assert.equal(requested.searchParams.has('de'),false);
  assert.equal(requested.href.includes('reader'),false);
});

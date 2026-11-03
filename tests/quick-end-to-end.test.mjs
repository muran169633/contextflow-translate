import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

test('网页悬浮按钮依次翻译、清除并可再次翻译', async () => {
  let workerListener;
  let pageListener;
  let phase = 'worker';
  let quick;
  let toast;
  let resolveRendered;
  let fetchCount = 0;
  const translations = [];
  const rendered = new Promise(resolve => { resolveRendered = resolve; });
  const saved = {settings: {model: '', maxBlocks: 5, cache: false}, translationEngine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}, uiLanguage: 'zh-CN'};
  const tab = {id: 1, url: 'https://example.com/article'};
  const chrome = {
    runtime: {id: 'test', onMessage: {addListener: fn => { if (phase === 'worker') workerListener = fn; else pageListener = fn; }},
      sendMessage: message => new Promise(resolve => workerListener(message, {id: 'test', tab}, resolve))},
    storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: saved[key]}), set: async value => Object.assign(saved, value)}},
    permissions: {contains: async () => true},
    tabs: {sendMessage: async (_id, message) => await new Promise(resolve => pageListener(message, {}, resolve))}
  };
  globalThis.chrome = chrome;
  globalThis.fetch = async () => { fetchCount++; return {ok: true, json: async () => ({responseStatus: 200, responseData: {translatedText: '测试译文'}})}; };
  await import('../background.js');
  phase = 'page';
  const source = {tagName: 'P', textContent: 'A real paragraph to translate.', isConnected: true, closest: () => null,
    querySelector: () => null, getClientRects: () => [1], insertAdjacentElement(_position, node) { translations.push(node); resolveRendered(node); }};
  function element() {
    return {dataset: {}, children: [], classList: {add() {}}, isConnected: true, setAttribute() {},
      append(...nodes) { this.children.push(...nodes); }, addEventListener(_event, fn) { this.handler = fn; }, remove() { this.isConnected = false; }};
  }
  const document = {title: 'Test', querySelector: selector => selector === 'article' ? {querySelectorAll: () => [source]} : null,
    querySelectorAll: selector => selector === '.cf-translation' ? translations.filter(node => node.isConnected) : [], getElementById: () => toast, createElement: element,
    body: {appendChild(node) { if (node.className === 'cf-quick-control') quick = node; else toast = node; }}};
  vm.runInNewContext(await readFile(new URL('../content.js', import.meta.url), 'utf8'), {document, chrome, getComputedStyle: () => ({visibility: 'visible', display: 'block'})});
  pageListener({type: 'CF_QUICK_SHOW', preferences: {messages: contentMessages('zh-CN')}}, {}, () => {});
  await quick.children[0].handler({isTrusted: true});
  const result = await rendered;
  assert.equal(result.children[1].textContent, '测试译文');
  assert.equal(quick.children[0].textContent, '取消翻译');
  await quick.children[0].handler({isTrusted: true});
  assert.equal(result.isConnected, false);
  assert.equal(quick.children[0].textContent, '快捷翻译');
  await quick.children[0].handler({isTrusted: true});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(fetchCount, 2);
  assert.equal(translations.filter(node => node.isConnected).length, 1);
});

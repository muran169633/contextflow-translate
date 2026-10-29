import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

test('免费翻译逐段显示，服务失败时保留已成功译文并报告原因', async () => {
  const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  const rendered = [];
  let toast;
  let listener;
  const requests = [];
  const pending = [];
  const paragraphs = [1, 2, 3].map(number => ({
    tagName: 'P', textContent: `This is paragraph number ${number}, long enough for translation.`, isConnected: true,
    closest: () => null, querySelector: () => null, getClientRects: () => [1],
    insertAdjacentElement(_position, node) { rendered.push(node); }
  }));
  function element() {
    return {dataset: {}, classList: {add() {}}, children: [], isConnected: true,
      setAttribute() {}, append(...children) { this.children.push(...children); }, addEventListener() {}, remove() { this.isConnected = false; }};
  }
  const document = {title: 'Demo', body: {appendChild(node) { toast = node; }},
    querySelector: selector => selector === 'article' ? {querySelectorAll: () => paragraphs} : null,
    querySelectorAll: () => [], getElementById: () => toast, createElement: () => element()};
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }}, sendMessage: message => {
    requests.push(message);
    if (requests.length <= 3) return new Promise(resolve => pending.push(resolve));
    return Promise.resolve({ok: true, translations: {[message.entries[0].id]: '译文'}});
  }}};
  vm.runInNewContext(script, {document, chrome, getComputedStyle: () => ({visibility: 'visible', display: 'block'})});
  listener({type: 'CF_START', preferences: {maxBlocks: 3, messages: contentMessages('zh-CN'), engine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}}}, {}, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 3);
  pending[0]({ok: true, translations: {[requests[0].entries[0].id]: '译文'}});
  await new Promise(resolve => setImmediate(resolve));
  pending[1]({ok: false, fatal: true, error: 'quota exceeded'});
  await new Promise(resolve => setImmediate(resolve));
  pending[2]({ok: true, translations: {[requests[2].entries[0].id]: '译文'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(requests.every(request => request.entries.length === 1));
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].children[1].textContent, '译文');
  assert.match(rendered[1].children[1].textContent, /quota exceeded/);
  assert.match(toast.textContent, /quota exceeded/);
  assert.match(toast.textContent, /已完成 1 段，失败 1 段/);
  listener({type: 'CF_CONTINUE', preferences: {maxBlocks: 3, messages: contentMessages('zh-CN'), engine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}}}, {}, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 5);
  assert.equal(requests[3].entries[0].text, paragraphs[1].textContent);
  assert.equal(requests[4].entries[0].text, paragraphs[2].textContent);
  assert.equal(rendered[1].isConnected, false);
});

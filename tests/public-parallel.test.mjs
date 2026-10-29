import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
function fixture(provider = 'mymemory', source = 'en') {
  const pending = [];
  const rendered = [];
  let listener, toast, running = 0, maximum = 0;
  const paragraphs = Array.from({length: 6}, (_, index) => ({tagName: 'P', textContent: `Paragraph number ${index + 1}.`, isConnected: true,
    closest: () => null, querySelector: () => null, getClientRects: () => [1], insertAdjacentElement(_position, node) { this.translated = node; rendered.push(node); }}));
  function element() { return {dataset: {}, classList: {add() {}}, children: [], setAttribute() {}, append(...nodes) { this.children.push(...nodes); }, addEventListener() {}}; }
  const document = {title: 'Test', querySelector: selector => selector === 'article' ? {querySelectorAll: () => paragraphs} : null,
    querySelectorAll: () => [], getElementById: () => toast, createElement: element, body: {appendChild(node) { toast = node; }}};
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }}, sendMessage: message => new Promise(resolve => {
    running++;
    maximum = Math.max(maximum, running);
    pending.push({message, finish: value => { running--; resolve(value); }});
  })}};
  vm.runInNewContext(script, {document, chrome, getComputedStyle: () => ({visibility: 'visible', display: 'block'})});
  listener({type: 'CF_START', preferences: {maxBlocks: 6, messages: contentMessages('en'), engine: {provider, source, target: 'zh-CN'}}}, {}, () => {});
  return {pending, paragraphs, rendered, listener, getToast: () => toast, getMaximum: () => maximum};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const succeed = (request, text = '译文') => request.finish({ok: true, translations: {[request.message.entries[0].id]: text}});

test('无密钥服务最多三个请求并行，完成后译文仍对应原段落', async () => {
  const page = fixture('mymemory');
  await tick();
  assert.equal(page.pending.length, 3);
  succeed(page.pending[1], '第二段');
  await tick();
  assert.equal(page.paragraphs[1].translated.children[1].textContent, '第二段');
  assert.equal(page.pending.length, 4);
  succeed(page.pending[0], '第一段');
  succeed(page.pending[2], '第三段');
  await tick();
  assert.equal(page.pending.length, 6);
  for (const request of page.pending.slice(3)) succeed(request);
  await tick();
  assert.equal(page.getMaximum(), 3);
  assert.equal(page.rendered.length, 6);
  assert.match(page.getToast().textContent, /6 translated, 0 failed/);
});

test('停止后不启动后续请求，已发送的请求返回时不会插入译文', async () => {
  const page = fixture();
  await tick();
  assert.equal(page.pending.length, 3);
  page.listener({type: 'CF_STOP'}, {}, () => {});
  for (const request of page.pending) succeed(request);
  await tick();
  assert.equal(page.pending.length, 3);
  assert.equal(page.rendered.length, 0);
  assert.match(page.getToast().textContent, /Stopped/);
});

test('Google 自动源语言模式逐段并发，不把不同语种放到同一请求', async () => {
  const page = fixture('google-web', 'auto');
  await tick();
  assert.equal(page.pending.length, 3);
  assert.ok(page.pending.every(request => request.message.entries.length === 1));
  assert.ok(page.pending.every(request => request.message.engine.source === 'auto'));
  page.listener({type: 'CF_STOP'}, {}, () => {});
  for (const request of page.pending) succeed(request);
  await tick();
  assert.equal(page.pending.length, 3);
});

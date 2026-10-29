import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function page(provider, count, visibleIndexes, maxBlocks = count) {
  const pending = [];
  let listener, toast;
  const paragraphs = Array.from({length:count}, (_, i) => ({tagName:'P', textContent:`Paragraph ${i} has words.`, isConnected:true,
    getBoundingClientRect:() => visibleIndexes.includes(i) ? {top:100, bottom:120} : {top:-500, bottom:-480},
    closest:() => null, querySelector:() => null, getClientRects:() => [1], insertAdjacentElement(_position, node) {this.translated = node;}}));
  function element() { return {dataset:{}, classList:{add() {}}, children:[], setAttribute() {}, append(...items) {this.children.push(...items);}, addEventListener() {}}; }
  const document = {title:'Test', querySelector: selector => selector === 'article' ? {querySelectorAll:() => paragraphs} : null,
    querySelectorAll:() => [], getElementById:() => toast, createElement:element, body:{appendChild(node) {toast = node;}}};
  const chrome = {runtime:{onMessage:{addListener:fn => {listener = fn;}}, sendMessage:message => new Promise(resolve => pending.push({message, resolve}))}};
  vm.runInNewContext(script, {document, chrome, innerHeight:600, getComputedStyle:() => ({visibility:'visible', display:'block'})});
  let result;
  listener({type:'CF_START', preferences:{engine:{provider, source:'en', target:'zh-CN'}, maxBlocks, messages:contentMessages('en')}}, {}, value => {result=value;});
  return {pending, paragraphs, listener, result, getToast:() => toast};
}
function finish(job) {job.resolve({ok:true, translations:Object.fromEntries(job.message.entries.map(entry => [entry.id, `译文 ${entry.text}`]))});}

test('长页面段落上限优先包含屏幕内内容并立即开始翻译', async () => {
  const fixture = page('google-web', 12, [9,10], 4);
  await tick();
  assert.equal(fixture.result.truncated, true);
  assert.equal(fixture.result.found, 4);
  assert.deepEqual(fixture.pending.map(job => job.message.entries[0].text), ['Paragraph 9 has words.', 'Paragraph 10 has words.', 'Paragraph 0 has words.']);
  for (const job of fixture.pending.slice()) finish(job);
  await tick();
  finish(fixture.pending[3]);
  await tick();
  assert.match(fixture.paragraphs[9].translated.children[1].textContent, /Paragraph 9/);
  assert.match(fixture.getToast().textContent, /remaining content was not translated/);
});

test('微软批次最多两个并行，完成顺序不影响段落对应关系', async () => {
  const fixture = page('microsoft', 12, [8]);
  await tick();
  assert.equal(fixture.pending.length, 2);
  assert.equal(fixture.pending[0].message.entries.length, 5);
  assert.equal(fixture.pending[0].message.entries[0].text, 'Paragraph 8 has words.');
  finish(fixture.pending[1]);
  await tick();
  assert.equal(fixture.pending.length, 3);
  finish(fixture.pending[2]);
  finish(fixture.pending[0]);
  await tick();
  assert.match(fixture.paragraphs[8].translated.children[1].textContent, /Paragraph 8/);
  assert.match(fixture.getToast().textContent, /12 translated, 0 failed/);
});

test('停止微软翻译后不再启动剩余批次，进行中结果不写回页面', async () => {
  const fixture = page('microsoft', 12, []);
  await tick();
  fixture.listener({type:'CF_STOP'}, {}, () => {});
  for (const job of fixture.pending.slice()) finish(job);
  await tick();
  assert.equal(fixture.pending.length, 2);
  assert.equal(fixture.paragraphs.filter(item => item.translated).length, 0);
});

test('AI 仍逐批发送并优先翻译屏幕内批次，保留前后上下文', async () => {
  const fixture = page('ai', 12, [8]);
  await tick();
  assert.equal(fixture.pending.length, 1);
  assert.equal(fixture.pending[0].message.entries[0].text, 'Paragraph 5 has words.');
  assert.match(fixture.pending[0].message.context.before, /Paragraph 4/);
  finish(fixture.pending[0]);
  await tick();
  assert.equal(fixture.pending.length, 2);
  finish(fixture.pending[1]);
  await tick();
  finish(fixture.pending[2]);
  await tick();
  assert.match(fixture.getToast().textContent, /12 translated, 0 failed/);
});

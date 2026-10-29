import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
test('原文与双语切换不请求翻译，切换期间完成的译文也遵循当前模式', async () => {
  let listener, pending, toast, calls = 0;
  const rendered = [];
  const source = {tagName:'P', textContent:'This is a paragraph.', isConnected:true, closest:() => null,
    querySelector:() => null, getClientRects:() => [1], insertAdjacentElement(_where, node) {rendered.push(node);}};
  function element() {
    const classes = new Set();
    return {dataset:{}, children:[], isConnected:true, setAttribute() {}, addEventListener() {}, append(...nodes) {this.children.push(...nodes);},
      classList:{add:name => classes.add(name), toggle(name, flag) {if (flag) classes.add(name); else classes.delete(name);}, contains:name => classes.has(name)}};
  }
  const document = {title:'Test', body:{appendChild(node) {toast=node;}}, createElement:element,
    querySelector:selector => selector === 'article' ? {querySelectorAll:() => [source]} : null,
    querySelectorAll:selector => selector === '.cf-translation' ? rendered : [], getElementById:() => toast};
  const chrome = {runtime:{onMessage:{addListener:fn => {listener=fn;}}, sendMessage:() => {calls++; return new Promise(resolve => {pending=resolve;});}}};
  vm.runInNewContext(script, {document, chrome, getComputedStyle:() => ({visibility:'visible', display:'block'})});
  listener({type:'CF_START', preferences:{engine:{provider:'mymemory',source:'en',target:'zh-CN'},messages:contentMessages('zh-CN')}}, {}, () => {});
  let result;
  listener({type:'CF_SET_DISPLAY', mode:'original'}, {}, value => {result=value;});
  assert.equal(result.ok, true);
  pending({ok:true, translations:{'cf-1':'译文'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rendered[0].classList.contains('cf-hidden'), true);
  listener({type:'CF_SET_DISPLAY', mode:'bilingual'}, {}, value => {result=value;});
  assert.equal(rendered[0].classList.contains('cf-hidden'), false);
  assert.equal(calls, 1);
  listener({type:'CF_SET_DISPLAY', mode:'invalid'}, {}, value => {result=value;});
  assert.equal(result.ok, false);
  listener({type:'CF_PING'}, {}, value => {result=value;});
  assert.equal(result.displayMode, 'bilingual');
});

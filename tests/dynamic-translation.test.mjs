import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let listener, observer, toast;
  const timers = new Map(), events = new Map(), requests = [];
  let nextTimer = 0;
  const paragraphs = [];
  function paragraph(text, visible = true) {
    return {tagName:'P', nodeType:1, textContent:text, visible, isConnected:true,
      closest:() => null, querySelector:() => null, getClientRects:() => [1],
      getBoundingClientRect() {return this.visible ? {top:40, bottom:80} : {top:900, bottom:940};},
      insertAdjacentElement(_position, node) {this.translated = node;}};
  }
  const first = paragraph('First comment.');
  paragraphs.push(first);
  function element() { return {dataset:{}, classList:{add() {}}, children:[], isConnected:true, setAttribute() {},
    append(...children) {this.children.push(...children);}, addEventListener() {}, remove() {this.isConnected=false;}}; }
  const document = {title:'Discussion', querySelector:selector => selector === 'article' ? {querySelectorAll:() => paragraphs} : null,
    querySelectorAll:() => [], getElementById:() => toast, createElement:element, body:{appendChild(node) {toast=node;}}};
  const chrome = {runtime:{onMessage:{addListener:fn => {listener=fn;}}, sendMessage:message => new Promise(resolve => requests.push({message, resolve}))}};
  class Observer {
    constructor(callback) {this.callback=callback; this.connected=true; observer=this;}
    observe() {} disconnect() {this.connected=false;}
  }
  const context = {document, chrome, MutationObserver:Observer, innerHeight:600,
    getComputedStyle:() => ({visibility:'visible', display:'block'}),
    addEventListener:(type, fn) => {events.set(type, fn);}, removeEventListener:(type, fn) => {if (events.get(type) === fn) events.delete(type);},
    setTimeout:fn => {const id=++nextTimer; timers.set(id, fn); return id;}, clearTimeout:id => timers.delete(id)};
  vm.runInNewContext(script, context);
  const preferences = {engine:{provider:'mymemory', source:'en', target:'zh-CN'}, maxBlocks:3, dynamic:true, messages:contentMessages('zh-CN')};
  const start = () => listener({type:'CF_START', preferences}, {}, () => {});
  const changed = node => observer.callback([{type:'childList', target:document.body, addedNodes:[node], removedNodes:[]}]);
  const flush = () => {const jobs=[...timers.values()]; timers.clear(); for (const job of jobs) job();};
  const finish = (request, result) => request.resolve(result || {ok:true, translations:{[request.message.entries[0].id]:`译文 ${request.message.entries[0].text}`}});
  return {start, first, paragraph, paragraphs, requests, events, changed, flush, finish, listener, getObserver:()=>observer, getToast:()=>toast, timers};
}

test('展开回复和加载屏幕外内容后自动翻译，不重复翻译已处理段落', async () => {
  const f=fixture(); f.start();
  f.finish(f.requests[0]); await tick();
  const reply=f.paragraph('Expanded reply.'); f.paragraphs.push(reply); f.changed(reply); f.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].message.entries[0].text, 'Expanded reply.');
  f.finish(f.requests[1]); await tick();
  assert.match(reply.translated.children[1].textContent, /Expanded reply/);
  f.changed(reply); f.flush();
  assert.equal(f.requests.length, 2);
  const below=f.paragraph('Scrolled comment.', false); f.paragraphs.push(below); f.changed(below); f.flush();
  assert.equal(f.requests.length, 3);
  f.finish(f.requests[2]); await tick();
  assert.match(below.translated.children[1].textContent, /Scrolled comment/);
  below.visible=true; f.events.get('scroll')(); f.flush();
  assert.equal(f.requests.length, 3);
});

test('请求期间原文变化时丢弃旧结果并重新翻译', async () => {
  const f=fixture(); f.start();
  f.first.textContent='Updated comment.'; f.changed(f.first);
  f.finish(f.requests[0]); await tick();
  assert.equal(f.first.translated, undefined);
  f.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].message.entries[0].text, 'Updated comment.');
  f.finish(f.requests[1]); await tick();
  assert.match(f.first.translated.children[1].textContent, /Updated comment/);
});

test('停止和清除断开观察，不再发送新请求或展示在途结果', async () => {
  for (const action of ['CF_STOP', 'CF_CLEAR']) {
    const f=fixture(); f.start();
    const observer=f.getObserver();
    f.listener({type:action}, {}, () => {});
    assert.equal(observer.connected, false);
    assert.equal(f.events.has('scroll'), false);
    f.finish(f.requests[0]); await tick();
    f.flush();
    assert.equal(f.requests.length, 1);
    assert.equal(f.first.translated, undefined);
  }
});

test('服务失败后停止自动翻译，避免反复消耗额度', async () => {
  const f=fixture(); f.start();
  f.finish(f.requests[0], {ok:false, fatal:true, error:'quota exceeded'}); await tick();
  assert.equal(f.getObserver().connected, false);
  assert.equal(f.events.has('scroll'), false);
  assert.match(f.getToast().textContent, /quota exceeded/);
});

test('已翻译评论修改后替换旧译文，插件自身插入不会触发重复请求', async () => {
  const f=fixture(); f.start(); f.finish(f.requests[0]); await tick();
  const old=f.first.translated;
  const own={nodeType:1, closest:() => ({})};
  f.getObserver().callback([{type:'childList', target:{nodeType:1, closest:() => null}, addedNodes:[own], removedNodes:[]}]);
  assert.equal(f.timers.size, 0);
  f.first.textContent='Edited reply.'; f.changed(f.first); f.flush();
  assert.equal(old.isConnected, false);
  assert.equal(f.requests.length, 2);
  f.finish(f.requests[1]); await tick();
  assert.match(f.first.translated.children[1].textContent, /Edited reply/);
});

test('未启用动态功能时不会注册观察器或发送后续请求', async () => {
  const f=fixture();
  f.listener({type:'CF_START', preferences:{engine:{provider:'mymemory',source:'en',target:'zh-CN'},maxBlocks:3,dynamic:false,messages:contentMessages('en')}}, {}, () => {});
  f.finish(f.requests[0]); await tick();
  assert.equal(f.getObserver(), undefined);
  assert.equal(f.events.has('scroll'), false);
  assert.equal(f.requests.length, 1);
});

test('回复仅通过属性变更展开时也能自动翻译', async () => {
  const f=fixture();
  const reply=f.paragraph('Reply revealed by expanding.');
  let expanded=false;
  reply.getClientRects=() => expanded ? [1] : [];
  f.paragraphs.push(reply); f.start();
  f.finish(f.requests[0]); await tick();
  expanded=true;
  f.getObserver().callback([{type:'attributes', target:reply}]);
  f.flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].message.entries[0].text, reply.textContent);
  f.finish(f.requests[1]); await tick();
  assert.match(reply.translated.children[1].textContent, /Reply revealed/);
});

test('屏幕内内容超过单批上限时继续处理后续批次', async () => {
  const f=fixture();
  f.paragraphs.push(f.paragraph('Second comment.'), f.paragraph('Third comment.'));
  f.listener({type:'CF_START', preferences:{engine:{provider:'mymemory',source:'en',target:'zh-CN'},maxBlocks:1,dynamic:true,messages:contentMessages('en')}}, {}, () => {});
  f.finish(f.requests[0]); await tick(); f.flush();
  assert.equal(f.requests.length, 2);
  f.finish(f.requests[1]); await tick(); f.flush();
  assert.equal(f.requests.length, 3);
  f.finish(f.requests[2]); await tick(); f.flush();
  assert.equal(f.requests.length, 3);
});

test('自动处理后台批次时点击停止，不再启动后续批次', async () => {
  const f=fixture();
  f.paragraphs.push(f.paragraph('Second comment.',false),f.paragraph('Third comment.',false));
  f.listener({type:'CF_START',preferences:{engine:{provider:'mymemory',source:'en',target:'zh-CN'},maxBlocks:1,dynamic:true,messages:contentMessages('en')}},{},()=>{});
  f.finish(f.requests[0]); await tick();
  assert.equal(f.requests.length,2);
  f.listener({type:'CF_STOP'},{},()=>{});
  f.finish(f.requests[1]); await tick(); f.flush();
  assert.equal(f.requests.length,2);
  assert.equal(f.paragraphs[2].translated,undefined);
});

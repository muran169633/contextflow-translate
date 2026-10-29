import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

test('悬浮按钮只在点击时请求翻译，可以关闭并显示错误', async () => {
  const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  const appended = [];
  let listener;
  let sent = 0;
  let finishRequest;
  function element() {
    return {dataset: {}, children: [], isConnected: true, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
      append(...nodes) { this.children.push(...nodes); }, remove() { this.isConnected = false; }, addEventListener(_type, fn) { this.handler = fn; }};
  }
  const document = {body: {appendChild(node) { appended.push(node); }}, getElementById: id => appended.find(node => node.id === id) || null, createElement: element};
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }}, sendMessage: message => { sent++; assert.equal(message.type, 'CF_QUICK_START'); return new Promise(resolve => { finishRequest = resolve; }); }}};
  vm.runInNewContext(script, {document, chrome});
  let response;
  listener({type: 'CF_QUICK_SHOW', preferences: {messages: contentMessages('zh-CN')}}, {}, result => { response = result; });
  assert.equal(response.ok, true);
  assert.equal(sent, 0);
  const control = appended[0];
  assert.equal(control.children[0].textContent, '快捷翻译');
  listener({type: 'CF_QUICK_SHOW', preferences: {messages: contentMessages('zh-CN')}}, {}, () => {});
  assert.equal(appended.length, 1);
  await control.children[0].handler({isTrusted: false});
  assert.equal(sent, 0);
  const pending = control.children[0].handler({isTrusted: true});
  assert.equal(sent, 1);
  assert.equal(appended[1].textContent, '正在启动翻译…');
  finishRequest({ok: false, error: '授权失败'});
  await pending;
  assert.equal(appended[1].textContent, '授权失败');
  control.children[1].handler();
  assert.equal(control.isConnected, false);
});

test('拖动及键盘移动悬浮按钮，限制在视口并避免误触翻译', async () => {
  const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  const controls = [];
  let listener, resize, sent = 0;
  const viewport = {innerWidth: 400, innerHeight: 300, addEventListener: (type, fn) => { if (type === 'resize') resize = fn; }};
  function element() {
    const listeners = {};
    const properties = {};
    return {dataset: {}, children: [], isConnected: true, style: {setProperty: (key, value) => { properties[key] = value; }},
      setAttribute() {}, append(...nodes) { this.children.push(...nodes); }, remove() { this.isConnected = false; },
      getBoundingClientRect() { return {left: parseFloat(properties.left ?? '16'), top: parseFloat(properties.top ?? '240'), width: 120, height: 40}; },
      setPointerCapture(id) { this.captured = id; }, addEventListener(type, fn) { listeners[type] = fn; }, listeners, properties};
  }
  const document = {body: {appendChild(node) { controls.push(node); }}, getElementById: () => null, createElement: element};
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }}, sendMessage: async () => { sent++; return {ok: true}; }}};
  const context = {...viewport, document, chrome};
  vm.runInNewContext(script, context);
  const show = () => listener({type:'CF_QUICK_SHOW', preferences:{messages: contentMessages('zh-CN')}}, {}, () => {});
  const event = (x, y, extra = {}) => ({button:0, pointerId:1, clientX:x, clientY:y, preventDefault() {}, stopPropagation() {}, ...extra});
  show();
  let control = controls[0];
  let drag = control.children[0];
  assert.match(drag.attributes?.title || drag.title, /拖动/);
  drag.listeners.pointerdown(event(20, 250));
  assert.equal(drag.captured, 1);
  drag.listeners.pointermove(event(1000, 1000));
  assert.equal(control.properties.left, '280px');
  assert.equal(control.properties.top, '260px');
  drag.listeners.pointerup(event(1000, 1000, {type:'pointerup'}));
  await drag.listeners.click(event(1000, 1000, {isTrusted:true, detail:1}));
  assert.equal(sent, 0);
  drag.listeners.keydown(event(0, 0, {key:'ArrowLeft', shiftKey:true}));
  assert.equal(control.properties.left, '230px');
  control.children[1].listeners.click();
  show();
  control = controls[1];
  assert.equal(control.properties.left, '230px');
  assert.equal(control.properties.top, '260px');
  // 模拟视口变窄后，按钮仍保留在可见范围内。
  context.innerWidth = 200;
  resize();
  assert.equal(control.properties.left, '80px');
  drag = control.children[0];
  drag.listeners.pointerdown(event(240, 270));
  drag.listeners.pointermove(event(-100, -100));
  drag.listeners.pointercancel(event(-100, -100));
  assert.equal(control.properties.left, '0px');
  assert.equal(control.properties.top, '0px');
  drag.listeners.pointerdown(event(20, 20));
  drag.listeners.pointermove(event(26, 26));
  drag.listeners.pointerup(event(26, 26, {type:'pointerup'}));
  await drag.listeners.click(event(26, 26, {isTrusted:true, detail:1}));
  assert.equal(sent, 1);
});

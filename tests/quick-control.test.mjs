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
  function element() {
    return {dataset: {}, children: [], isConnected: true, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
      append(...nodes) { this.children.push(...nodes); }, remove() { this.isConnected = false; }, addEventListener(_type, fn) { this.handler = fn; }};
  }
  const document = {body: {appendChild(node) { appended.push(node); }}, getElementById: () => null, createElement: element};
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }}, sendMessage: async message => { sent++; assert.equal(message.type, 'CF_QUICK_START'); return {ok: false, error: '授权失败'}; }}};
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
  await control.children[0].handler({isTrusted: true});
  assert.equal(sent, 1);
  assert.equal(appended[1].textContent, '授权失败');
  control.children[1].handler();
  assert.equal(control.isConnected, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

test('网页翻译流程使用所选语言显示进度和重试按钮', async () => {
  const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
  const nodes = [];
  let toast;
  const paragraph = {
    tagName: 'P', textContent: 'This paragraph is long enough to translate.', isConnected: true,
    closest: () => null, querySelector: () => null, getClientRects: () => [1],
    insertAdjacentElement(_position, element) { nodes.push(element); }
  };
  function element() {
    return {dataset: {}, classList: {add() {}}, children: [], setAttribute() {},
      append(...children) { this.children.push(...children); }, addEventListener() {}};
  }
  let listener;
  const document = {
    title: 'Demo', body: {appendChild(node) { toast = node; }},
    querySelector: selector => selector === 'article' ? {querySelectorAll: () => [paragraph]} : null,
    querySelectorAll: () => [], getElementById: () => toast,
    createElement: () => element()
  };
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }},
    sendMessage: async message => ({ok: true, translations: {[message.entries[0].id]: '译文'}})}};
  vm.runInNewContext(source, {document, chrome, getComputedStyle: () => ({visibility: 'visible', display: 'block'})});
  let response;
  listener({type: 'CF_START', preferences: {maxBlocks: 1, messages: contentMessages('ja')}}, {}, value => { response = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response.started, true);
  assert.ok(nodes[0], `未插入译文：${toast?.textContent}`);
  assert.equal(nodes[0].children[0].children[0].textContent, 'AI 翻訳');
  assert.equal(nodes[0].children[0].children[1].textContent, '再試行');
  assert.match(toast.textContent, /完了/);
});

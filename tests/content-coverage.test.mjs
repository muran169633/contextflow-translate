import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {contentMessages} from '../i18n.mjs';

const script = await readFile(new URL('../content.js', import.meta.url), 'utf8');

function makePage(texts, reply = message => ({ok: true, translations: Object.fromEntries(message.entries.map(entry => [entry.id, entry.text]))})) {
  const rendered = [];
  const requests = [];
  let toast;
  let listener;
  const paragraph = text => ({tagName: 'P', textContent: text, isConnected: true,
    closest: () => null, querySelector: () => null, getClientRects: () => [1],
    insertAdjacentElement(_position, node) { this.translated = node; rendered.push(node); }});
  const paragraphs = texts.map(paragraph);
  const article = {querySelectorAll: () => [paragraphs[0]]};
  const main = {contains: value => value === article, querySelectorAll: selector => selector === 'article' ? [{}, {}] : paragraphs};
  const document = {title: 'Forum', body: {appendChild(node) { toast = node; }},
    querySelector: selector => selector === 'article' ? article : selector === 'main' ? main : null,
    querySelectorAll: () => [], getElementById: () => toast,
    createElement: () => ({dataset: {}, classList: {add() {}}, children: [], setAttribute() {}, append(...children) { this.children.push(...children); }, addEventListener() {}})};
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }}, sendMessage: async message => {
    requests.push(message);
    return reply(message);
  }}};
  vm.runInNewContext(script, {document, chrome, getComputedStyle: () => ({visibility: 'visible', display: 'block'})});
  return {listener, requests, rendered, paragraphs, addParagraph: text => paragraphs.push(paragraph(text)), getToast: () => toast};
}

test('多文章页面的短评论和长段落都进入翻译，长段按协议分段后合并', async () => {
  const longText = ('Alpha bravo charlie delta '.repeat(110)).trim();
  const page = makePage(['Yes!', longText, 'Another reply.']);
  let result;
  page.listener({type: 'CF_START', preferences: {maxBlocks: 3, messages: contentMessages('en'), engine: {provider: 'mymemory', source: 'en', target: 'fr'}}}, {}, value => { result = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.found, 3);
  assert.equal(result.truncated, false);
  assert.equal(page.rendered.length, 3);
  assert.equal(page.paragraphs[0].translated.children[1].textContent, 'Yes!');
  assert.equal(page.paragraphs[1].translated.children[1].textContent, longText);
  assert.equal(page.paragraphs[2].translated.children[1].textContent, 'Another reply.');
  assert.ok(page.requests.length >= 4);
  assert.ok(page.requests.every(request => request.entries.every(entry => entry.text.length <= 1600)));
});

test('缺失译文的响应显示失败而不是错误标记成功', async () => {
  const page = makePage(['Some meaningful text.'], () => ({ok: true, translations: {}}));
  page.listener({type: 'CF_START', preferences: {maxBlocks: 1, messages: contentMessages('en'), engine: {provider: 'mymemory', source: 'en', target: 'fr'}}}, {}, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.match(page.rendered[0].children[1].textContent, /incomplete/);
  assert.match(page.getToast().textContent, /0 translated, 1 failed/);
});

test('展开或加载新评论后只翻译新增段落，保留已有译文', async () => {
  const page = makePage(['Original discussion.']);
  const preferences = {maxBlocks: 10, messages: contentMessages('en'), engine: {provider: 'mymemory', source: 'en', target: 'fr'}};
  page.listener({type: 'CF_START', preferences}, {}, () => {});
  await new Promise(resolve => setImmediate(resolve));
  page.addParagraph('Newly expanded reply.');
  page.listener({type: 'CF_CONTINUE', preferences}, {}, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.length, 2);
  assert.equal(page.requests[0].entries[0].text, 'Original discussion.');
  assert.equal(page.requests[1].entries[0].text, 'Newly expanded reply.');
  assert.equal(page.rendered.length, 2);
});

test('达到段落上限时明确提示还有内容未翻译', async () => {
  const page = makePage(['First paragraph.', 'Second paragraph.']);
  let result;
  page.listener({type: 'CF_START', preferences: {maxBlocks: 1, messages: contentMessages('zh-CN'), engine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}}}, {}, value => { result = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.found, 1);
  assert.equal(result.truncated, true);
  assert.match(page.getToast().textContent, /其余内容未翻译/);
  page.listener({type: 'CF_CONTINUE', preferences: {maxBlocks: 1, messages: contentMessages('zh-CN'), engine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}}}, {}, value => { result = value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.started, true);
  assert.equal(result.found, 1);
  assert.equal(page.requests.length, 2);
  assert.equal(page.requests[1].entries[0].text, 'Second paragraph.');
  assert.equal(page.rendered.length, 2);
  page.listener({type: 'CF_CONTINUE', preferences: {maxBlocks: 1, messages: contentMessages('zh-CN'), engine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}}}, {}, value => { result = value; });
  assert.equal(result.started, false);
  assert.match(page.getToast().textContent, /没有发现新增或未完成/);
});

test('列表项中的旧翻译或错误提示不会混入再次翻译的原文', async () => {
  let listener;
  let request;
  let toast;
  const source = {tagName: 'LI', textContent: 'Original list item.旧错误', isConnected: true,
    closest: () => null, getClientRects: () => [1],
    querySelector: selector => selector === '.cf-translation' ? {} : null,
    cloneNode: () => {
      const copy = {textContent: 'Original list item.旧错误'};
      copy.querySelectorAll = () => [{remove() { copy.textContent = 'Original list item.'; }}];
      return copy;
    }, appendChild() {}};
  const doc = {title: 'List', querySelector: selector => selector === 'article' ? {querySelectorAll: () => [source]} : null,
    querySelectorAll: () => [], getElementById: () => toast, body: {appendChild(node) { toast = node; }},
    createElement: () => ({dataset: {}, classList: {add() {}}, setAttribute() {}, append() {}, addEventListener() {}})};
  const chrome = {runtime: {onMessage: {addListener: fn => { listener = fn; }}, sendMessage: async message => {
    request = message;
    return {ok: true, translations: {[message.entries[0].id]: '译文'}};
  }}};
  vm.runInNewContext(script, {document: doc, chrome, getComputedStyle: () => ({visibility: 'visible', display: 'block'})});
  listener({type: 'CF_CONTINUE', preferences: {maxBlocks: 1, messages: contentMessages('en'), engine: {provider: 'mymemory', source: 'en', target: 'zh-CN'}}}, {}, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(request.entries[0].text, 'Original list item.');
});

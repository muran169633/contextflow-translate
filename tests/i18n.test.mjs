import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyTranslations, contentMessages, localizeError, resolveLanguage, supportedLanguages, translate, translationKeys} from '../i18n.mjs';
import {setupLanguage} from '../ui-language.mjs';

test('所有界面与网页提示键均有四种语言的文案', async () => {
  const markup = (await Promise.all(['popup.html', 'options.html'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n');
  const keys = [...markup.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map(match => match[1]);
  keys.push(...Object.keys(contentMessages('en')), 'copied', 'incomplete', 'kaggleHttp', 'structuredWarning', 'unsupported', 'saved', 'connected');
  for (const language of supportedLanguages) {
    assert.deepEqual(translationKeys(language).sort(), translationKeys('en').sort(), `${language}: translation keys`);
    for (const key of keys) assert.notEqual(translate(language, key), key, `${language}: ${key}`);
  }
  assert.equal(resolveLanguage('zh-TW'), 'zh-CN');
  assert.equal(resolveLanguage('es-MX'), 'es');
  assert.equal(resolveLanguage('pt-BR'), 'en');
  assert.match(translate('ja', 'copied', {count: 4}), /4/);
  assert.equal(localizeError('zh-CN', new Error('Invalid API base URL.')), 'API 基础地址无效。');
  assert.equal(localizeError('ja', new Error('provider failure')), 'provider failure');
});

test('切换语言会独立保存并在重新打开时恢复，不改动翻译设置', async () => {
  const saved = {settings: {target: 'French', model: 'demo'}};
  let listener;
  const select = {value: '', addEventListener(_name, fn) { listener = fn; }};
  const label = {dataset: {i18n: 'copy'}, textContent: ''};
  const placeholder = {dataset: {i18nPlaceholder: 'modelPlaceholder'}, placeholder: ''};
  globalThis.document = {
    documentElement: {}, getElementById: id => id === 'uiLanguage' ? select : {},
    querySelectorAll: selector => selector === '[data-i18n]' ? [label] : [placeholder]
  };
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {language: 'zh-CN'}});
  globalThis.chrome = {storage: {local: {
    get: async key => ({[key]: saved[key]}),
    set: async data => Object.assign(saved, data)
  }}};
  try {
    const seen = [];
    const current = await setupLanguage(language => seen.push(language));
    assert.equal(current(), 'zh-CN');
    assert.equal(label.textContent, '复制讨论');
    select.value = 'ja';
    await listener();
    assert.equal(saved.uiLanguage, 'ja');
    assert.deepEqual(saved.settings, {target: 'French', model: 'demo'});
    assert.equal(label.textContent, 'ディスカッションをコピー');
    assert.equal(document.documentElement.lang, 'ja');
    assert.equal(placeholder.placeholder, 'モデル名');
    assert.equal((await setupLanguage())(), current());
    assert.deepEqual(seen, ['zh-CN', 'ja']);
    applyTranslations(document, 'es');
    assert.equal(label.textContent, 'Copiar debate');
  } finally {
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.chrome;
  }
});

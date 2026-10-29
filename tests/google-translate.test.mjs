import test from 'node:test';
import assert from 'node:assert/strict';
import {translateGoogle} from '../google-translate.mjs';

test('Google 标准翻译使用独立密钥和选定语言，按顺序返回段落', async () => {
  let requested;
  const items = [{id: 'cf-1', text: 'One'}, {id: 'cf-2', text: 'Two'}];
  const result = await translateGoogle(items, {source: 'en', target: 'zh-CN'}, 'google-secret', async (url, init) => {
    requested = {url, init};
    return {ok: true, json: async () => ({data: {translations: [{translatedText: '第一 &amp; 段'}, {translatedText: '第二段'}]}})};
  });
  assert.equal(requested.url, 'https://translation.googleapis.com/language/translate/v2');
  assert.equal(requested.init.headers['x-goog-api-key'], 'google-secret');
  assert.ok(!requested.url.includes('google-secret'));
  assert.deepEqual(JSON.parse(requested.init.body), {q: ['One', 'Two'], source: 'en', target: 'zh-CN', format: 'text'});
  assert.deepEqual(result, {'cf-1': '第一 & 段', 'cf-2': '第二段'});
});

test('Google 标准翻译在密钥缺失、HTTP 错误或响应不完整时明确失败', async () => {
  const entries = [{id: 'cf-1', text: 'One'}];
  const engine = {source: 'en', target: 'zh-CN'};
  await assert.rejects(translateGoogle(entries, engine, ''), /API key/);
  await assert.rejects(translateGoogle(entries, engine, 'key', async () => ({ok: false, status: 403, json: async () => ({error: {message: 'permission denied'}})})), /403.*permission denied/);
  await assert.rejects(translateGoogle(entries, engine, 'key', async () => ({ok: true, json: async () => ({data: {translations: []}})})), /incomplete/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {translateGoogleWeb} from '../google-web-translate.mjs';

test('免密钥 Google 网页接口发送选定语种并合并返回的句子', async () => {
  let requested;
  const result = await translateGoogleWeb([{id: 'cf-1', text: 'Hello. How are you?'}], {source: 'en', target: 'zh-CN'}, async url => {
    requested = new URL(url);
    return {ok: true, json: async () => [[['你好。', 'Hello.'], ['你好吗？', 'How are you?']]]};
  });
  assert.equal(requested.origin, 'https://translate.googleapis.com');
  assert.equal(requested.searchParams.get('sl'), 'en');
  assert.equal(requested.searchParams.get('tl'), 'zh-CN');
  assert.equal(requested.searchParams.get('q'), 'Hello. How are you?');
  assert.equal(result['cf-1'], '你好。你好吗？');
});

test('免密钥接口被限流或返回异常时明确失败，不切换其他服务', async () => {
  const entries = [{id: 'cf-1', text: 'Hello.'}];
  const engine = {source: 'en', target: 'zh-CN'};
  await assert.rejects(translateGoogleWeb(entries, engine, async () => ({ok: false, status: 429})), /429.*rate-limited/);
  await assert.rejects(translateGoogleWeb(entries, engine, async () => ({ok: true, json: async () => [null]})), /incomplete/);
  await assert.rejects(translateGoogleWeb(entries, engine, async () => { throw new Error('network unavailable'); }), /connection failed.*network unavailable/);
});

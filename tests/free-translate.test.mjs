import test from 'node:test';
import assert from 'node:assert/strict';
import {LANGUAGE_CODES, normalizeEngine, splitSegments, translateFree} from '../free-translate.mjs';

test('免费服务按 UTF-8 字节分段并逐段翻译单个段落', async () => {
  const text = ('This is a sentence about machine learning. 你好！ '.repeat(40)).trim();
  const segments = splitSegments(text);
  assert.equal(segments.join(''), text);
  assert.ok(segments.length > 1);
  for (const segment of segments) assert.ok(new TextEncoder().encode(segment).length <= 500);
  const requests = [];
  const result = await translateFree([{id: 'cf-1', text}], {source: 'en', target: 'zh-CN'}, async url => {
    requests.push(new URL(url));
    return {ok: true, json: async () => ({responseStatus: 200, responseData: {translatedText: '译文 &amp; 结果'}})};
  });
  assert.equal(requests.length, segments.length);
  assert.ok(requests.every(url => url.searchParams.get('langpair') === 'en|zh-CN'));
  assert.ok(requests.every(url => !url.searchParams.has('de')));
  assert.equal(result['cf-1'], '译文 & 结果'.repeat(segments.length));
  assert.equal(new Set(LANGUAGE_CODES).size, LANGUAGE_CODES.length);
  assert.equal(normalizeEngine(undefined, true).provider, 'ai');
  assert.equal(normalizeEngine(undefined, false).provider, 'mymemory');
});

test('可选 MyMemory 邮箱只在明确配置时随请求发送，错误邮箱不发请求', async () => {
  const entries=[{id:'cf-1',text:'A short paragraph.'}];
  const engine={source:'en',target:'zh-CN'};
  let request;
  const fetcher=async url=>{request=new URL(url);return {ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:'译文'}})};};
  await translateFree(entries,engine,fetcher,{email:' person@example.com '});
  assert.equal(request.searchParams.get('de'),'person@example.com');
  request=undefined;
  await assert.rejects(translateFree(entries,engine,fetcher,{email:'bad-address'}),/Invalid MyMemory email/);
  assert.equal(request,undefined);
});

test('免费服务配额耗尽和源目标语言相同时返回错误', async () => {
  await assert.rejects(translateFree([{id: 'cf-1', text: 'hello'}], {source: 'en', target: 'en'}), /different/);
  await assert.rejects(translateFree([{id: 'cf-1', text: 'hello'}], {source: 'en', target: 'ja'}, async () => ({ok: true, json: async () => ({quotaFinished: true, responseStatus: 429})})), /quota/);
});

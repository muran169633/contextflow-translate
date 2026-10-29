import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {translateYoudao, youdaoSignatureInput} from '../youdao-translate.mjs';

const engine = {source: 'en', target: 'zh-CN'};
test('有道签名、语言代码和表单符合官方 API 协议', async () => {
  const text = 'A sufficiently long example for signature.';
  let request;
  const result = await translateYoudao([{id: 'x', text}], engine, 'app-id', 'secret', async (url, init) => {
    request = {url, ...init};
    return {ok: true, json: async () => ({errorCode: '0', translation: ['译文。']})};
  });
  assert.equal(request.url, 'https://openapi.youdao.com/api');
  assert.equal(request.method, 'POST');
  assert.equal(request.body.get('from'), 'en');
  assert.equal(request.body.get('to'), 'zh-CHS');
  assert.equal(request.body.get('q'), text);
  assert.equal(request.body.get('signType'), 'v3');
  assert.equal(request.body.has('appSecret'), false);
  const input = text.slice(0, 10) + text.length + text.slice(-10);
  const expected = createHash('sha256').update('app-id' + input + request.body.get('salt') + request.body.get('curtime') + 'secret').digest('hex');
  assert.equal(request.body.get('sign'), expected);
  assert.equal(result.x, '译文。');
  assert.equal(youdaoSignatureInput('短文本'), '短文本');
});

test('长段落分段、繁体代码转换及失败处理', async () => {
  let count = 0;
  const result = await translateYoudao([{id: 'x', text: 'a'.repeat(4100)}], {source: 'zh-TW', target: 'en'}, 'id', 'secret', async (_url, init) => {
    count++;
    assert.equal(init.body.get('from'), 'zh-CHT');
    assert.ok(init.body.get('q').length <= 4000);
    return {ok: true, json: async () => ({errorCode: '0', translation: ['translated']})};
  });
  assert.equal(count, 2);
  assert.equal(result.x, 'translated translated');
  await assert.rejects(translateYoudao([{id:'x', text:'hello'}], engine, '', '', async () => { throw Error('should not call'); }), /application ID/);
  await assert.rejects(translateYoudao([{id:'x', text:'hello'}], engine, 'id', 'secret', async () => ({ok:true, json:async () => ({errorCode:'202'})})), /Youdao error 202/);
  await assert.rejects(translateYoudao([{id:'x', text:'hello'}], engine, 'id', 'secret', async () => ({ok:true, json:async () => ({errorCode:'0', translation:[]})})), /empty or incomplete/);
});

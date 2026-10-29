import test from 'node:test';
import assert from 'node:assert/strict';
import {translateMicrosoft} from '../microsoft-translate.mjs';

const entries = [{id:'a', text:'Hello.'}, {id:'b', text:'How are you?'}];
const engine = {source:'en', target:'zh-CN'};
test('微软翻译使用正确地区密钥、简繁语言代码及批量段落', async () => {
  let request;
  const result = await translateMicrosoft(entries, engine, 'key', 'eastus', async (url, init) => {
    request = {url:new URL(url), ...init};
    return {ok:true, json:async () => [{translations:[{text:'你好。'}]}, {translations:[{text:'你好吗？'}]}]};
  });
  assert.equal(request.url.origin, 'https://api.cognitive.microsofttranslator.com');
  assert.equal(request.url.searchParams.get('api-version'), '3.0');
  assert.equal(request.url.searchParams.get('from'), 'en');
  assert.equal(request.url.searchParams.get('to'), 'zh-Hans');
  assert.equal(request.headers['Ocp-Apim-Subscription-Key'], 'key');
  assert.equal(request.headers['Ocp-Apim-Subscription-Region'], 'eastus');
  assert.deepEqual(JSON.parse(request.body), [{Text:'Hello.'}, {Text:'How are you?'}]);
  assert.deepEqual(result, {a:'你好。', b:'你好吗？'});
  await translateMicrosoft(entries, {source:'zh-TW', target:'en'}, 'key', '', async (url, init) => {
    assert.equal(new URL(url).searchParams.get('from'), 'zh-Hant');
    assert.equal(init.headers['Ocp-Apim-Subscription-Region'], undefined);
    return {ok:true, json:async () => [{translations:[{text:'a'}]}, {translations:[{text:'b'}]}]};
  });
});
test('微软翻译对密钥缺失、错误和不完整结果明确失败', async () => {
  await assert.rejects(translateMicrosoft(entries, engine, '', '', async () => {throw Error('unexpected');}), /key/);
  await assert.rejects(translateMicrosoft(entries, engine, 'key', '', async () => ({ok:false, status:401, json:async () => ({error:{code:401000}})})), /401.*401000/);
  await assert.rejects(translateMicrosoft(entries, engine, 'key', '', async () => ({ok:true, json:async () => [{translations:[]}]})), /incomplete/);
});

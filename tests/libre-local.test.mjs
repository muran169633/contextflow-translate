import test from 'node:test';
import assert from 'node:assert/strict';
import {translateLibreLocal} from '../libre-local.mjs';
import {normalizeEngine} from '../free-translate.mjs';

const engine = {provider:'libre-local', source:'auto', target:'zh-CN'};

test('本机免费翻译使用本地地址、自动识别和中文语种代码', async () => {
  let requested;
  const result = await translateLibreLocal([{id:'cf-1',text:'Hello world.'}], engine, async (url, options) => {
    requested = {url, options};
    return {ok:true, json:async()=>({translatedText:'你好，世界。'})};
  });
  assert.equal(requested.url, 'http://127.0.0.1:5000/translate');
  assert.deepEqual(JSON.parse(requested.options.body), {q:'Hello world.',source:'auto',target:'zh',format:'text'});
  assert.equal(result['cf-1'], '你好，世界。');
  assert.equal(normalizeEngine(engine).provider, 'libre-local');
});

test('本机服务不可用、模型缺失或繁体中文时报告原因', async () => {
  const entries=[{id:'cf-1',text:'Hello.'}];
  await assert.rejects(translateLibreLocal(entries,engine,async()=>{throw new Error('network error');}), /local server is unavailable/);
  await assert.rejects(translateLibreLocal(entries,engine,async()=>({ok:false,status:400,json:async()=>({error:'language not supported'})})), /language not supported/);
  await assert.rejects(translateLibreLocal(entries,{...engine,target:'zh-TW'},async()=>{}), /Traditional Chinese/);
});

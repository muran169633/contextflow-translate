import test from 'node:test';
import assert from 'node:assert/strict';
let listener;
const settings = {aiProvider: 'gemini', endpoint: 'https://old.example/v1', model: 'sample-model', apiKey: 'gemini-key', source: 'auto', target: 'Chinese', style: 'faithful', cache: true, review: false};
const data = {settings, translationEngine: {provider: 'ai'}};
const requests = [];
globalThis.chrome = {
  runtime: {id: 'test', onMessage: {addListener: fn => { listener = fn; }}},
  permissions: {contains: async ({origins}) => ['https://generativelanguage.googleapis.com/*', 'https://api.anthropic.com/*'].includes(origins[0])},
  storage: {local: {setAccessLevel: async () => {}, get: async key => ({[key]: data[key]}), set: async value => Object.assign(data, value)}}
};
globalThis.fetch = async (url, options) => {
  requests.push({url, options});
  const translation = JSON.stringify({translations: [{id: 'cf-1', text: '译文'}]});
  const body = url.includes('googleapis.com') ? {candidates: [{finishReason: 'STOP', content: {parts: [{text: translation}]}}]} : {stop_reason: 'end_turn', content: [{type: 'text', text: translation}]};
  return {ok: true, status: 200, text: async () => JSON.stringify(body)};
};
await import('../background.js');
const run = () => new Promise(resolve => listener({type: 'CF_TRANSLATE', entries: [{id: 'cf-1', text: 'This is a test.'}], context: {}}, {id: 'test', tab: {id: 1}}, resolve));

test('原生 Gemini 和 Claude 经后台翻译，缓存按服务隔离', async () => {
  assert.equal((await run()).translations['cf-1'], '译文');
  assert.equal((await run()).cacheHit, true);
  settings.aiProvider = 'anthropic';
  settings.apiKey = 'claude-key';
  const result = await run();
  assert.equal(result.translations['cf-1'], '译文');
  assert.equal(result.cacheHit, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['x-goog-api-key'], 'gemini-key');
  assert.equal(requests[1].options.headers['x-api-key'], 'claude-key');
});

import test from "node:test";
import assert from "node:assert/strict";

let listener;
const values = {
  settings: {
    endpoint: "https://api.example.test/v1", model: "demo-model", apiKey: "demo-secret",
    source: "English", target: "Simplified Chinese", style: "faithful",
    glossary: "evidence => EVIDENCE", review: false, cache: true
  }
};
let callCount = 0;
const prompts = [];
globalThis.chrome = {
  runtime: {id: "testing-extension", onMessage: {addListener: fn => {listener = fn;}}},
  permissions: {contains: async ({origins}) => origins[0] === "https://api.example.test/*"},
  storage: {local: {
    setAccessLevel: async () => {},
    get: async keys => {
      if (typeof keys === "string") return {[keys]: values[keys]};
      return Object.fromEntries(keys.map(key => [key, values[key]]));
    },
    set: async payload => Object.assign(values, payload)
  }}
};
globalThis.fetch = async (_url, init) => {
  callCount++;
  assert.equal(init.headers.Authorization, "Bearer demo-secret");
  prompts.push(JSON.parse(init.body));
  const paragraphs = JSON.parse(prompts.at(-1).messages[1].content).items_to_translate;
  return {ok: true, status: 200, text: async () => JSON.stringify({
    choices: [{message:{content: JSON.stringify({translations: paragraphs.map(item => ({id:item.id,text:"TRANSLATED:"+item.text}))})}}]
  })};
};
await import("../background.js");

function send(type, entries, sender = {id: "testing-extension", tab: {id: 13}}) {
  return new Promise(resolve => {
    const accepted = listener({type, entries, context: {title:"A test page"}}, sender, resolve);
    assert.equal(accepted, true);
  });
}

test("background makes one AI call, parses result and caches repeat request", async () => {
  const items = [{id: "cf-1", text: "The evidence is not conclusive."}];
  const first = await send("CF_TRANSLATE", items);
  assert.equal(first.ok, true);
  assert.equal(first.translations["cf-1"], "TRANSLATED:The evidence is not conclusive.");
  assert.equal(first.cacheHit, false);
  assert.equal(callCount, 1);
  const second = await send("CF_TRANSLATE", items);
  assert.equal(second.ok, true);
  assert.equal(second.cacheHit, true);
  assert.equal(callCount, 1);
  assert.equal(prompts[0].model, "demo-model");
});

test("force retry bypasses local cache", async () => {
  const item = [{id: "cf-1", text: "The evidence is not conclusive."}];
  const answer = await new Promise(resolve => listener({type:"CF_TRANSLATE",entries:item,context:{title:"A test page"},force:true}, {id:"testing-extension",tab:{id:13}}, resolve));
  assert.equal(answer.ok, true);
  assert.equal(answer.cacheHit, false);
  assert.equal(callCount, 2);
});

test("background rejects bad batches and extension pages masquerading as tabs", async () => {
  const bad = await send("CF_TRANSLATE", [{id:"bad",text:"hey"}]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid/);
  const internal = await send("CF_TRANSLATE", [{id:"cf-1",text:"hello"}], {id: "testing-extension"});
  assert.equal(internal.ok, false);
  assert.match(internal.error, /active webpage/);
});

test("API test still checks the configured AI model when free mode is selected", async () => {
  values.translationEngine = {provider: "mymemory", source: "en", target: "zh-CN"};
  const response = await send("CF_TEST", undefined, {id: "testing-extension"});
  assert.equal(response.ok, true);
  assert.match(response.sample, /^TRANSLATED:/);
  assert.equal(prompts.at(-1).model, "demo-model");
});

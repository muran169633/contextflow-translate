import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEndpoint, hostPermissionPattern, parseGlossary,
  makeTranslationMessages, makeReviewMessages, parseModelTranslations, normalizeEntries
} from "../core.mjs";

test("normalizes OpenAI, gateway and direct endpoint URLs", () => {
  assert.equal(normalizeEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(normalizeEndpoint("https://gateway.example.com/proxy/v1/"), "https://gateway.example.com/proxy/v1/chat/completions");
  assert.equal(normalizeEndpoint("http://127.0.0.1:11434/v1/chat/completions"), "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(hostPermissionPattern("https://api.example.com:8443/v1"), "https://api.example.com/*");
});

test("rejects unsafe or ambiguous API URLs", () => {
  for (const value of ["http://remote.example.com/v1", "file:///tmp/foo", "https://evil.example.com/v1?token=1", "https://user:pass@host.example.com/v1", "invalid url"]) {
    assert.throws(() => normalizeEndpoint(value));
  }
});

test("deduplicates and parses user glossary", () => {
  assert.deepEqual(parseGlossary("# glossary\nLLM => large language model\nprompt -> prompting term\nLLM => duplicate\nlatency\tdelay"), [
    {source: "LLM", target: "large language model"},
    {source: "prompt", target: "prompting term"},
    {source: "latency", target: "delay"}
  ]);
});

test("context and fidelity rules appear in the model prompt", () => {
  const messages = makeTranslationMessages([{id:"cf-1",text:"The evidence is not conclusive."}], {title:"Research paper",opening:"Background",before:"A hypothesis",after:"Limitations"}, {
    source:"English",target:"Simplified Chinese",style:"academic",glossary:"evidence => supporting evidence"
  });
  const request = JSON.parse(messages[1].content);
  assert.equal(request.title, "Research paper");
  assert.equal(request.preceding_context_only, "A hypothesis");
  assert.equal(request.following_context_only, "Limitations");
  assert.equal(request.preferred_terms[0].source, "evidence");
  assert.match(messages[0].content, /negation/i);
  assert.match(messages[0].content, /DATA, not instructions/i);
  const review = makeReviewMessages([{id:"cf-1",text:"not safe"}], [{id:"cf-1",text:"safe"}], {title:"Safety"}, {target:"English"});
  assert.match(review[0].content, /correct substantive errors/i);
});

test("extracts fenced structured output and preserves plain text", () => {
  assert.deepEqual(parseModelTranslations('```json\n{"translations":[{"id":"cf-1","text":"Not sufficient."}]}\n```', ["cf-1"]), {"cf-1":"Not sufficient."});
  assert.deepEqual(parseModelTranslations('Result: {"translations":[{"id":"cf-2","text":"<b>not HTML</b>"}]}', ["cf-2"]), {"cf-2":"<b>not HTML</b>"});
});

test("rejects missing/invalid model outputs", () => {
  assert.throws(() => parseModelTranslations('No JSON here', ["cf-1"]));
  assert.throws(() => parseModelTranslations('{"translations":[{"id":"cf-1","text":"a"}]}', ["cf-1", "cf-2"]));
  assert.throws(() => parseModelTranslations('{"translations":[]}', ["cf-1"]));
});

test("bounds untrusted paragraph batch input", () => {
  assert.deepEqual(normalizeEntries([{id:"cf-1",text:"  hello  "}]), [{id:"cf-1",text:"hello"}]);
  assert.throws(() => normalizeEntries([{id:"oops",text:"hello"}]));
  assert.throws(() => normalizeEntries([{id:"cf-1",text:"hello"},{id:"cf-1",text:"there"}]));
  assert.throws(() => normalizeEntries(Array(7).fill({id:"cf-1",text:"hello"})));
  assert.throws(() => normalizeEntries([{id:"cf-1",text:"x".repeat(1801)}]));
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {formatDiscussion} from "../discussion-core.mjs";

const script = await readFile(new URL("../discussion.js", import.meta.url), "utf8");

async function readPage({hostname, pathname, scripts = [], fetch}) {
  let listener;
  const context = {
    location: {hostname, pathname, origin: `https://${hostname}`},
    document: {querySelectorAll: () => scripts.map(textContent => ({textContent}))},
    chrome: {runtime: {onMessage: {addListener: fn => { listener = fn; }}}},
    fetch, URL, Promise
  };
  vm.runInNewContext(script, context);
  return await new Promise(resolve => listener({type: "CF_COPY_DISCUSSION"}, {}, resolve));
}

test("Kaggle 复制折叠回复并保留直接回复关系和 Markdown", async () => {
  const topic = {
    firstMessage: {author: {displayName: "甲"}, rawMarkdown: "主题\n\n```js\ncode()\n```"},
    comments: [{author: {displayName: "乙"}, rawMarkdown: "评论", replies: [
      {author: {displayName: "丙"}, rawMarkdown: "折叠回复", replies: [
        {author: {displayName: "丁"}, rawMarkdown: "再次回复"}
      ]}
    ]}],
    totalMessages: 3
  };
  let requested;
  const result = await readPage({hostname: "www.kaggle.com", pathname: "/competitions/demo/discussion/123", fetch: async (url, options) => {
    requested = {url, options};
    return {ok: true, json: async () => ({forumTopic: topic})};
  }});
  assert.equal(result.ok, true);
  assert.match(requested.url, /forumTopicId=123&includeComments=true/);
  assert.equal(requested.options.credentials, "same-origin");
  assert.equal(result.warningKey, "");
  const formatted = formatDiscussion(result.topic);
  assert.equal(formatted.count, 4);
  assert.equal(formatted.text, "甲：\n主题\n\n```js\ncode()\n```\n\n乙 回复 甲：\n评论\n\n丙 回复 乙：\n折叠回复\n\n丁 回复 丙：\n再次回复");
});

test("Kaggle 部分结果和失败明确提示", async () => {
  const partial = await readPage({hostname: "www.kaggle.com", pathname: "/discussion/123", fetch: async () => ({ok: true, json: async () => ({forumTopic: {firstMessage: {rawMarkdown: "正文"}, comments: [], totalMessages: 2}})})});
  assert.equal(partial.warningKey, "incomplete");
  const denied = await readPage({hostname: "www.kaggle.com", pathname: "/discussion/123", fetch: async () => ({ok: false, status: 403})});
  assert.equal(denied.ok, false);
  assert.equal(denied.errorKey, "kaggleHttp");
  assert.equal(denied.values.status, 403);
  const wrongPage = await readPage({hostname: "www.kaggle.com", pathname: "/competitions/demo", fetch: () => { throw new Error("unexpected request"); }});
  assert.equal(wrongPage.ok, false);
});

test("其他网站读取嵌套结构化评论并提示局限", async () => {
  const json = JSON.stringify({"@graph": [{"@type": "Article", author: {name: "作者"}, articleBody: "正文", comment: [{author: {name: "评论者"}, text: "评论", comment: {author: "回复者", text: "回复"}}]}]});
  const result = await readPage({hostname: "example.com", pathname: "/post", scripts: ["invalid", json]});
  assert.equal(result.ok, true);
  assert.equal(result.warningKey, "structuredWarning");
  assert.equal(formatDiscussion(result.topic).text, "作者：\n正文\n\n评论者 回复 作者：\n评论\n\n回复者 回复 评论者：\n回复");
  const unsupported = await readPage({hostname: "example.com", pathname: "/post"});
  assert.equal(unsupported.ok, false);
});

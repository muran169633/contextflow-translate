# ContextFlow Translate 0.1.0

A small, original Chrome / Edge Manifest V3 bilingual webpage translation extension. It prioritizes **meaning over fluency** and lets you choose your own OpenAI-compatible AI provider.

**This is an independently implemented MVP. It is not affiliated with Immersive Translate or SmartSub.**

## Supported in this MVP

- Bilingual paragraph translation, with the original webpage preserved.
- Translation in groups of five paragraphs, including title, article opening and adjacent-paragraph context.
- OpenAI-compatible `chat/completions` API with an arbitrary HTTPS base URL, including many personal API gateways; local HTTP model servers on `localhost` / `127.0.0.1`.
- Up to 60 preferred glossary terms using `source => target` syntax.
- Faithful, technical, academic or natural translation styles.
- Optional second AI review, aimed at preserving negations, numbers, units and qualifiers.
- Per-paragraph retry; stop translation; remove all overlays.
- Optional 7-day local cache (up to 200 batched results).
- On-demand `activeTab` access: no always-on webpage monitoring.
- Copy Kaggle discussions, including replies returned in collapsed threads,
  with author and direct-reply labels; structured comments on other sites are
  supported when available.

## Quick start (Chrome / Edge)

1. Extract the ZIP to a permanent folder. Do **not** select the ZIP itself.
2. Open `chrome://extensions` (or `edge://extensions`). Enable **Developer mode**.
3. Click **Load unpacked** and select the directory containing `manifest.json`.
4. Click the ContextFlow toolbar icon, then **Settings**.
5. Enter the API base URL, model ID and optional API key. Example API base URL: `https://api.openai.com/v1`. The model must support OpenAI-style **chat completions**.
6. Click **Save & test API**; Chrome will ask for permission to contact only the configured API host. The test translates a short sentence and may incur a tiny provider charge.
7. Open any ordinary `https://` article, click the extension icon and choose **Translate page**. Look for translations underneath the original paragraphs and a status indicator in the bottom-right corner.
8. Use **Stop** to halt future batches, **Remove** to clear overlays, or **Retry** to retranslate an individual paragraph without cache.

### 复制讨论

打开 Kaggle 具体讨论页面，点击扩展中的 **Copy discussion / 复制讨论**，
然后粘贴。输出按 `作者：` 和 `回复者 回复 作者：` 分段，保留原文的
Markdown、链接和代码。无需配置 AI 模型；此操作只读取当前网站的数据并
写入剪贴板，不向 AI 服务发送内容。

Kaggle 通过当前页面的登录状态读取讨论数据，包含接口返回的折叠回复；
若接口返回数量不足会提示。网页上由翻译工具插入的译文不包含在 Kaggle
接口原文中。其他网站仅支持页面内已有的 JSON-LD 结构化评论，未加载的
回复可能缺失；不支持的网站会提示，而不会声称复制完整。

### Personal API gateway examples

Configure the address your gateway actually exposes; do not blindly paste this example:

- OpenAI-compatible remote gateway: `https://your-gateway.example/v1`
- Local Ollama-compatible endpoint: `http://127.0.0.1:11434/v1`
- Full URL format also accepted: `https://your-gateway.example/v1/chat/completions`

The extension appends `/chat/completions` if it was not included. It does **not** support the OpenAI Responses API, provider-specific SDK endpoints, or models that do not expose chat completions.

## Glossary examples

```
LLM => large language model
inference => inference
latency => response delay
```

Terms are applied as preferences, not as blind global string replacement. Use established domain terminology. An incorrect glossary can make translation *worse*.

## Local developer tests

Requires Node.js 22+:

```bash
npm test
```

The tests cover URL validation, prompts, terminology parsing, structured output and a mocked service-worker API flow. `tests/demo.html` is a simple sample article.

## Privacy and security

- Nothing is translated or uploaded until you click **Translate page**.
- When invoked, the selected text passages, document title, surrounding context, and glossary terms go to **your configured AI provider**. The extension itself includes no bundled commercial translation endpoint.
- Credentials are stored in `chrome.storage.local`, accessible to trusted extension pages and the background worker, not directly to the webpage. **Local storage is not encrypted with a separate application password**; protect your OS account and Chrome profile.
- Only the configured API origin is requested at runtime, not every visited website. The extension uses `activeTab` permission for the open webpage.
- Translations are inserted using `textContent`, never parsed as HTML, to avoid untrusted model output injecting page markup or scripts.
- Use HTTPS for remote endpoints. Local HTTP is permitted only for `localhost` / `127.0.0.1`.
- Avoid feeding confidential, medical, financial, or private enterprise content to unknown API relays. The optional cache stores translated passages locally for seven days.
- A stopped process may still have one already-sent API call in flight; canceling its UI does not reverse provider charges.

## Known limitations

- Ordinary article-like webpages only. Chrome/Edge internal pages, browser-owned PDF viewers, scanned images and embedded video subtitles are not supported.
- Scans at most 150 content blocks per click (default 50); content is not continuously translated on scroll or SPA route changes.
- Complex page layouts can still render overlays imperfectly; text extraction may select unwanted items or miss nonstandard blocks.
- Translation quality depends on the configured model, prompt, glossary and source text. **No benchmark has established superiority to any other extension**.
- The second-pass review can help but cannot guarantee correctness and uses more tokens.
- Translation requests are grouped sequentially, with a 27-second per-request timeout. Very slow local or remote LLMs may time out.

## Next engineering milestones

1. Article extraction (Readability) with DOM position mapping, visual regression tests, SPA/mutation observer and lazy translation.
2. Per-website domain glossary, terminology extraction from a full article, paragraph context retrieval and document-level consistency checking.
3. Translation error reporting with accepted corrections, sentence-level alignment, confidence diagnostics and a reproducible evaluation suite (COMET + human spot checks).
4. PDF and YouTube subtitles as separate ingestion adapters, not special cases in webpage DOM logic.
5. Privacy-first local model deployments, optional encrypted keys and per-site permission policies.

## Project architecture

```text
popup.html/js            Click-to-translate and remove overlays
discussion.js            Read Kaggle or structured discussion data
discussion-core.mjs      Format authors and nested replies for the clipboard
options.html/js          Provider and translation-quality settings
content.js/css           Extract source paragraphs and render bilingual text
background.js            Host-permission-checked API requests and cache
core.mjs                 Pure prompt, terminology and JSON validation logic
tests/*.test.mjs         Node.js automated tests
```

MIT license. See `LICENSE`.

## Contributing and project history

The project is maintained by [@muran169633](https://github.com/muran169633).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process and
[CHANGELOG.md](CHANGELOG.md) for changes recorded in this repository. The
initial repository commit imports the supplied 0.1.0 source archive; earlier
development history was not included in that archive.

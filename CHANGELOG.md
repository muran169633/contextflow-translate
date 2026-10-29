# Changelog

## Unreleased

- Added Microsoft Azure Translator with resource-key authentication and F0
  free-tier and pricing information.

- Made the on-page quick translation button movable by dragging it directly or using the keyboard.

- Added Youdao Cloud text translation with locally stored application
  credentials and trial-credit and pricing information.

- Added an optional, no-key Google Translate web endpoint with an explicit
  unofficial-service and privacy notice.
- Improved free-service throughput with bounded paragraph concurrency and
  reusable local translation caching.
- Added contribution guidance and documented the project maintainer.
- Added copying of Kaggle discussions, including returned collapsed replies,
  and a limited fallback for structured comments on other sites.
- Added a persistent interface-language selector for Simplified Chinese,
  English, Japanese and Spanish, independent of translation settings.
- Redesigned the popup, added German and Korean interfaces, and added anonymous
  MyMemory translation with selectable source and target languages.
- Added native Gemini and Claude API support with per-provider connection
  settings; existing OpenAI-compatible configurations remain supported.
- Fixed service selection for page translations and retries, and added prompts
  when an older page script or background process needs reloading.
- MyMemory translations now appear paragraph by paragraph; if the service fails,
  earlier results remain visible and the error identifies the interruption.
- Added Google Cloud Translation Basic as an optional, separately configured
  translation provider, with billing and privacy information in the interface.
- Improved coverage of short comments, long paragraphs and pages with multiple
  article regions; added an explicit action for new or unfinished content and
  a warning when the configured paragraph limit leaves content untranslated.
- Added an on-page quick translation button and configurable keyboard shortcut
  using the existing provider settings and permissions.

## 0.1.0 — initial source import

- Imported the supplied ContextFlow Translate MVP source archive, including
  its existing README, tests, and MIT license.
- The archive did not contain earlier Git history, so this record begins at
  the repository import and does not reconstruct earlier development.

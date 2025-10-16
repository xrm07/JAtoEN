# infra-lmstudio

LM Studio client for JA⇄EN Translator.

- Base URL: `http://localhost:1234/v1` (OpenAI-compatible)
- Default model: `lmstudio/translate-enja`
- Request params:
  - `model` (string)
  - `temperature` (number, default 0.2)
  - `max_tokens` (number)
- Endpoint: `POST /chat/completions`
- System prompt: returns exactly N segments separated by U+241E (␞).

Notes
- To use a non-local LM Studio endpoint, set Base URL and API Key in the popup Settings.
- Update `host_permissions` in the extension manifest if you change the host.

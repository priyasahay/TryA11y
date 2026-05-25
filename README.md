# TryA11y

[![CI](https://github.com/priyasahay/TryA11y/actions/workflows/ci.yml/badge.svg)](https://github.com/priyasahay/TryA11y/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG-2.1%20AA-green.svg)](https://www.w3.org/WAI/WCAG21/quickref/)

**Accessibility auditing that finds, fixes, and explains — entirely offline.**

> 🌐 **[Live Preview →](https://priyasahay.github.io/TryA11y/)**

If you find TryA11y useful, please consider giving it a ⭐ star — it really helps the project grow!

TryA11y is a Chrome extension that scans any page for WCAG 2.1 violations using [axe-core](https://github.com/dequelabs/axe-core), generates confidence-rated code fixes with a heuristic engine, and explains every issue in plain English using a local AI model. No data leaves your machine.

---

## Features

- **50+ WCAG 2.1 rules** — critical, serious, moderate, and minor issues
- **Heuristic fix engine** — real before/after HTML fixes with confidence ratings
- **Live DOM patching** — apply and undo fixes directly on the page
- **AI explanations** — local Ollama LLM explains who is affected and how to fix it
- **Report export** — HTML, JSON, or Markdown
- **100% offline** — no API keys, no cloud services, no telemetry

---

## Install (Load Unpacked)

```bash
git clone https://github.com/priyasahay/TryA11y.git
cd TryA11y
pnpm install
pnpm build
```

Then in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `packages/extension/dist`
4. Open DevTools (F12) on any page → go to the **TryA11y** tab

---

## Optional: AI Explanations

Requires [Ollama](https://ollama.com) running locally:

```bash
ollama pull llama3.2
OLLAMA_ORIGINS="*" ollama serve   # or: pnpm ollama from repo root
```

In the DevTools panel: click **✦ AI** → toggle on → set model to `llama3.2`.

---

## Development

```bash
pnpm install          # install all dependencies
pnpm build            # build all packages
pnpm test             # run tests
pnpm typecheck        # type-check all packages

pnpm --filter @trya11y/web dev              # start docs site (localhost:5173)
pnpm --filter @trya11y/extension build      # rebuild extension after changes
```

---

## Architecture

pnpm monorepo — three packages:

```
packages/
├── core/       # axe-core wrapper, heuristic fixer, reporter, Ollama LLM layer
├── extension/  # Chrome MV3 (service worker, content script, DevTools panel, popup)
└── web/        # React + Vite docs/landing site (deployed to GitHub Pages)
```

Both `extension` and `web` depend on `@trya11y/core`. The service worker imports from `@trya11y/core/worker` (DOM-free subset).

---

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

**Quick checklist before submitting:**

- [ ] `pnpm build` passes with no errors
- [ ] `pnpm typecheck` passes with no errors
- [ ] `pnpm test` passes with no new failures
- [ ] New behaviour is covered by a test (or explain why one isn't needed)
- [ ] Commit is signed off (`git commit -s`) per [CLA.md](./CLA.md)

```bash
# Fork the repo, then:
git checkout -b feat/your-feature
pnpm install
pnpm build        # build all packages
pnpm test         # make sure tests pass
pnpm typecheck    # make sure types are clean
# open a PR
```

---

## Maintainers

- [priyasahay](https://github.com/priyasahay) — Creator & Maintainer

---

## Contributors

A big thank you to all our contributors! 🎉

[![Contributors](https://contrib.rocks/image?repo=priyasahay/TryA11y)](https://github.com/priyasahay/TryA11y/graphs/contributors)

---

## Acknowledgements

TryA11y builds on these open-source tools:

- [axe-core](https://github.com/dequelabs/axe-core) — accessibility rules engine (MPL 2.0)
- [Ollama](https://github.com/ollama/ollama) — local LLM runtime for AI explanations (MIT)
- [React](https://github.com/facebook/react) — DevTools panel UI (MIT)
- [Vite](https://github.com/vitejs/vite) — build tooling (MIT)

---

## Security

See [SECURITY.md](./SECURITY.md).

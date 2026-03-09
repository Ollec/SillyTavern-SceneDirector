# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SillyTavern-SceneDirector is a third-party extension for SillyTavern that adds structured beat-based scene directing to roleplay chats. It injects narrative directives into the AI's context to guide scenes through phases (setup → rising → confrontation → climax → resolution).

The extension runs inside SillyTavern's browser runtime — it uses SillyTavern's API imports, jQuery, and toastr (all provided by the host). There is no build step.

## Commands

```bash
# Install test dependencies (first time)
cd tests && pnpm install

# Run all tests (unit + compat)
cd tests && pnpm test

# Run with coverage (90% threshold enforced)
cd tests && pnpm run test:coverage

# Run only compatibility tests against local SillyTavern
cd tests && pnpm run test:compat

# Run a single test file
cd tests && pnpm test -- sceneManager
```

There is no build, lint, or compile step for the extension itself. SillyTavern loads the raw ES module files directly.

The compatibility tests (`stCompat.test.js`) require a local SillyTavern checkout. They default to `../SillyTavern` relative to the repo root. Set `ST_PATH` to override:

```bash
ST_PATH=/path/to/SillyTavern cd tests && pnpm test
```

## Architecture

**Two-layer design:**

- `src/sceneManager.js` — Pure logic with no external dependencies. Contains phase definitions, scene validation, beat navigation state machines, prompt injection builder, and status formatting. All functions are pure: they take data in and return results. This is the testable core.

- `index.js` — Integration layer. Imports from `sceneManager.js` and wires it to SillyTavern's APIs: `chat_metadata` for per-chat state, `extension_settings` for global preferences, `setExtensionPrompt` for prompt injection, `eventSource` for lifecycle events, and `SlashCommandParser` for slash commands. Also handles all DOM/jQuery UI updates. Template (`director.html`) contains three top-level elements parsed and placed separately: extensions drawer panel, wand menu button (`#extensionsMenu`), and chat banner (`#sheld`).

**State split:**
- Per-chat state (`active`, `sceneId`, `currentBeat`) lives in `chat_metadata` with `sd_` prefixed keys — this is SillyTavern's standard pattern for chat-scoped data (see Author's Note for reference)
- Global preferences (`showHints`, `injectionDepth`) live in `extension_settings['scene-director']`

**Scene data:** JSON files in `scenes/`, registered in `scenes/manifest.json`. Each scene has a `beats` array where each beat specifies `label`, `phase`, `tone`, `directive`, `key_elements`, and optional `advance_hint`. Scenes can optionally define a `phases` object to override default phase prompts and colors.

**Phase system:** Phases are configurable at the scene level. Default phases (setup, rising, confrontation, climax, resolution) are defined in `PHASE_PROMPTS`. Scenes can define custom phases via a `phases` key with per-phase `prompt` and `color`. Resolution order: scene-level → alias → global default → empty. When a scene defines `phases`, `PHASE_ALIASES` are bypassed. Colors fall through to `DEFAULT_PHASE_COLORS` then a deterministic hash. CSS handles the 8 known phase names; JS applies inline colors for custom/unknown phases.

**Lifecycle functions** return `{ text, ok }` objects. The UI layer maps `ok: true` to `toastr.success()` and `ok: false` to `toastr.warning()`. Slash commands return `result.text` as a plain string and declare a `returns` property for help text.

## Testing

- **Unit tests** (`tests/sceneManager.test.js`) — 54 tests covering pure logic: validation, navigation, injection building, status formatting, phase aliases, custom phase resolution, phase colors
- **Compatibility tests** (`tests/stCompat.test.js`) — 28 tests that parse actual SillyTavern source files to verify exports, event constants, method signatures, and import path resolution still match what the extension depends on
- **Coverage** — 90% threshold on branches/functions/lines/statements, enforced by Jest config
- **CI** — GitHub Actions (`.github/workflows/test.yml`) runs both test suites with pnpm, shallow-clones SillyTavern `release` branch for compat tests

## Documentation

- `README.md` — Installation, usage, settings, slash commands (with screenshots in `docs/images/`)
- `docs/creating-scenes.md` — Full scene authoring guide: manifest format, beat fields, phases, writing tips, injection format, validation rules
- `docs/images/` — Screenshots (chat-banner.png, slash-commands.png)

## SillyTavern Extension Integration

The extension is installed at `<ST>/public/scripts/extensions/third-party/SillyTavern-SceneDirector/`. Import paths in `index.js` are relative to that location (e.g., `../../extensions.js` → SillyTavern's extensions module).

Key SillyTavern APIs used:
- `setExtensionPrompt(name, text, position, depth)` — inject directives into AI context
- `chat_metadata` + `saveMetadataDebounced()` — per-chat persistent state
- `extension_settings` + `saveSettingsDebounced()` — global persistent settings
- `eventSource.on(event_types.GENERATION_STARTED | CHAT_CHANGED)` — lifecycle hooks
- `SlashCommandParser.addCommandObject()` — register `/scene-*` commands

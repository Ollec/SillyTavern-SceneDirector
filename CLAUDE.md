# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SillyTavern-SceneDirector is a third-party extension for SillyTavern that adds structured beat-based scene directing to roleplay chats. It injects narrative directives into the AI's context to guide scenes through phases (setup → rising → confrontation → climax → resolution).

The extension runs inside SillyTavern's browser runtime — it uses SillyTavern's API imports, jQuery, and toastr (all provided by the host). There is no build step.

## Commands

```bash
# Run unit tests
cd tests && pnpm test

# Install test dependencies (first time)
cd tests && pnpm install
```

There is no build, lint, or compile step for the extension itself. SillyTavern loads the raw ES module files directly.

## Architecture

**Two-layer design:**

- `src/sceneManager.js` — Pure logic with no external dependencies. Contains phase definitions, scene validation, beat navigation state machines, prompt injection builder, and status formatting. All functions are pure: they take data in and return results. This is the testable core.

- `index.js` — Integration layer. Imports from `sceneManager.js` and wires it to SillyTavern's APIs: `chat_metadata` for per-chat state, `extension_settings` for global preferences, `setExtensionPrompt` for prompt injection, `eventSource` for lifecycle events, and `SlashCommandParser` for slash commands. Also handles all DOM/jQuery UI updates.

**State split:**
- Per-chat state (`active`, `sceneId`, `currentBeat`) lives in `chat_metadata` with `sd_` prefixed keys — this is SillyTavern's standard pattern for chat-scoped data (see Author's Note for reference)
- Global preferences (`showHints`, `injectionDepth`) live in `extension_settings['scene-director']`

**Scene data:** JSON files in `scenes/`, registered in `scenes/manifest.json`. Each scene has a `beats` array where each beat specifies `label`, `phase`, `tone`, `directive`, `key_elements`, and optional `advance_hint`.

**Phase backward compatibility:** Old phase names (`escalation`, `action`, `afterglow`) are aliased to new names (`rising`, `confrontation`, `resolution`) via `PHASE_ALIASES` in sceneManager.js. Both CSS and injection builder handle either set.

**Lifecycle functions** return `{ text, ok }` objects. The UI layer maps `ok: true` to `toastr.success()` and `ok: false` to `toastr.warning()`. Slash commands return `result.text` as a plain string.

## SillyTavern Extension Integration

The extension is installed at `<ST>/public/scripts/extensions/third-party/SillyTavern-SceneDirector/`. Import paths in `index.js` are relative to that location (e.g., `../../extensions.js` → SillyTavern's extensions module).

Key SillyTavern APIs used:
- `setExtensionPrompt(name, text, position, depth)` — inject directives into AI context
- `chat_metadata` + `saveMetadataDebounced()` — per-chat persistent state
- `extension_settings` + `saveSettingsDebounced()` — global persistent settings
- `eventSource.on(event_types.GENERATION_STARTED | CHAT_CHANGED)` — lifecycle hooks
- `SlashCommandParser.addCommandObject()` — register `/scene-*` commands

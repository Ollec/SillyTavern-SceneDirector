/**
 * Static compatibility tests — verify that every export SceneDirector
 * depends on still exists in the local SillyTavern source.
 *
 * These tests parse the actual ST source files with regex, so they run
 * without a browser or server.  If SillyTavern renames or removes an
 * API we depend on, these tests will fail immediately.
 *
 * Set the ST_PATH environment variable if SillyTavern is not at the
 * default location (../SillyTavern relative to this repo).
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Resolve SillyTavern path — default to sibling directory
const ST_PATH = process.env.ST_PATH || resolve(REPO_ROOT, '..', 'SillyTavern');
const ST_PUBLIC = resolve(ST_PATH, 'public');
const ST_SCRIPTS = resolve(ST_PUBLIC, 'scripts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(relPath) {
    const fullPath = resolve(ST_PUBLIC, relPath);
    if (!existsSync(fullPath)) {
        throw new Error(`SillyTavern file not found: ${fullPath}\nIs ST_PATH set correctly? Current: ${ST_PATH}`);
    }
    return readFileSync(fullPath, 'utf8');
}

function expectExport(source, name, filePath) {
    // Match: export const/let/var/function/async function/class <name>
    const pattern = new RegExp(`export\\s+(?:const|let|var|function|async\\s+function|class)\\s+${name}\\b`);
    expect(source).toMatch(pattern);
}

// ---------------------------------------------------------------------------
// Preload sources once
// ---------------------------------------------------------------------------

let extensionsSrc, scriptSrc, eventsSrc, slashCommandSrc, slashCommandParserSrc, slashCommandArgSrc, popupSrc;

beforeAll(() => {
    if (!existsSync(ST_PATH)) {
        throw new Error(
            `SillyTavern not found at ${ST_PATH}. ` +
            'Set ST_PATH env var to the SillyTavern root directory.',
        );
    }

    extensionsSrc = readSource('scripts/extensions.js');
    scriptSrc = readSource('script.js');
    slashCommandSrc = readSource('scripts/slash-commands/SlashCommand.js');
    slashCommandParserSrc = readSource('scripts/slash-commands/SlashCommandParser.js');
    slashCommandArgSrc = readSource('scripts/slash-commands/SlashCommandArgument.js');
    popupSrc = readSource('scripts/popup.js');
});

// ---------------------------------------------------------------------------
// ../../extensions.js
// ---------------------------------------------------------------------------

describe('SillyTavern extensions.js exports', () => {
    test('exports extension_settings', () => {
        expectExport(extensionsSrc, 'extension_settings');
    });

    test('exports renderExtensionTemplateAsync', () => {
        expectExport(extensionsSrc, 'renderExtensionTemplateAsync');
    });

    test('exports saveMetadataDebounced', () => {
        expectExport(extensionsSrc, 'saveMetadataDebounced');
    });
});

// ---------------------------------------------------------------------------
// ../../../script.js — some exports may come from re-exports via events.js
// ---------------------------------------------------------------------------

describe('SillyTavern script.js exports', () => {
    test('exports chat_metadata', () => {
        expectExport(scriptSrc, 'chat_metadata');
    });

    test('exports saveSettingsDebounced', () => {
        expectExport(scriptSrc, 'saveSettingsDebounced');
    });

    test('exports setExtensionPrompt', () => {
        expectExport(scriptSrc, 'setExtensionPrompt');
    });

    test('exports getRequestHeaders', () => {
        expectExport(scriptSrc, 'getRequestHeaders');
    });
});

describe('SillyTavern event exports (re-exported via script.js)', () => {
    let src;

    beforeAll(() => {
        // eventSource and event_types may be defined in events.js and
        // re-exported from script.js.  Check both.
        const eventsSrc = readSource('scripts/events.js');
        src = scriptSrc + '\n' + eventsSrc;
    });

    test('exports eventSource', () => {
        expectExport(src, 'eventSource');
    });

    test('exports event_types', () => {
        expectExport(src, 'event_types');
    });
});

// ---------------------------------------------------------------------------
// Event type constants used by SceneDirector
// ---------------------------------------------------------------------------

describe('Required event_types constants', () => {
    let eventsSrc;

    beforeAll(() => {
        eventsSrc = readSource('scripts/events.js');
    });

    test('GENERATION_STARTED exists', () => {
        expect(eventsSrc).toMatch(/GENERATION_STARTED\s*:/);
    });

    test('CHAT_CHANGED exists', () => {
        expect(eventsSrc).toMatch(/CHAT_CHANGED\s*:/);
    });
});

// ---------------------------------------------------------------------------
// Slash command classes
// ---------------------------------------------------------------------------

describe('SillyTavern SlashCommand exports', () => {
    test('exports SlashCommand class', () => {
        expectExport(slashCommandSrc, 'SlashCommand');
    });

    test('SlashCommand has static fromProps method', () => {
        expect(slashCommandSrc).toMatch(/static\s+fromProps\s*\(/);
    });
});

describe('SillyTavern SlashCommandParser exports', () => {
    test('exports SlashCommandParser class', () => {
        expectExport(slashCommandParserSrc, 'SlashCommandParser');
    });
});

describe('SillyTavern SlashCommandArgument exports', () => {
    test('exports ARGUMENT_TYPE', () => {
        expectExport(slashCommandArgSrc, 'ARGUMENT_TYPE');
    });

    test('exports SlashCommandArgument class', () => {
        expectExport(slashCommandArgSrc, 'SlashCommandArgument');
    });

    test('SlashCommandArgument has static fromProps method', () => {
        expect(slashCommandArgSrc).toMatch(/static\s+fromProps\s*\(/);
    });
});

// ---------------------------------------------------------------------------
// popup.js — Popup class and POPUP_RESULT
// ---------------------------------------------------------------------------

describe('SillyTavern popup.js exports', () => {
    test('exports Popup class', () => {
        expectExport(popupSrc, 'Popup');
    });

    test('exports POPUP_RESULT', () => {
        expectExport(popupSrc, 'POPUP_RESULT');
    });

    test('exports POPUP_TYPE', () => {
        expectExport(popupSrc, 'POPUP_TYPE');
    });
});

// ---------------------------------------------------------------------------
// setExtensionPrompt signature — we rely on (key, value, position, depth)
// ---------------------------------------------------------------------------

describe('setExtensionPrompt signature', () => {
    test('accepts at least 4 parameters', () => {
        // Match: function setExtensionPrompt(key, value, position, depth
        expect(scriptSrc).toMatch(
            /function\s+setExtensionPrompt\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+/,
        );
    });
});

// ---------------------------------------------------------------------------
// Source file existence
// ---------------------------------------------------------------------------

describe('Required SillyTavern source files exist', () => {
    const requiredFiles = [
        'script.js',
        'scripts/extensions.js',
        'scripts/events.js',
        'scripts/slash-commands/SlashCommand.js',
        'scripts/slash-commands/SlashCommandParser.js',
        'scripts/slash-commands/SlashCommandArgument.js',
        'scripts/popup.js',
    ];

    for (const file of requiredFiles) {
        test(`${file} exists`, () => {
            expect(existsSync(resolve(ST_PUBLIC, file))).toBe(true);
        });
    }
});

// ---------------------------------------------------------------------------
// Import path resolution — verify relative paths in index.js resolve to
// real files when the extension is installed at the third-party location:
// <ST>/public/scripts/extensions/third-party/SillyTavern-SceneDirector/
// ---------------------------------------------------------------------------

describe('Import paths in index.js resolve correctly', () => {
    // Simulates browser ES module resolution from the extension's install path
    const EXT_DIR = resolve(ST_PUBLIC, 'scripts/extensions/third-party/SillyTavern-SceneDirector');

    // These are the relative import paths used in index.js (excluding ./src/ local imports)
    const imports = [
        { path: '../../../extensions.js', desc: 'extensions.js' },
        { path: '../../../../script.js', desc: 'script.js' },
        { path: '../../../slash-commands/SlashCommandParser.js', desc: 'SlashCommandParser.js' },
        { path: '../../../slash-commands/SlashCommand.js', desc: 'SlashCommand.js' },
        { path: '../../../slash-commands/SlashCommandArgument.js', desc: 'SlashCommandArgument.js' },
        { path: '../../../popup.js', desc: 'popup.js' },
    ];

    for (const { path: importPath, desc } of imports) {
        test(`"${importPath}" resolves to ${desc}`, () => {
            const resolved = resolve(EXT_DIR, importPath);
            expect(existsSync(resolved)).toBe(true);
        });
    }
});

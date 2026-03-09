import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import {
    chat_metadata,
    eventSource,
    event_types,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';
import {
    validateScene,
    buildBeatInjection,
    getStatus,
    startSceneState,
    advanceBeatState,
    retreatBeatState,
    jumpToBeatState,
} from './src/sceneManager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULE_NAME = 'scene-director';
const EXTENSION_PATH = 'scripts/extensions/third-party/SillyTavern-SceneDirector';

const INJECTION_POSITION = 1; // IN_CHAT
const DEFAULT_DEPTH = 1;

const METADATA_KEYS = {
    active: 'sd_active',
    sceneId: 'sd_sceneId',
    currentBeat: 'sd_currentBeat',
};

const DEFAULT_SETTINGS = {
    showHints: true,
    injectionDepth: DEFAULT_DEPTH,
};

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

let loadedScene = null; // The full scene JSON (not persisted)

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    }
    return extension_settings[MODULE_NAME];
}

function saveSettings() {
    saveSettingsDebounced();
}

function getSceneState() {
    return {
        active: chat_metadata[METADATA_KEYS.active] ?? false,
        sceneId: chat_metadata[METADATA_KEYS.sceneId] ?? null,
        currentBeat: chat_metadata[METADATA_KEYS.currentBeat] ?? 0,
    };
}

function setSceneState(state) {
    chat_metadata[METADATA_KEYS.active] = state.active;
    chat_metadata[METADATA_KEYS.sceneId] = state.sceneId;
    chat_metadata[METADATA_KEYS.currentBeat] = state.currentBeat;
    saveMetadataDebounced();
}

// ---------------------------------------------------------------------------
// Scene loading
// ---------------------------------------------------------------------------

async function loadSceneManifest() {
    try {
        const response = await fetch(`/${EXTENSION_PATH}/scenes/manifest.json`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.scenes || [];
    } catch {
        console.warn('[Scene Director] Could not load scene manifest');
        return [];
    }
}

async function loadScene(sceneId) {
    const manifest = await loadSceneManifest();
    const entry = manifest.find(s => s.id === sceneId);
    if (!entry) return null;

    try {
        const response = await fetch(`/${EXTENSION_PATH}/scenes/${entry.file}`);
        if (!response.ok) return null;
        const scene = await response.json();

        const error = validateScene(scene);
        if (error) {
            console.warn(`[Scene Director] Invalid scene "${sceneId}": ${error}`);
            return null;
        }

        return scene;
    } catch {
        console.warn(`[Scene Director] Could not load scene: ${sceneId}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Prompt injection
// ---------------------------------------------------------------------------

function injectCurrentBeat() {
    const state = getSceneState();
    if (!state.active || !loadedScene) {
        clearInjection();
        return;
    }

    const injection = buildBeatInjection(loadedScene, state.currentBeat);
    if (!injection) {
        clearInjection();
        return;
    }

    const settings = getSettings();
    setExtensionPrompt(
        MODULE_NAME,
        injection,
        INJECTION_POSITION,
        settings.injectionDepth,
    );
}

function clearInjection() {
    setExtensionPrompt(MODULE_NAME, '', INJECTION_POSITION, DEFAULT_DEPTH);
}

// ---------------------------------------------------------------------------
// Scene lifecycle
// ---------------------------------------------------------------------------

async function startScene(sceneId) {
    const scene = await loadScene(sceneId);
    const { state, result } = startSceneState(scene);

    if (!state) return result;

    // Ensure the scene has an id stored for state tracking
    scene.id = sceneId;
    loadedScene = scene;
    setSceneState(state);
    injectCurrentBeat();
    updateProgressPanel();

    return result;
}

function advanceBeat() {
    const sceneState = getSceneState();
    if (!sceneState.active || !loadedScene) return { text: 'No scene is active.', ok: false };

    const { currentBeat, result } = advanceBeatState(loadedScene, sceneState.currentBeat);

    if (result.ok) {
        setSceneState({ ...sceneState, currentBeat });
        injectCurrentBeat();
        updateProgressPanel();
    }

    return result;
}

function retreatBeat() {
    const sceneState = getSceneState();
    if (!sceneState.active || !loadedScene) return { text: 'No scene is active.', ok: false };

    const { currentBeat, result } = retreatBeatState(loadedScene, sceneState.currentBeat);

    if (result.ok) {
        setSceneState({ ...sceneState, currentBeat });
        injectCurrentBeat();
        updateProgressPanel();
    }

    return result;
}

function jumpToBeat(n) {
    const sceneState = getSceneState();
    if (!sceneState.active || !loadedScene) return { text: 'No scene is active.', ok: false };

    const { currentBeat, result } = jumpToBeatState(loadedScene, sceneState.currentBeat, n);

    if (result.ok) {
        setSceneState({ ...sceneState, currentBeat });
        injectCurrentBeat();
        updateProgressPanel();
    }

    return result;
}

function endScene() {
    const title = loadedScene ? loadedScene.title : 'unknown';
    loadedScene = null;

    setSceneState({ active: false, sceneId: null, currentBeat: 0 });
    clearInjection();
    updateProgressPanel();

    return { text: `Scene "${title}" ended.`, ok: true };
}

function getSceneStatus() {
    const state = getSceneState();
    if (!state.active || !loadedScene) return { text: 'No scene is active.', ok: false };
    return getStatus(loadedScene, state.currentBeat);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function buildPhaseBar($bar, scene, currentBeat) {
    $bar.empty();
    const total = scene.beats.length;
    for (let i = 0; i < total; i++) {
        const phase = scene.beats[i].phase;
        const cls = i < currentBeat ? 'completed' : i === currentBeat ? 'active' : '';
        $('<div>')
            .addClass('sd-phase-segment')
            .addClass(cls)
            .attr('data-phase', phase)
            .attr('title', `Beat ${i + 1}: ${scene.beats[i].label} [${phase}]`)
            .appendTo($bar);
    }
}

function updateProgressPanel() {
    const state = getSceneState();
    const settings = getSettings();
    const $progress = $('#sd-progress');

    if (!state.active || !loadedScene) {
        $progress.hide();
        $('#sd-scene-selector').show();
        updateBanner();
        updateWandButton();
        return;
    }

    // Hide selector during active scene
    $('#sd-scene-selector').hide();

    const beat = loadedScene.beats[state.currentBeat];
    const beatNum = state.currentBeat + 1;
    const total = loadedScene.beats.length;

    $('#sd-scene-title').text(loadedScene.title);
    $('#sd-beat-label').text(beat.label);
    $('#sd-beat-counter').text(`${beatNum} / ${total}`);

    // Phase bar (XSS-safe jQuery construction)
    buildPhaseBar($('#sd-phase-bar'), loadedScene, state.currentBeat);

    // Advance hint
    if (settings.showHints && beat.advance_hint) {
        $('#sd-advance-hint').text(`Next: ${beat.advance_hint}`).show();
    } else {
        $('#sd-advance-hint').hide();
    }

    $progress.show();
    updateBanner();
    updateWandButton();
}

function updateBanner() {
    const state = getSceneState();
    const $banner = $('#sd-banner');

    if (!state.active || !loadedScene) {
        $banner.hide();
        return;
    }

    const beat = loadedScene.beats[state.currentBeat];
    const beatNum = state.currentBeat + 1;
    const total = loadedScene.beats.length;

    $('#sd-banner-title').text(loadedScene.title);
    $('#sd-banner-beat').text(`Beat ${beatNum}/${total}: ${beat.label}`);
    buildPhaseBar($('#sd-banner-phase-bar'), loadedScene, state.currentBeat);

    $banner.show();
}

function updateWandButton() {
    const state = getSceneState();
    const $btn = $('#sd-wand-btn');
    const $status = $('#sd-wand-status');

    if (state.active && loadedScene) {
        const beatNum = state.currentBeat + 1;
        const total = loadedScene.beats.length;
        $status.text(`${beatNum}/${total}`).show();
        $btn.addClass('sd-active');
    } else {
        $status.hide();
        $btn.removeClass('sd-active');
    }
}

async function populateSceneSelector() {
    const scenes = await loadSceneManifest();
    const $select = $('#sd-scene-list');

    // Keep the default option
    $select.find('option:not(:first)').remove();

    for (const scene of scenes) {
        $('<option>')
            .val(scene.id)
            .text(`${scene.title} (${scene.character})`)
            .appendTo($select);
    }
}

// ---------------------------------------------------------------------------
// Toast helper
// ---------------------------------------------------------------------------

function showResult(result) {
    if (result.ok) {
        toastr.success(result.text);
    } else {
        toastr.warning(result.text);
    }
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

function registerCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-list',
        callback: async () => {
            const scenes = await loadSceneManifest();
            if (scenes.length === 0) return 'No scene scripts found.';
            return scenes.map(s => `- ${s.id}: ${s.title} (${s.character})`).join('\n');
        },
        returns: 'list of available scenes',
        helpString: 'Lists all available Scene Director scripts.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-start',
        callback: async (_args, value) => {
            const result = await startScene(value.trim());
            return result.text;
        },
        returns: 'scene start confirmation',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Scene ID to start',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Start a guided scene. Usage: /scene-start scene_id',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-next',
        callback: () => {
            const result = advanceBeat();
            return result.text;
        },
        returns: 'beat advance confirmation',
        helpString: 'Advance to the next beat in the current scene.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-prev',
        callback: () => {
            const result = retreatBeat();
            return result.text;
        },
        returns: 'beat retreat confirmation',
        helpString: 'Go back to the previous beat.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-status',
        callback: () => {
            const result = getSceneStatus();
            return result.text;
        },
        returns: 'current scene and beat status',
        helpString: 'Show the current scene and beat status.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-stop',
        callback: () => {
            const result = endScene();
            return result.text;
        },
        returns: 'scene end confirmation',
        helpString: 'End the current scene and clear the directive.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-beat',
        callback: (_args, value) => {
            const n = parseInt(value.trim(), 10);
            if (isNaN(n)) return 'Usage: /scene-beat <number>';
            const result = jumpToBeat(n);
            return result.text;
        },
        returns: 'beat jump confirmation',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Beat number (1-indexed)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
            }),
        ],
        helpString: 'Jump to a specific beat number. Usage: /scene-beat 3',
    }));
}

// ---------------------------------------------------------------------------
// Event hooks
// ---------------------------------------------------------------------------

function registerEventHandlers() {
    eventSource.on(event_types.GENERATION_STARTED, () => {
        injectCurrentBeat();
    });

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const state = getSceneState();
        if (state.active && state.sceneId) {
            loadedScene = await loadScene(state.sceneId);
            if (!loadedScene) {
                setSceneState({ active: false, sceneId: null, currentBeat: 0 });
            }
        } else {
            loadedScene = null;
        }
        clearInjection();
        updateProgressPanel();
    });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

jQuery(async () => {
    const html = await $.get(`/${EXTENSION_PATH}/director.html`);

    // Parse the template into separate elements
    const $template = $(html);
    const $settings = $template.filter('#scene-director-settings');
    const $wandBtn = $template.filter('#sd-wand-btn');
    const $banner = $template.filter('#sd-banner');

    // Place elements in the DOM
    $('#extensions_settings').append($settings);
    $('#extensionsMenu').append($wandBtn);
    $('#sheld').prepend($banner);

    // Load settings
    const settings = getSettings();

    // Wire drawer UI controls
    $('#sd-start-btn').on('click', async () => {
        const sceneId = $('#sd-scene-list').val();
        if (!sceneId) return;
        const result = await startScene(sceneId);
        showResult(result);
    });

    $('#sd-next-btn').on('click', () => {
        showResult(advanceBeat());
    });

    $('#sd-prev-btn').on('click', () => {
        showResult(retreatBeat());
    });

    $('#sd-stop-btn').on('click', () => {
        showResult(endScene());
    });

    // Wire banner controls
    $('#sd-banner-next').on('click', () => {
        showResult(advanceBeat());
    });

    $('#sd-banner-prev').on('click', () => {
        showResult(retreatBeat());
    });

    $('#sd-banner-stop').on('click', () => {
        showResult(endScene());
    });

    // Wire wand button — clicking opens the extensions drawer to Scene Director
    $('#sd-wand-btn').on('click', () => {
        const $drawer = $('#scene-director-settings .inline-drawer');
        const $toggle = $drawer.find('.inline-drawer-toggle');
        // Open the drawer if closed
        if (!$drawer.hasClass('open')) {
            $toggle.trigger('click');
        }
    });

    // Settings controls
    $('#sd-show-hints').prop('checked', settings.showHints).on('change', function () {
        settings.showHints = $(this).is(':checked');
        saveSettings();
        updateProgressPanel();
    });

    $('#sd-injection-depth').val(settings.injectionDepth).on('change', function () {
        settings.injectionDepth = parseInt($(this).val(), 10) || DEFAULT_DEPTH;
        saveSettings();
        injectCurrentBeat();
    });

    // Populate scene dropdown
    await populateSceneSelector();

    // Register commands and events
    registerCommands();
    registerEventHandlers();

    // Restore state if returning to a scene in progress
    const state = getSceneState();
    if (state.active && state.sceneId) {
        loadedScene = await loadScene(state.sceneId);
        if (loadedScene) {
            injectCurrentBeat();
        } else {
            setSceneState({ active: false, sceneId: null, currentBeat: 0 });
        }
    }
    updateProgressPanel();

    console.log('[Scene Director] Extension loaded');
});

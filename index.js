import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import {
    chat_metadata,
    eventSource,
    event_types,
    getRequestHeaders,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../../script.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../../popup.js';
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
    resolvePhaseColor,
    DEFAULT_PHASE_COLORS,
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
// Scene registry & loading
// ---------------------------------------------------------------------------

async function initSceneRegistry() {
    const settings = getSettings();
    if (settings.scenes !== undefined) return;

    // First-run: seed registry from bundled manifest
    try {
        const response = await fetch(`/${EXTENSION_PATH}/scenes/manifest.json`);
        if (!response.ok) { settings.scenes = []; saveSettings(); return; }
        const data = await response.json();
        settings.scenes = (data.scenes || []).map(s => ({ ...s, source: 'bundled' }));
    } catch {
        settings.scenes = [];
    }
    saveSettings();
}

function getSceneRegistry() {
    return getSettings().scenes || [];
}

async function loadScene(sceneId) {
    const registry = getSceneRegistry();
    const entry = registry.find(s => s.id === sceneId);
    if (!entry) return null;

    let url;
    if (entry.source === 'imported' && entry.path) {
        url = entry.path;
    } else {
        url = `/${EXTENSION_PATH}/scenes/${entry.file || entry.id + '.json'}`;
    }

    try {
        const response = await fetch(url);
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
// Scene import & delete
// ---------------------------------------------------------------------------

async function importScene(file) {
    let scene;
    try {
        const text = await file.text();
        scene = JSON.parse(text);
    } catch {
        return { text: `Failed to parse "${file.name}" as JSON.`, ok: false };
    }

    const error = validateScene(scene);
    if (error) return { text: `Invalid scene: ${error}`, ok: false };

    // Ensure scene has an id
    if (!scene.id) {
        scene.id = scene.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    const safeName = `sd_scene_${scene.id.replace(/[^a-z0-9_-]/gi, '_')}.json`;

    try {
        const uploadResp = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: safeName, data: btoa(new TextEncoder().encode(JSON.stringify(scene, null, 2)).reduce((s, b) => s + String.fromCharCode(b), '')) }),
        });
        if (!uploadResp.ok) {
            const errText = await uploadResp.text();
            return { text: `Upload failed: ${errText}`, ok: false };
        }
        const { path } = await uploadResp.json();

        // Add or overwrite in registry
        const settings = getSettings();
        const existing = settings.scenes.findIndex(s => s.id === scene.id);
        const entry = {
            id: scene.id,
            title: scene.title,
            character: scene.character || 'Any',
            source: 'imported',
            path,
        };
        if (existing >= 0) {
            settings.scenes[existing] = entry;
        } else {
            settings.scenes.push(entry);
        }
        saveSettings();

        return { text: `Imported scene "${scene.title}".`, ok: true };
    } catch (err) {
        return { text: `Import failed: ${err.message}`, ok: false };
    }
}

async function importSceneFromJSON(jsonString) {
    let scene;
    try {
        scene = JSON.parse(jsonString);
    } catch {
        return { text: 'Failed to parse JSON string.', ok: false };
    }

    // Reuse importScene by creating a synthetic File
    const blob = new Blob([JSON.stringify(scene)], { type: 'application/json' });
    const file = new File([blob], `${scene.id || 'scene'}.json`, { type: 'application/json' });
    return importScene(file);
}

async function deleteScene(sceneId) {
    const settings = getSettings();
    const entry = settings.scenes.find(s => s.id === sceneId);
    if (!entry) return { text: `Scene "${sceneId}" not found.`, ok: false };
    if (entry.source !== 'imported') return { text: `Cannot delete bundled scene "${entry.title}".`, ok: false };

    // Delete file from ST data API
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path: entry.path }),
        });
    } catch (err) {
        console.warn(`[Scene Director] Failed to delete file: ${err.message}`);
    }

    // Remove from registry
    settings.scenes = settings.scenes.filter(s => s.id !== sceneId);
    saveSettings();

    // End scene if currently active
    const state = getSceneState();
    if (state.active && state.sceneId === sceneId) {
        endScene();
    }

    return { text: `Deleted scene "${entry.title}".`, ok: true };
}

// ---------------------------------------------------------------------------
// Scene editor
// ---------------------------------------------------------------------------

const DEFAULT_PHASES = ['setup', 'rising', 'confrontation', 'climax', 'resolution'];

function escAttr(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEditorHTML(scene) {
    const s = scene || { title: '', id: '', character: '', description: '', beats: [{ label: '', phase: 'setup', tone: '', directive: '', key_elements: [], advance_hint: '' }] };

    const phaseOptions = DEFAULT_PHASES.map(p => `<option value="${p}">${p}</option>`).join('');

    let beatTabsHtml = '';
    let beatPanelsHtml = '';
    for (let i = 0; i < s.beats.length; i++) {
        const b = s.beats[i];
        const active = i === 0 ? ' sd-editor-beat-tab-active' : '';
        const display = i === 0 ? '' : ' style="display:none;"';
        beatTabsHtml += `<div class="sd-editor-beat-tab menu_button${active}" data-beat-idx="${i}">${escHtml(b.label || `Beat ${i + 1}`)}</div>`;
        beatPanelsHtml += buildBeatPanelHTML(i, b, phaseOptions, display);
    }

    const customPhasesHtml = buildCustomPhasesHTML(s.phases);

    return `
<div class="sd-editor">
    <div class="sd-editor-columns">
        <div class="sd-editor-left">
            <h4>Scene</h4>
            <label>Title</label>
            <input type="text" class="text_pole wide100p" id="sd-ed-title" value="${escAttr(s.title)}" placeholder="Scene title">
            <label>ID <small>(auto-generated if empty)</small></label>
            <input type="text" class="text_pole wide100p" id="sd-ed-id" value="${escAttr(s.id)}" placeholder="my_scene_id">
            <label>Character</label>
            <input type="text" class="text_pole wide100p" id="sd-ed-character" value="${escAttr(s.character || '')}" placeholder="Any">
            <label>Description</label>
            <textarea class="text_pole textarea_compact wide100p" id="sd-ed-description" rows="3" placeholder="Optional description">${escHtml(s.description || '')}</textarea>

            <div class="sd-editor-phases-section">
                <div class="sd-editor-phases-toggle menu_button">
                    <i class="fa-solid fa-palette"></i> Custom Phases
                    <i class="fa-solid fa-chevron-down sd-editor-phases-chevron"></i>
                </div>
                <div class="sd-editor-phases-content" style="display:none;">
                    <div id="sd-ed-phases-list">${customPhasesHtml}</div>
                    <div class="menu_button sd-editor-add-phase-btn"><i class="fa-solid fa-plus"></i> Add Phase</div>
                </div>
            </div>

            <div class="sd-editor-export-section">
                <div class="menu_button sd-editor-export-btn"><i class="fa-solid fa-download"></i> Export JSON</div>
            </div>
        </div>
        <div class="sd-editor-right">
            <h4>Beats</h4>
            <div class="sd-editor-beat-tabs" id="sd-ed-beat-tabs">
                ${beatTabsHtml}
                <div class="sd-editor-beat-tab menu_button sd-editor-add-beat-btn" title="Add beat"><i class="fa-solid fa-plus"></i></div>
            </div>
            <div id="sd-ed-beat-panels">
                ${beatPanelsHtml}
            </div>
        </div>
    </div>
</div>`;
}

function buildBeatPanelHTML(idx, beat, phaseOptions, display) {
    const b = beat || { label: '', phase: 'setup', tone: '', directive: '', key_elements: [], advance_hint: '' };
    const keyElStr = (b.key_elements || []).join(', ');

    // Build phase select with correct selected option
    const selectHtml = phaseOptions.replace(
        `value="${escAttr(b.phase)}"`,
        `value="${escAttr(b.phase)}" selected`,
    );

    return `
<div class="sd-editor-beat-panel" data-beat-idx="${idx}"${display}>
    <label>Label</label>
    <input type="text" class="text_pole wide100p sd-ed-beat-label" value="${escAttr(b.label)}" placeholder="Beat label">
    <label>Phase</label>
    <select class="text_pole wide100p sd-ed-beat-phase">${selectHtml}</select>
    <label>Tone</label>
    <input type="text" class="text_pole wide100p sd-ed-beat-tone" value="${escAttr(b.tone)}" placeholder="e.g. tense, hushed, strategic">
    <label>Directive</label>
    <textarea class="text_pole textarea_compact wide100p sd-ed-beat-directive" rows="4" placeholder="What should happen in this beat...">${escHtml(b.directive)}</textarea>
    <label>Key Elements <small>(comma-separated)</small></label>
    <input type="text" class="text_pole wide100p sd-ed-beat-elements" value="${escAttr(keyElStr)}" placeholder="element1, element2">
    <label>Advance Hint</label>
    <input type="text" class="text_pole wide100p sd-ed-beat-hint" value="${escAttr(b.advance_hint || '')}" placeholder="When to move to next beat">
    <div class="sd-editor-beat-actions">
        <div class="menu_button sd-editor-beat-up" title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
        <div class="menu_button sd-editor-beat-down" title="Move down"><i class="fa-solid fa-arrow-down"></i></div>
        <div class="menu_button sd-editor-beat-delete" title="Delete beat"><i class="fa-solid fa-trash"></i></div>
    </div>
</div>`;
}

function buildCustomPhasesHTML(phases) {
    if (!phases) return '';
    return Object.entries(phases).map(([name, cfg]) => `
<div class="sd-editor-phase-entry">
    <input type="text" class="text_pole sd-ed-phase-name" value="${escAttr(name)}" placeholder="Phase name">
    <input type="color" class="sd-ed-phase-color" value="${escAttr(cfg.color || '#4a9eff')}" title="Phase color">
    <div class="menu_button sd-editor-phase-delete" title="Remove phase"><i class="fa-solid fa-xmark"></i></div>
    <textarea class="text_pole textarea_compact wide100p sd-ed-phase-prompt" rows="2" placeholder="Phase guidance prompt">${escHtml(cfg.prompt || '')}</textarea>
</div>`).join('');
}

function collectEditorData() {
    const scene = {
        title: $('#sd-ed-title').val().trim(),
        id: $('#sd-ed-id').val().trim(),
        character: $('#sd-ed-character').val().trim() || 'Any',
        description: $('#sd-ed-description').val().trim(),
        beats: [],
    };

    // Collect beats in panel order
    $('.sd-editor-beat-panel').each(function () {
        const $p = $(this);
        const keyElStr = $p.find('.sd-ed-beat-elements').val().trim();
        scene.beats.push({
            label: $p.find('.sd-ed-beat-label').val().trim(),
            phase: $p.find('.sd-ed-beat-phase').val(),
            tone: $p.find('.sd-ed-beat-tone').val().trim(),
            directive: $p.find('.sd-ed-beat-directive').val().trim(),
            key_elements: keyElStr ? keyElStr.split(',').map(s => s.trim()).filter(Boolean) : [],
            advance_hint: $p.find('.sd-ed-beat-hint').val().trim(),
        });
    });

    // Collect custom phases
    const phaseEntries = [];
    $('.sd-editor-phase-entry').each(function () {
        const $e = $(this);
        const name = $e.find('.sd-ed-phase-name').val().trim();
        if (!name) return;
        phaseEntries.push([name, {
            prompt: $e.find('.sd-ed-phase-prompt').val().trim(),
            color: $e.find('.sd-ed-phase-color').val(),
        }]);
    });
    if (phaseEntries.length > 0) {
        scene.phases = Object.fromEntries(phaseEntries);
    }

    return scene;
}

function wireEditorEvents($container) {
    // Beat tab switching
    $container.on('click', '.sd-editor-beat-tab:not(.sd-editor-add-beat-btn)', function () {
        const idx = $(this).data('beat-idx');
        $container.find('.sd-editor-beat-tab').removeClass('sd-editor-beat-tab-active');
        $(this).addClass('sd-editor-beat-tab-active');
        $container.find('.sd-editor-beat-panel').hide();
        $container.find(`.sd-editor-beat-panel[data-beat-idx="${idx}"]`).show();
    });

    // Add beat
    $container.on('click', '.sd-editor-add-beat-btn', function () {
        const phaseOptions = DEFAULT_PHASES.map(p => `<option value="${p}">${p}</option>`).join('');
        const count = $container.find('.sd-editor-beat-panel').length;
        const newBeat = { label: `Beat ${count + 1}`, phase: 'setup', tone: '', directive: '', key_elements: [], advance_hint: '' };

        // Hide all panels, add new one
        $container.find('.sd-editor-beat-panel').hide();
        $container.find('.sd-editor-beat-tab').removeClass('sd-editor-beat-tab-active');

        const $newTab = $(`<div class="sd-editor-beat-tab menu_button sd-editor-beat-tab-active" data-beat-idx="${count}">${escHtml(newBeat.label)}</div>`);
        $(this).before($newTab);

        const $newPanel = $(buildBeatPanelHTML(count, newBeat, phaseOptions, ''));
        $('#sd-ed-beat-panels').append($newPanel);
    });

    // Delete beat
    $container.on('click', '.sd-editor-beat-delete', function () {
        const panels = $container.find('.sd-editor-beat-panel');
        if (panels.length <= 1) {
            toastr.warning('A scene must have at least one beat.');
            return;
        }
        const $panel = $(this).closest('.sd-editor-beat-panel');
        const idx = $panel.data('beat-idx');
        $panel.remove();
        $container.find(`.sd-editor-beat-tab[data-beat-idx="${idx}"]`).remove();

        // Reindex remaining panels and tabs
        reindexBeats($container);

        // Activate first beat
        const $firstTab = $container.find('.sd-editor-beat-tab:not(.sd-editor-add-beat-btn)').first();
        $firstTab.addClass('sd-editor-beat-tab-active');
        $container.find('.sd-editor-beat-panel').first().show();
    });

    // Move beat up
    $container.on('click', '.sd-editor-beat-up', function () {
        const $panel = $(this).closest('.sd-editor-beat-panel');
        const $prev = $panel.prev('.sd-editor-beat-panel');
        if ($prev.length) {
            $panel.insertBefore($prev);
            reindexBeats($container);
        }
    });

    // Move beat down
    $container.on('click', '.sd-editor-beat-down', function () {
        const $panel = $(this).closest('.sd-editor-beat-panel');
        const $next = $panel.next('.sd-editor-beat-panel');
        if ($next.length) {
            $panel.insertAfter($next);
            reindexBeats($container);
        }
    });

    // Update tab label when beat label changes
    $container.on('input', '.sd-ed-beat-label', function () {
        const $panel = $(this).closest('.sd-editor-beat-panel');
        const idx = $panel.data('beat-idx');
        const label = $(this).val().trim() || `Beat ${idx + 1}`;
        $container.find(`.sd-editor-beat-tab[data-beat-idx="${idx}"]`).text(label);
    });

    // Custom phases toggle
    $container.on('click', '.sd-editor-phases-toggle', function () {
        const $content = $(this).siblings('.sd-editor-phases-content');
        const $chevron = $(this).find('.sd-editor-phases-chevron');
        $content.toggle();
        $chevron.toggleClass('fa-chevron-down fa-chevron-up');
    });

    // Add custom phase
    $container.on('click', '.sd-editor-add-phase-btn', function () {
        const html = `
<div class="sd-editor-phase-entry">
    <input type="text" class="text_pole sd-ed-phase-name" value="" placeholder="Phase name">
    <input type="color" class="sd-ed-phase-color" value="#4a9eff" title="Phase color">
    <div class="menu_button sd-editor-phase-delete" title="Remove phase"><i class="fa-solid fa-xmark"></i></div>
    <textarea class="text_pole textarea_compact wide100p sd-ed-phase-prompt" rows="2" placeholder="Phase guidance prompt"></textarea>
</div>`;
        $('#sd-ed-phases-list').append(html);
    });

    // Delete custom phase
    $container.on('click', '.sd-editor-phase-delete', function () {
        $(this).closest('.sd-editor-phase-entry').remove();
    });

    // Export JSON
    $container.on('click', '.sd-editor-export-btn', function () {
        const scene = collectEditorData();
        const json = JSON.stringify(scene, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${scene.id || 'scene'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

function reindexBeats($container) {
    // Rebuild tabs to match panel order
    const $tabContainer = $container.find('#sd-ed-beat-tabs');
    const $addBtn = $tabContainer.find('.sd-editor-add-beat-btn');
    $tabContainer.find('.sd-editor-beat-tab:not(.sd-editor-add-beat-btn)').remove();

    $container.find('.sd-editor-beat-panel').each(function (i) {
        $(this).attr('data-beat-idx', i);
        const label = $(this).find('.sd-ed-beat-label').val().trim() || `Beat ${i + 1}`;
        const $tab = $(`<div class="sd-editor-beat-tab menu_button" data-beat-idx="${i}">${escHtml(label)}</div>`);
        $addBtn.before($tab);
    });
}

async function openSceneEditor(scene) {
    const html = buildEditorHTML(scene);

    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        large: true,
        wide: true,
        okButton: 'Save',
        cancelButton: 'Cancel',
    });

    // Wire events after popup renders
    requestAnimationFrame(() => {
        const $container = $(popup.dlg);
        wireEditorEvents($container);
    });

    const result = await popup.show();

    if (result !== POPUP_RESULT.AFFIRMATIVE) return;

    const sceneData = collectEditorData();

    // Auto-generate id if empty
    if (!sceneData.id) {
        sceneData.id = sceneData.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    // Remove empty description
    if (!sceneData.description) delete sceneData.description;

    // Validate
    const error = validateScene(sceneData);
    if (error) {
        toastr.error(`Cannot save: ${error}`);
        // Reopen editor with the data
        await openSceneEditor(sceneData);
        return;
    }

    // Save via import pipeline
    const blob = new Blob([JSON.stringify(sceneData, null, 2)], { type: 'application/json' });
    const file = new File([blob], `${sceneData.id}.json`, { type: 'application/json' });
    const importResult = await importScene(file);
    showResult(importResult);

    if (importResult.ok) {
        populateSceneSelector();

        // Reload if editing the active scene
        const state = getSceneState();
        if (state.active && state.sceneId === sceneData.id) {
            loadedScene = await loadScene(sceneData.id);
            injectCurrentBeat();
            updateProgressPanel();
        }
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
        const $seg = $('<div>')
            .addClass('sd-phase-segment')
            .addClass(cls)
            .attr('data-phase', phase)
            .attr('title', `Beat ${i + 1}: ${scene.beats[i].label} [${phase}]`);

        // Apply inline color for custom or unknown phases; let CSS handle known defaults
        if (!DEFAULT_PHASE_COLORS[phase] || (scene.phases && scene.phases[phase])) {
            $seg.css('background', resolvePhaseColor(scene, phase));
        }

        $seg.appendTo($bar);
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

function populateSceneSelector() {
    const scenes = getSceneRegistry();
    const $select = $('#sd-scene-list');

    // Keep the default option
    $select.find('option:not(:first)').remove();

    for (const scene of scenes) {
        $('<option>')
            .val(scene.id)
            .text(`${scene.title} (${scene.character || 'Any'})`)
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
        callback: () => {
            const scenes = getSceneRegistry();
            if (scenes.length === 0) return 'No scene scripts found.';
            return scenes.map(s => `- ${s.id}: ${s.title} (${s.character || 'Any'})`).join('\n');
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

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-import',
        callback: async (_args, value) => {
            const trimmed = (value || '').trim();
            if (trimmed) {
                // Programmatic: accept inline JSON
                const result = await importSceneFromJSON(trimmed);
                if (result.ok) populateSceneSelector();
                return result.text;
            }
            // Interactive: trigger file picker
            $('#sd-import-input').trigger('click');
            return 'Opening file picker…';
        },
        returns: 'import confirmation',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Optional: inline JSON scene data for programmatic import',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
            }),
        ],
        helpString: 'Import a scene file. Without arguments, opens a file picker. With JSON data, imports directly.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-delete',
        callback: async (_args, value) => {
            const sceneId = (value || '').trim();
            if (!sceneId) return 'Usage: /scene-delete <scene_id>';

            const entry = getSceneRegistry().find(s => s.id === sceneId);
            if (!entry) return `Scene "${sceneId}" not found.`;
            if (entry.source !== 'imported') return `Cannot delete bundled scene "${entry.title}".`;

            const confirm = await Popup.show.confirm('Delete scene?', `Are you sure you want to delete "${entry.title}"?`);
            if (confirm !== POPUP_RESULT.AFFIRMATIVE) return 'Delete cancelled.';

            const result = await deleteScene(sceneId);
            if (result.ok) populateSceneSelector();
            return result.text;
        },
        returns: 'delete confirmation',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Scene ID to delete',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: 'Delete an imported scene. Bundled scenes cannot be deleted. Usage: /scene-delete scene_id',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scene-edit',
        callback: async (_args, value) => {
            const sceneId = (value || '').trim();
            if (!sceneId) {
                await openSceneEditor(null);
                return 'Opened new scene editor.';
            }
            const scene = await loadScene(sceneId);
            if (!scene) return `Scene "${sceneId}" not found.`;
            await openSceneEditor(scene);
            return `Opened editor for "${scene.title}".`;
        },
        returns: 'editor open confirmation',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Optional: Scene ID to edit. Omit to create a new scene.',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
            }),
        ],
        helpString: 'Open the scene editor. Usage: /scene-edit [scene_id]',
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

    // Wire edit/new buttons
    $('#sd-edit-btn').on('click', async () => {
        const sceneId = $('#sd-scene-list').val();
        if (!sceneId) return;
        const scene = await loadScene(sceneId);
        if (!scene) { toastr.warning('Could not load scene.'); return; }
        await openSceneEditor(scene);
    });

    $('#sd-new-btn').on('click', async () => {
        await openSceneEditor(null);
    });

    // Wire import controls
    $('#sd-import-btn').on('click', () => $('#sd-import-input').trigger('click'));
    $('#sd-import-input').on('change', async (e) => {
        for (const file of e.target.files) {
            const result = await importScene(file);
            showResult(result);
        }
        e.target.value = ''; // Reset for re-import
        populateSceneSelector();
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

    // Initialize scene registry (first-run seeds from bundled manifest)
    await initSceneRegistry();

    // Populate scene dropdown
    populateSceneSelector();

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

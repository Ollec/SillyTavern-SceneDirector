// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

export const PHASE_PROMPTS = {
    setup: 'Set the scene. Introduce the environment, characters, and stakes. Do not rush.',
    rising: 'Build tension and anticipation. Develop conflict or desire through interaction.',
    confrontation: 'The central encounter or challenge is underway. Be vivid and match the energy.',
    climax: 'Peak intensity. The decisive moment. Let the scene reach its crescendo.',
    resolution: 'Wind down. Show consequences, emotional impact, and new equilibrium.',
};

export const PHASE_ALIASES = {
    escalation: 'rising',
    action: 'confrontation',
    afterglow: 'resolution',
};

// ---------------------------------------------------------------------------
// Scene validation
// ---------------------------------------------------------------------------

export function validateScene(scene) {
    if (!scene || typeof scene !== 'object') return 'Scene is not a valid object.';
    if (!scene.title) return 'Scene is missing a title.';
    if (!Array.isArray(scene.beats) || scene.beats.length === 0) return 'Scene has no beats.';

    for (let i = 0; i < scene.beats.length; i++) {
        const b = scene.beats[i];
        if (!b.label) return `Beat ${i + 1} is missing a label.`;
        if (!b.directive) return `Beat ${i + 1} is missing a directive.`;
        if (!b.phase) return `Beat ${i + 1} is missing a phase.`;
        if (!b.tone) return `Beat ${i + 1} is missing a tone.`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Navigation guards
// ---------------------------------------------------------------------------

export function canAdvance(scene, currentBeat) {
    return !!scene && currentBeat < scene.beats.length - 1;
}

export function canRetreat(currentBeat) {
    return currentBeat > 0;
}

// ---------------------------------------------------------------------------
// Prompt injection builder
// ---------------------------------------------------------------------------

function resolvePhase(phase) {
    return PHASE_ALIASES[phase] || phase;
}

export function buildBeatInjection(scene, beatIndex) {
    if (!scene || !scene.beats || !scene.beats[beatIndex]) return '';

    const beat = scene.beats[beatIndex];
    const totalBeats = scene.beats.length;
    const beatNum = beatIndex + 1;

    const elements = beat.key_elements && beat.key_elements.length > 0
        ? `\nIncorporate these details if natural: ${beat.key_elements.join(', ')}.`
        : '';

    const phaseKey = resolvePhase(beat.phase);
    const phaseGuide = PHASE_PROMPTS[phaseKey] || '';

    return [
        `[Scene Director — Beat ${beatNum}/${totalBeats}: "${beat.label}"]`,
        beat.directive,
        elements,
        `Tone: ${beat.tone}.`,
        phaseGuide,
        '[Do NOT copy this instruction into your response. Write naturally as {{char}}.]',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Status formatter
// ---------------------------------------------------------------------------

export function getStatus(scene, currentBeat) {
    if (!scene) return { text: 'No scene is active.', ok: false };

    const beat = scene.beats[currentBeat];
    if (!beat) return { text: 'No scene is active.', ok: false };

    const beatNum = currentBeat + 1;
    const total = scene.beats.length;

    const text = [
        `Scene: ${scene.title}`,
        `Beat ${beatNum}/${total}: ${beat.label} [${beat.phase}]`,
        `Tone: ${beat.tone}`,
        beat.advance_hint ? `Advance when: ${beat.advance_hint}` : '',
    ].filter(Boolean).join('\n');

    return { text, ok: true };
}

// ---------------------------------------------------------------------------
// Scene lifecycle (pure state transitions)
// ---------------------------------------------------------------------------

export function startSceneState(scene) {
    if (!scene) return { state: null, result: { text: 'Scene not found.', ok: false } };
    if (!scene.beats || scene.beats.length === 0) {
        return { state: null, result: { text: `Scene "${scene.title}" has no beats.`, ok: false } };
    }

    const state = { active: true, sceneId: scene.id, currentBeat: 0 };
    const beat = scene.beats[0];
    const result = {
        text: `Scene "${scene.title}" started. Beat 1/${scene.beats.length}: ${beat.label}`,
        ok: true,
    };
    return { state, result };
}

export function advanceBeatState(scene, currentBeat) {
    if (!scene) return { currentBeat, result: { text: 'No scene is active.', ok: false } };

    const nextBeat = currentBeat + 1;
    if (nextBeat >= scene.beats.length) {
        return {
            currentBeat,
            result: { text: 'Already on the final beat. Use /scene-stop or the Stop button to end the scene.', ok: false },
        };
    }

    const beat = scene.beats[nextBeat];
    return {
        currentBeat: nextBeat,
        result: { text: `Beat ${nextBeat + 1}/${scene.beats.length}: ${beat.label}`, ok: true },
    };
}

export function retreatBeatState(scene, currentBeat) {
    if (!scene) return { currentBeat, result: { text: 'No scene is active.', ok: false } };
    if (currentBeat <= 0) {
        return { currentBeat, result: { text: 'Already at the first beat.', ok: false } };
    }

    const prevBeat = currentBeat - 1;
    const beat = scene.beats[prevBeat];
    return {
        currentBeat: prevBeat,
        result: { text: `Beat ${prevBeat + 1}/${scene.beats.length}: ${beat.label}`, ok: true },
    };
}

export function jumpToBeatState(scene, currentBeat, targetBeat) {
    if (!scene) return { currentBeat, result: { text: 'No scene is active.', ok: false } };

    const idx = targetBeat - 1; // 1-indexed input
    if (idx < 0 || idx >= scene.beats.length) {
        return {
            currentBeat,
            result: { text: `Invalid beat number. Must be 1-${scene.beats.length}.`, ok: false },
        };
    }

    const beat = scene.beats[idx];
    return {
        currentBeat: idx,
        result: { text: `Jumped to beat ${targetBeat}/${scene.beats.length}: ${beat.label}`, ok: true },
    };
}

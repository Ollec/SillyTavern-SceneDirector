import { describe, test, expect } from '@jest/globals';
import {
    validateScene,
    buildBeatInjection,
    canAdvance,
    canRetreat,
    getStatus,
    startSceneState,
    advanceBeatState,
    retreatBeatState,
    jumpToBeatState,
    resolvePhasePrompt,
    resolvePhaseColor,
    PHASE_PROMPTS,
    PHASE_ALIASES,
    DEFAULT_PHASE_COLORS,
} from '../src/sceneManager.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeScene(overrides = {}) {
    return {
        id: 'test_scene',
        title: 'Test Scene',
        beats: [
            { label: 'Beat One', phase: 'setup', tone: 'calm', directive: 'Set the scene.', key_elements: ['element1'], advance_hint: 'When ready' },
            { label: 'Beat Two', phase: 'rising', tone: 'tense', directive: 'Build tension.', key_elements: [], advance_hint: '' },
            { label: 'Beat Three', phase: 'climax', tone: 'intense', directive: 'Peak moment.', key_elements: ['a', 'b'], advance_hint: '' },
        ],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// validateScene
// ---------------------------------------------------------------------------

describe('validateScene', () => {
    test('returns null for a valid scene', () => {
        expect(validateScene(makeScene())).toBeNull();
    });

    test('rejects null/undefined', () => {
        expect(validateScene(null)).toBe('Scene is not a valid object.');
        expect(validateScene(undefined)).toBe('Scene is not a valid object.');
    });

    test('rejects non-object', () => {
        expect(validateScene('string')).toBe('Scene is not a valid object.');
    });

    test('rejects missing title', () => {
        expect(validateScene(makeScene({ title: '' }))).toBe('Scene is missing a title.');
    });

    test('rejects empty beats array', () => {
        expect(validateScene(makeScene({ beats: [] }))).toBe('Scene has no beats.');
    });

    test('rejects missing beats field', () => {
        expect(validateScene(makeScene({ beats: undefined }))).toBe('Scene has no beats.');
    });

    test('rejects beat missing label', () => {
        const scene = makeScene();
        scene.beats[1].label = '';
        expect(validateScene(scene)).toBe('Beat 2 is missing a label.');
    });

    test('rejects beat missing directive', () => {
        const scene = makeScene();
        scene.beats[0].directive = '';
        expect(validateScene(scene)).toBe('Beat 1 is missing a directive.');
    });

    test('rejects beat missing phase', () => {
        const scene = makeScene();
        scene.beats[2].phase = '';
        expect(validateScene(scene)).toBe('Beat 3 is missing a phase.');
    });

    test('rejects beat missing tone', () => {
        const scene = makeScene();
        scene.beats[0].tone = '';
        expect(validateScene(scene)).toBe('Beat 1 is missing a tone.');
    });
});

// ---------------------------------------------------------------------------
// canAdvance / canRetreat
// ---------------------------------------------------------------------------

describe('canAdvance', () => {
    const scene = makeScene();

    test('returns true when not on last beat', () => {
        expect(canAdvance(scene, 0)).toBe(true);
        expect(canAdvance(scene, 1)).toBe(true);
    });

    test('returns false on last beat', () => {
        expect(canAdvance(scene, 2)).toBe(false);
    });

    test('returns false with null scene', () => {
        expect(canAdvance(null, 0)).toBe(false);
    });
});

describe('canRetreat', () => {
    test('returns false at beat 0', () => {
        expect(canRetreat(0)).toBe(false);
    });

    test('returns true when past beat 0', () => {
        expect(canRetreat(1)).toBe(true);
        expect(canRetreat(2)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// buildBeatInjection
// ---------------------------------------------------------------------------

describe('buildBeatInjection', () => {
    test('builds injection string with all fields', () => {
        const scene = makeScene();
        const injection = buildBeatInjection(scene, 0);

        expect(injection).toContain('Beat 1/3');
        expect(injection).toContain('"Beat One"');
        expect(injection).toContain('Set the scene.');
        expect(injection).toContain('element1');
        expect(injection).toContain('Tone: calm.');
        expect(injection).toContain(PHASE_PROMPTS.setup);
        expect(injection).toContain('Do NOT copy this instruction');
    });

    test('omits key_elements line when empty', () => {
        const scene = makeScene();
        const injection = buildBeatInjection(scene, 1);

        expect(injection).not.toContain('Incorporate these details');
    });

    test('includes multiple key_elements joined', () => {
        const scene = makeScene();
        const injection = buildBeatInjection(scene, 2);

        expect(injection).toContain('a, b');
    });

    test('returns empty string for invalid index', () => {
        expect(buildBeatInjection(makeScene(), 99)).toBe('');
        expect(buildBeatInjection(makeScene(), -1)).toBe('');
    });

    test('returns empty string for null scene', () => {
        expect(buildBeatInjection(null, 0)).toBe('');
    });

    test('resolves old phase aliases', () => {
        const scene = makeScene();
        scene.beats[0].phase = 'escalation';
        const injection = buildBeatInjection(scene, 0);

        expect(injection).toContain(PHASE_PROMPTS.rising);
    });

    test('handles unknown phase gracefully', () => {
        const scene = makeScene();
        scene.beats[0].phase = 'unknown_phase';
        const injection = buildBeatInjection(scene, 0);

        // Should still produce output, just without phase guidance
        expect(injection).toContain('Beat 1/3');
        expect(injection).toContain('Tone: calm.');
    });

    test('uses scene-level phase prompt when phases defined', () => {
        const scene = makeScene({
            phases: {
                setup: { prompt: 'Custom setup guidance.' },
            },
        });
        const injection = buildBeatInjection(scene, 0);

        expect(injection).toContain('Custom setup guidance.');
        expect(injection).not.toContain(PHASE_PROMPTS.setup);
    });

    test('bypasses aliases when scene defines phases', () => {
        const scene = makeScene({
            phases: {
                escalation: { prompt: 'Build desire and tension.' },
            },
        });
        scene.beats[0].phase = 'escalation';
        const injection = buildBeatInjection(scene, 0);

        expect(injection).toContain('Build desire and tension.');
        expect(injection).not.toContain(PHASE_PROMPTS.rising);
    });
});

// ---------------------------------------------------------------------------
// Phase aliases
// ---------------------------------------------------------------------------

describe('PHASE_ALIASES', () => {
    test('maps old names to new names', () => {
        expect(PHASE_ALIASES.escalation).toBe('rising');
        expect(PHASE_ALIASES.action).toBe('confrontation');
        expect(PHASE_ALIASES.afterglow).toBe('resolution');
    });
});

// ---------------------------------------------------------------------------
// resolvePhasePrompt
// ---------------------------------------------------------------------------

describe('resolvePhasePrompt', () => {
    test('returns scene-level prompt when phases defined', () => {
        const scene = makeScene({ phases: { setup: { prompt: 'Custom.' } } });
        expect(resolvePhasePrompt(scene, 'setup')).toBe('Custom.');
    });

    test('returns global default when no phases key', () => {
        const scene = makeScene();
        expect(resolvePhasePrompt(scene, 'setup')).toBe(PHASE_PROMPTS.setup);
    });

    test('resolves alias when no phases key', () => {
        const scene = makeScene();
        expect(resolvePhasePrompt(scene, 'escalation')).toBe(PHASE_PROMPTS.rising);
    });

    test('bypasses alias when phases key defined', () => {
        const scene = makeScene({ phases: { setup: { prompt: 'Custom.' } } });
        // escalation is not in scene.phases, and aliases are bypassed
        expect(resolvePhasePrompt(scene, 'escalation')).toBe('');
    });

    test('returns empty string for unknown phase', () => {
        const scene = makeScene();
        expect(resolvePhasePrompt(scene, 'mystery')).toBe('');
    });

    test('returns empty string when phase has empty prompt', () => {
        const scene = makeScene({ phases: { setup: { prompt: '' } } });
        expect(resolvePhasePrompt(scene, 'setup')).toBe('');
    });

    test('returns empty string when phase entry has no prompt', () => {
        const scene = makeScene({ phases: { setup: { color: '#fff' } } });
        expect(resolvePhasePrompt(scene, 'setup')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// resolvePhaseColor
// ---------------------------------------------------------------------------

describe('resolvePhaseColor', () => {
    test('returns scene-level color when defined', () => {
        const scene = makeScene({ phases: { setup: { color: '#ff0000' } } });
        expect(resolvePhaseColor(scene, 'setup')).toBe('#ff0000');
    });

    test('returns default color for known phase', () => {
        const scene = makeScene();
        expect(resolvePhaseColor(scene, 'setup')).toBe(DEFAULT_PHASE_COLORS.setup);
    });

    test('returns valid HSL for unknown phase', () => {
        const scene = makeScene();
        const color = resolvePhaseColor(scene, 'mystery');
        expect(color).toMatch(/^hsl\(\d+, 60%, 50%\)$/);
    });

    test('hash color is deterministic', () => {
        const scene = makeScene();
        const color1 = resolvePhaseColor(scene, 'mystery');
        const color2 = resolvePhaseColor(scene, 'mystery');
        expect(color1).toBe(color2);
    });

    test('DEFAULT_PHASE_COLORS covers all 8 known phases', () => {
        const expected = ['setup', 'rising', 'confrontation', 'climax', 'resolution', 'escalation', 'action', 'afterglow'];
        for (const phase of expected) {
            expect(DEFAULT_PHASE_COLORS[phase]).toBeDefined();
        }
    });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe('getStatus', () => {
    test('returns formatted status for active scene', () => {
        const scene = makeScene();
        const result = getStatus(scene, 0);

        expect(result.ok).toBe(true);
        expect(result.text).toContain('Test Scene');
        expect(result.text).toContain('Beat 1/3');
        expect(result.text).toContain('Beat One');
        expect(result.text).toContain('setup');
        expect(result.text).toContain('Tone: calm');
    });

    test('includes advance hint when present', () => {
        const result = getStatus(makeScene(), 0);
        expect(result.text).toContain('Advance when: When ready');
    });

    test('omits advance hint when empty', () => {
        const result = getStatus(makeScene(), 1);
        expect(result.text).not.toContain('Advance when');
    });

    test('returns error for null scene', () => {
        const result = getStatus(null, 0);
        expect(result.ok).toBe(false);
        expect(result.text).toContain('No scene is active');
    });
});

// ---------------------------------------------------------------------------
// startSceneState
// ---------------------------------------------------------------------------

describe('startSceneState', () => {
    test('returns state and success for valid scene', () => {
        const scene = makeScene();
        const { state, result } = startSceneState(scene);

        expect(result.ok).toBe(true);
        expect(result.text).toContain('Test Scene');
        expect(result.text).toContain('Beat 1/3');
        expect(state.active).toBe(true);
        expect(state.currentBeat).toBe(0);
    });

    test('returns error for null scene', () => {
        const { state, result } = startSceneState(null);

        expect(result.ok).toBe(false);
        expect(state).toBeNull();
    });

    test('returns error for scene with no beats', () => {
        const { state, result } = startSceneState(makeScene({ beats: [] }));

        expect(result.ok).toBe(false);
        expect(state).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// advanceBeatState
// ---------------------------------------------------------------------------

describe('advanceBeatState', () => {
    const scene = makeScene();

    test('advances to next beat', () => {
        const { currentBeat, result } = advanceBeatState(scene, 0);

        expect(result.ok).toBe(true);
        expect(currentBeat).toBe(1);
        expect(result.text).toContain('Beat 2/3');
    });

    test('stays on last beat instead of auto-ending', () => {
        const { currentBeat, result } = advanceBeatState(scene, 2);

        expect(result.ok).toBe(false);
        expect(currentBeat).toBe(2);
        expect(result.text).toContain('final beat');
    });

    test('returns error for null scene', () => {
        const { result } = advanceBeatState(null, 0);
        expect(result.ok).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// retreatBeatState
// ---------------------------------------------------------------------------

describe('retreatBeatState', () => {
    const scene = makeScene();

    test('retreats to previous beat', () => {
        const { currentBeat, result } = retreatBeatState(scene, 2);

        expect(result.ok).toBe(true);
        expect(currentBeat).toBe(1);
        expect(result.text).toContain('Beat 2/3');
    });

    test('stays at first beat', () => {
        const { currentBeat, result } = retreatBeatState(scene, 0);

        expect(result.ok).toBe(false);
        expect(currentBeat).toBe(0);
        expect(result.text).toContain('first beat');
    });

    test('returns error for null scene', () => {
        const { result } = retreatBeatState(null, 1);
        expect(result.ok).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// jumpToBeatState
// ---------------------------------------------------------------------------

describe('jumpToBeatState', () => {
    const scene = makeScene();

    test('jumps to valid beat (1-indexed)', () => {
        const { currentBeat, result } = jumpToBeatState(scene, 0, 3);

        expect(result.ok).toBe(true);
        expect(currentBeat).toBe(2);
        expect(result.text).toContain('beat 3/3');
    });

    test('rejects beat 0', () => {
        const { currentBeat, result } = jumpToBeatState(scene, 1, 0);

        expect(result.ok).toBe(false);
        expect(currentBeat).toBe(1); // unchanged
        expect(result.text).toContain('Invalid');
    });

    test('rejects beat beyond range', () => {
        const { currentBeat, result } = jumpToBeatState(scene, 0, 99);

        expect(result.ok).toBe(false);
        expect(currentBeat).toBe(0);
        expect(result.text).toContain('Must be 1-3');
    });

    test('returns error for null scene', () => {
        const { result } = jumpToBeatState(null, 0, 1);
        expect(result.ok).toBe(false);
    });
});

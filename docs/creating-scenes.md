# Creating Scenes

This guide covers how to create scene scripts for Scene Director.

## Quick Start

**Option A: Built-in Editor**
1. Open the Scene Director panel and click the **New** button (file-plus icon)
2. Fill in the scene title, add beats with directives, tones, and phases
3. Click **Save** — the scene is immediately available in the dropdown

**Option B: Import a JSON File**
1. Create a JSON file following the format below (e.g., `my_scene.json`)
2. Click **Import Scene** in the Scene Director panel
3. Select your file — the scene appears immediately in the dropdown

You can also edit existing scenes by selecting them and clicking the **Edit** button (pencil icon), or use the slash commands `/scene-edit`, `/scene-import`.

## Scene File Structure

A scene file contains a title and an array of beats:

```json
{
    "id": "my_scene",
    "title": "My Scene",
    "beats": [
        {
            "label": "The Opening",
            "phase": "setup",
            "tone": "calm, curious",
            "directive": "{{char}} introduces themselves and establishes the setting.",
            "key_elements": ["first impressions", "environment details"],
            "advance_hint": "Once introductions are complete."
        }
    ]
}
```

## Beat Fields

| Field | Required | Description |
|-------|----------|-------------|
| `label` | Yes | Short display name shown in the UI and progress bar |
| `phase` | Yes | Narrative phase — determines color and built-in guidance (see [Phases](#phases)) |
| `tone` | Yes | Emotional/stylistic direction for the AI (e.g., "tense, hushed", "playful, flirtatious") |
| `directive` | Yes | The core instruction telling the AI what should happen in this beat |
| `key_elements` | No | Array of specific details the AI should try to incorporate naturally |
| `advance_hint` | No | Displayed to the user as guidance for when to move to the next beat |

## Phases

Each beat belongs to a narrative phase. Scene Director injects phase-specific guidance alongside your directive:

| Phase | Color | Built-in Guidance |
|-------|-------|-------------------|
| `setup` | Blue | Set the scene. Introduce the environment, characters, and stakes. Do not rush. |
| `rising` | Orange | Build tension and anticipation. Develop conflict or desire through interaction. |
| `confrontation` | Red | The central encounter or challenge is underway. Be vivid and match the energy. |
| `climax` | Purple | Peak intensity. The decisive moment. Let the scene reach its crescendo. |
| `resolution` | Green | Wind down. Show consequences, emotional impact, and new equilibrium. |

You don't have to use all five phases, and you can repeat phases. For example, a slow-burn scene might use `setup`, `rising`, `rising`, `rising`, `climax`, `resolution`.

### Custom Phases

Scenes can define their own phases with custom guidance prompts and colors by adding a top-level `phases` object. This is useful when the default phase names don't fit your scene's narrative arc:

```json
{
    "title": "The Encounter",
    "phases": {
        "setup": { "prompt": "Set the scene. Introduce the characters and the mood." },
        "escalation": { "prompt": "Build desire and tension through meaningful interaction.", "color": "#e8a030" },
        "action": { "prompt": "The main event unfolds. Be vivid and match the energy.", "color": "#e05050" },
        "climax": { "prompt": "Peak intensity. Let the scene reach its crescendo." },
        "afterglow": { "prompt": "Wind down tenderly. Show emotional impact and closeness.", "color": "#50b080" }
    },
    "beats": [ ... ]
}
```

Both `prompt` and `color` are optional within each phase entry:
- **`prompt`** — Guidance text injected alongside the beat directive. If omitted, no phase guidance is added.
- **`color`** — CSS color for the phase bar segment (hex, rgb, hsl). If omitted, the default color is used for known phases, or a deterministic color is generated for new phase names.

When a scene defines `phases`, alias resolution is bypassed — the scene's phase names are used directly. This means `afterglow` stays as `afterglow` rather than being mapped to `resolution`.

### Legacy Phase Names

For scenes that do **not** define a `phases` object, these old phase names are automatically mapped for backward compatibility:

| Old Name | Maps To |
|----------|---------|
| `escalation` | `rising` |
| `action` | `confrontation` |
| `afterglow` | `resolution` |

## Writing Good Directives

### Use Template Variables

SillyTavern replaces `{{char}}` and `{{user}}` with the character and user names:

```json
"directive": "{{char}} confronts {{user}} about the missing documents."
```

### Be Specific About Actions, Not Dialogue

Tell the AI what should *happen*, not what to *say*:

```json
"directive": "{{char}} reveals they knew about the betrayal all along. Their composure cracks for the first time."
```

### Use Tone to Shape Style

The tone field guides the AI's writing style without dictating specific words:

```json
"tone": "barely contained fury, clipped sentences, icy politeness"
```

### Use Key Elements for Details

Key elements are things the AI should weave in naturally, not force:

```json
"key_elements": ["the flickering overhead light", "{{char}}'s habit of tapping the table when nervous"]
```

### Write Advance Hints for the User

Advance hints help the user (not the AI) know when to press Next. Leave empty on the last beat:

```json
"advance_hint": "Once {{char}} has made their offer and {{user}} has responded."
```

## What Gets Injected

When a beat is active, Scene Director injects a prompt block like this into the AI's context:

```
[Scene Director — Beat 2/5: "Testing Boundaries"]
{{char}} begins testing {{user}}'s resolve. They probe for weaknesses...
Incorporate these details if natural: counter-proposals, veiled threats or incentives.
Tone: probing, strategic, increasingly pointed.
Build tension and anticipation. Develop conflict or desire through interaction.
[Do NOT copy this instruction into your response. Write naturally as {{char}}.]
```

The phase guidance line (e.g., "Build tension and anticipation...") comes from the scene's custom `phases` definition if present, otherwise from the built-in defaults. If the phase has no matching prompt, this line is omitted.

The injection depth setting controls how many messages back this appears in the context (default: 1, meaning just before the last message).

## Validation

Scene Director validates scenes when loading. A scene must have:

- A `title` (non-empty string)
- A `beats` array with at least one beat
- Each beat must have: `label`, `directive`, `phase`, and `tone`

If validation fails, the scene won't load and an error will be logged to the browser console.

## Example: The Negotiation

See [scenes/the_negotiation.json](../scenes/the_negotiation.json) for a complete 5-beat example demonstrating all five phases in a tense negotiation scenario.

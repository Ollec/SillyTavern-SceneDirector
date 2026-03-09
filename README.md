# Scene Director

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that guides roleplay scenes through structured narrative beats. Define a scene as a sequence of beats — each with a directive, tone, and phase — and Scene Director injects them into the AI's context as you progress through the story.

## Features

- **Beat-based scene control** — Navigate forward, backward, or jump to any beat
- **Phase-aware prompts** — Five narrative phases (setup, rising, confrontation, climax, resolution) with built-in guidance
- **Per-chat state** — Scene progress is saved per chat, so switching chats won't lose your place
- **Visual progress bar** — Color-coded phase segments show where you are in the scene
- **Slash commands** — Full control from the chat input
- **Advance hints** — Optional hints for when to move to the next beat

## Installation

### Via SillyTavern Extension Installer

Use the install URL:
```
https://github.com/Ollec/SillyTavern-SceneDirector
```

### Manual Installation

Clone into SillyTavern's third-party extensions directory:

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/Ollec/SillyTavern-SceneDirector.git
```

Restart SillyTavern and enable the extension.

## Usage

### UI Controls

Open the **Scene Director** drawer in the extensions panel. Select a scene from the dropdown and press play. Use the Prev/Next/Stop buttons to navigate beats.

### Slash Commands

| Command | Description |
|---------|-------------|
| `/scene-list` | List all available scenes |
| `/scene-start <id>` | Start a scene by ID |
| `/scene-next` | Advance to the next beat |
| `/scene-prev` | Go back one beat |
| `/scene-beat <n>` | Jump to beat number n |
| `/scene-status` | Show current scene and beat info |
| `/scene-stop` | End the current scene |

## Creating Scenes

Scenes are JSON files in the `scenes/` directory. Register them in `scenes/manifest.json`:

```json
{
    "scenes": [
        {
            "id": "my_scene",
            "title": "My Scene",
            "character": "Any",
            "file": "my_scene.json"
        }
    ]
}
```

Each scene file contains a title and an array of beats:

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

### Beat Fields

| Field | Required | Description |
|-------|----------|-------------|
| `label` | Yes | Display name for the beat |
| `phase` | Yes | Narrative phase (see below) |
| `tone` | Yes | Emotional/stylistic tone for the AI |
| `directive` | Yes | Instructions for how the AI should play the beat |
| `key_elements` | No | Details to incorporate naturally |
| `advance_hint` | No | When to move to the next beat |

### Phases

| Phase | Color | Guidance |
|-------|-------|----------|
| `setup` | Blue | Introduce environment, characters, and stakes |
| `rising` | Orange | Build tension, develop conflict or desire |
| `confrontation` | Red | Central encounter or challenge, vivid and energetic |
| `climax` | Purple | Peak intensity, the decisive moment |
| `resolution` | Green | Wind down, consequences, emotional impact |

Use `{{char}}` and `{{user}}` in directives — SillyTavern substitutes them with character and user names.

## Development

### Running Tests

```bash
cd tests
pnpm install
pnpm test
```

### Project Structure

```
├── index.js                 # SillyTavern integration layer
├── src/
│   └── sceneManager.js      # Pure logic (testable, no ST dependencies)
├── director.html            # UI template
├── style.css                # Styling
├── scenes/
│   ├── manifest.json        # Scene registry
│   └── the_negotiation.json # Sample scene
├── tests/
│   └── sceneManager.test.js # Unit tests (Jest)
└── manifest.json            # ST extension metadata
```

## License

MIT

# Minecraft 2

Browser-based voxel sandbox built with TypeScript, Vite, Babylon.js, Web Workers and IndexedDB.

## Features

- Procedural chunked world generation with deterministic seed-based terrain.
- Dynamic chunk loading/unloading around the player.
- Worker-based chunk generation and main-thread mesh building.
- IndexedDB persistence for world metadata, player state, settings and edited chunks.
- Data-driven registries based on `assets/blocks.txt`, `assets/items.json`, `assets/entities.json` and `assets/recipes.json`.
- First-person movement, pointer lock, sprint, crouch, gravity, jumping and basic fall damage.
- Block breaking and placement with item drops and hotbar selection.
- Inventory UI, hotbar HUD, 2x2 inventory crafting and 3x3 crafting table crafting.
- Furnace interaction with fuel, smelting progress and saved furnace state.
- Passive and hostile mobs using the provided entity data, plus a generated Godzilla boss.

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Controls

- `WASD`: move
- `Space`: jump
- `Shift`: crouch
- `Ctrl`: sprint
- Mouse: look
- Left mouse: break blocks / attack mobs
- Right mouse: place blocks / use crafting table / use furnace
- `1-9`: select hotbar slot
- `E`: open or close inventory
- `Esc`: pause

## Data Sources

The gameplay registries are built from the repo data files:

- `assets/blocks.txt`: base block ids used to seed the block registry.
- `assets/items.json`: item registry, stack sizes, categories, durability, textures and block-item relationships.
- `assets/entities.json`: entity registry, mob categories, health, damage, loot, textures and model references.
- `assets/recipes.json`: shaped, shapeless and smelting recipes.

Additional inferred block/items are created only where the source data leaves required gameplay gaps, such as `water`, missing block items, `string`, and `spider_eye`.

## Architecture

- `src/game/data/*`: imports raw asset files and builds the registries.
- `src/game/world/noise.ts`: seeded noise helpers for terrain generation.
- `src/game/workers/world.worker.ts`: procedural chunk generation in a Web Worker.
- `src/game/world/worldManager.ts`: chunk streaming, raycasting, chunk persistence and block entity state.
- `src/game/world/mesher.ts`: visible-face chunk meshing for Babylon meshes.
- `src/game/render/atlas.ts`: runtime block texture atlas generation.
- `src/game/player/controller.ts`: first-person input, movement, collisions and hand/item rendering.
- `src/game/entities/*`: mob visuals, basic AI and item drops.
- `src/game/ui/ui.ts`: menus, HUD, inventory, crafting and furnace UI.
- `src/game/storage/database.ts`: IndexedDB wrapper with separate stores for metadata, player, chunks and settings.
- `src/game/game.ts`: main orchestration loop and game state transitions.

## Save Format

IndexedDB database name: `minecraft2-db`

Stores:

- `meta`: world metadata keyed by `main-world`
- `player`: player position, velocity, health, hotbar, inventory and selected slot
- `chunks`: saved chunk voxel arrays, height maps, biome data and block entities
- `settings`: render distance and mouse sensitivity

Edited chunks are stored as full chunk snapshots so player-built terrain and furnace states restore correctly across reloads.

## Web Worker Usage

Chunk generation is offloaded to `src/game/workers/world.worker.ts`.

The main thread sends:

- world seed
- block code palette
- chunk coordinates to generate

The worker returns:

- voxel block buffer
- surface height map
- biome map
- spawn hints for mobs

This keeps deterministic terrain generation off the render loop while Babylon handles rendering on the main thread.

## Notes

- The current build passes `npm run build`.
- Babylon.js is the heaviest dependency, so the production JS bundle is still large even after narrowing texture imports.
- The game is implemented as a playable vertical slice with extensible systems; some Minecraft-adjacent behaviors are intentionally simplified.

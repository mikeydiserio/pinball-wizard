# Mikey's Pinball Plaza

A three-table browser pinball game built with React, TypeScript, Vite, Three.js, React Three Fiber, and Drei.

## Play locally

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. The game requires WebGL and works with keyboard, mouse, or touch. Audio starts after your first interaction.

| Control | Action |
| --- | --- |
| A / Left arrow | Left flipper |
| D / Right arrow | Right flipper |
| Space | Hold to charge; release to launch |
| N / Up arrow | Nudge; three rapid nudges cause tilt |
| P / Escape | Pause / resume |
| M | Mute / unmute |

Use the on-screen flippers on touch devices. Hold the orange launch button to set launch power.

Hit the reactor bumpers to chain combos. Light the three upper orbit targets to increase your multiplier, up to 5×. Each game has exactly three balls: every drain consumes one, and the third drain ends the game. After each launch, a panel closes behind the ball to prevent it from returning to the spring launcher; it reopens for the next ball. Best scores are stored locally in your browser.

Choose **Space Cadet** for the orbital table's nine ranks and 20 missions. Hit a mission spot target to select orders (all three selects the fourth mission), then pass the purple launch ramp and an engine lane to accept. Three advanced ranks offer new missions, including a bumper field assault, a three-color wormhole survey, and a reactor run. The playfield's bumpers have matching impact lamps. Keep six fuel lights supplied through the fuel chute, fuel targets, or the launch platform's bonus-lane exit. Missions award progress lights; 18 promotes you to the next rank.

Re-entry and engine lanes toggle lights and upgrade their bumper banks from blue to green, yellow, and red. The three yellow drop-target banks award field multipliers (2×, 3×, 5×, 10×), commendations, and timed booster modes. Red radiation and comet spot targets arm the corresponding out-lane kickers. Hyperspace advances through five awards: bonus, jackpot, center post, extra ball available, and gravity well. Open wormholes with their spot target, and rotate the exit color with that target or either white flag.

Automatic replay is available for 30 seconds after deployment; a matching open wormhole earns an additional replay. Replays preserve the ball counter, mission, and table and return the ball to the plunger. Extra balls reset the table without advancing the counter. A normal drain awards an unmultiplied crash bonus. Weak deployments can earn the six-level skill shot; replay balls cannot. The game has no multiball on this table. Blue mission arrows follow the current objective, and the HUD shows selected missions, stage requirements, fuel, and rank progress.

See [Space Cadet rule notes](docs/space-cadet-rules.md) for interpretation choices where the supplied guide contradicts itself.

Choose **Eruption** for a volcano table with its own layout. It has the same number of missions, targets, lights, and rule systems as Space Cadet, all reworked. A right-hand lava ramp climbs to a raised caldera, and a wire habitrail brings the ball back down. Hit a survey target to plan one of 17 expeditions, then ramp up to the caldera to set out. Keep six pressure lights up: they bleed faster as they fall. Heat the vent bumpers through the summit lanes, chase the five-stage crater eruption, and earn 18 heat lights per promotion from Ash Scout to Volcano Lord. See the [Eruption rule sheet](docs/volcano-rules.md) for what changed.

Settings offer an angled perspective or overhead camera, high or balanced graphics, and a light or dark interface. Table selection, camera, graphics, interface, and mute preferences are saved locally. Each table has synthesized music, positional impact sounds, rolling-ball audio, and plunger tension. The game pauses when the browser loses focus. Reduced-motion preferences disable camera follow/shake, trails, particles, slow-motion celebrations, and animated score counting.

The live dot-matrix display shows table instructions and awards; status lamps track the current ball, multiplier, combos, replay availability, and mission progress. High graphics adds anti-aliased bloom and tone mapping. Balanced keeps the same camera and playable geometry with fewer rendering effects.

## Build

```sh
pnpm build
pnpm preview
```

The static production app is emitted to `dist/`. No server, API keys, remote models, image downloads, or account is needed. Fonts are self-hosted; playfield art and audio are generated locally.

## Source layout

- `src/App.tsx`: interface, controls, settings, and game lifecycle.
- `src/components/GameScene.tsx`: camera, lighting, effects, ball, and flippers.
- `src/components/sceneKit.tsx`: shared camera fitting, ball rendering, lighting, and effects.
- `src/ui/FlightDeck.tsx`: live score/status display, mission progress, launch controls, and game-flow overlays.
- `src/boards/spaceCadet/`: Space Cadet simulation, rules, layout, artwork, and table rendering.
- `src/boards/volcano/`: Eruption simulation, expeditions, layout, artwork, and table rendering.
- `src/components/PinballTable.tsx`: cabinet and collider-aligned hardware.
- `src/components/tableTextures.ts`: procedural illustrated playfield.
- `src/game/physics.ts`: deterministic 240 Hz table simulation.
- `src/game/audio.ts`: reactive Web Audio synthesis.

Optional physics regression checks are available with `pnpm test`.

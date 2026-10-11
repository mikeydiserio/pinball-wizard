# Eruption rule sheet

Eruption keeps only the house-standard parts of Space Cadet: the cabinet shell, flippers, slingshots, out-lanes, and plunger chute. The rest of the playfield, and everything you score, chase, and light, is new. The element counts match Space Cadet one for one, and the parity tests in `src/boards/volcano/rules.test.ts` enforce this.

## Layout

| Area | Space Cadet | Eruption |
| --- | --- | --- |
| Crown | Asymmetric, with a bumper pocket at upper left | Symmetric volcanic dome |
| Raised deck | Launch platform on the left side | Caldera at top center, holding three lava fountains and three crater lanes |
| Ramp | U-turn on the left side | Lava ramp up the right side, swinging onto the caldera |
| Deck exit | Enclosed drop into the left bonus lane | Wire habitrail down to the right inlane, which holds the bonus lane |
| Six-light chute | Fuel chute under the left deck | Pressure gauge up the right orbit, with a deflector at its foot |
| Center | Bumper triangle, with the gravity well low and center | Magma chamber in the upper middle, crater saucer above it, and a conduit painted between them |
| Bumpers | Attack triangle at center, satellite in the crown pocket | Vent cluster at lower left, boulder bumper at upper left |
| Top lanes | Re-entry lanes at top center | Summit lanes under the upper-left crown |
| Rank lights | Ring around the gravity well | Row of nine flames above the flippers |
| Orbit chase | Runs left to right, against the plunger shot | Runs up the right, across the crown, and down the left, following the ball |

| Space Cadet | Eruption | Count |
| --- | --- | --- |
| Missions | Expeditions | 17 |
| Ranks (Cadet → Fleet Admiral) | Ash Scout → Volcano Lord | 9 |
| Attack bumpers + satellite | Vent bumpers + boulder bumper | 4 |
| Engine bumpers on the launch deck | Lava fountains on the caldera | 3 |
| Fuel, mission, wormhole, radiation, and comet targets | Pressure, survey, tube, ash, and lava bomb targets | 13 |
| Multiplier, medal, and booster drop banks | Fissure, geology badge, and booster banks | 9 |
| Fuel lights, fuel chute | Pressure gauge, pressure chute | 6 |
| Re-entry lanes, engine lanes | Summit lanes, crater lanes | 3 + 3 |
| Flags | Ash vanes | 2 |
| Hyperspace kicker, black hole, escape chute | Summit crater, lava lake, escape tunnel | 3 |
| Wormholes (green, red, yellow) | Lava tubes (magma, obsidian, sulfur) | 3 |
| Gravity well | Magma chamber | 1 |
| Playfield inserts | Playfield inserts (lava palette, new shapes) | Same total |

## How a game flows

1. Hit a survey target to plan one of the four expeditions offered at your rank. Hit all three to plan the fourth.
2. Shoot the right-hand ramp up to the caldera to set out, as long as pressure remains.
3. Complete each stage. Teal arrows point to the next objective.
4. Each completed expedition adds heat lights. At 18, you are promoted.

## Rules that changed

| System | Space Cadet | Eruption |
| --- | --- | --- |
| Timed resource | Fuel drains 10 s at full, slowing to 20 s for the last light | Pressure bleeds 18 s at full, speeding up to 8 s for the last light. First bleed is 12 s after launch. |
| Ball save | Auto replay for 30 s | Lava shield for 25 s |
| Field multiplier | 2×, 3×, 5×, 10× with a 60 s cooldown | 2×, 4×, 6×, 8× with a 45 s cooldown |
| Bumper upgrades | Blue → green → yellow → red, 60 s | Ember → flame → sulfur → white-hot, 45 s |
| Bumper values | Attack 500 + 500/level, satellite and engine 1,500 + 1,000/level | Vent 750 + 750/level, boulder 2,500 + 1,250/level, fountain 1,000 + 1,000/level |
| Medal bank | 10,000, then 50,000, then extra ball | Geology badges: 25,000, then 75,000, then extra ball |
| Booster order | Flags, jackpot, bonus, bonus hold | Jackpot, ash vanes, bonus, bonus lock |
| Big kicker ladder | Hyperspace: bonus, jackpot, center post, extra ball, gravity well | Crater eruption: ash cloud, obsidian post, magma jackpot, magma chamber, molten core extra ball (15k / 25k / 40k / 75k / 200k) |
| Well capture | Gravity well, 50,000 | Magma chamber, 75,000 |
| Skill shot | 15k, 30k, 75k, 30k, 15k, 7.5k | 10k, 25k, 50k, 100k, 50k, 25k (peaks at the fourth light) |
| Tube/wormhole | 2,000 closed, 5,000 matching (+ replay), 7,500 other | 2,500 closed, 6,000 matching (+ replay), 9,000 other |
| Base pools | Bonus 10,000, jackpot 20,000, bonus cap 5,000,000 | Bonus 15,000, jackpot 25,000, bonus cap 6,000,000 |
| Lane values | Re-entry 2,000, engine 500, lit return 25,000, out-lane 20,000 | Summit 2,500, crater 750, lit return 30,000, out-lane 15,000 |

## Expeditions

| Rank | Expeditions offered (survey target order) |
| --- | --- |
| Ash Scout | Seismograph Calibration · Trailhead Climb · Vent Survey · Rock Sampling |
| Lava Runner, Crater Ranger | Ash Cleanup · Lava Tube Scouting · Boulder Run · Three Rivers |
| Vent Warden, Magma Diver | Lava Bomb Shelter · Ashfall Warning · Fountain Dive · Pyroclastic Flow |
| Caldera Captain, Pyroclast Commander | Fumarole Mapping · Magma Chamber Probe · Rim Patrol · Tremor |
| Fire Marshal, Volcano Lord | Ashfall Warning · Three Rivers · Tremor · Cataclysm |

These expeditions keep the special roles of their Space Cadet slots:

- **Lava Tube Scouting:** the ash vanes must be superheated first.
- **Magma Chamber Probe:** the vents must be heated first.
- **Fountain Dive:** the lava fountains must be raised first.
- **Three Rivers:** the sulfur, magma, and obsidian tubes must be entered in that order.
- **Tremor:** climb the rim ramp to rise one rank, or go into the crater to fall one.
- **Cataclysm:** an eight-stage finale. Completing it lights every award bank at once.

Losing all pressure aborts the active expedition.

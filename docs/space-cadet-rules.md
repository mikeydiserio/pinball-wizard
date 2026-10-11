# Space Cadet reference alignment

The supplied table, messages, missions, secondary objectives, and awards text is the rule source. The local 3D table retains its world scale and cabinet design; it is not a pixel-identical recreation of the original game.

## Implemented rules

- Seven bumpers: three attack, one satellite, and three elevated engine bumpers. Independent timed upgrades use the reference's four colors and point values.
- Thirteen red spot targets: fuel, mission, radiation, comet, and wormhole. Nine yellow drop targets: multiplier, medal, and booster banks.
- Six fuel rollovers, space warp, three engine lanes, three re-entry lanes, bonus lane, return lanes, out-lanes, and a skill-shot exit from the deployment chute.
- Nine kickers: black hole, gravity well, hyperspace, two out-lane kickbacks, secondary out kicker, and three wormholes. Kickbacks return through their prescribed chutes; the elevated platform exits through the bonus lane.
- Six deployment lights, six fuel lights, four hyperspace lights, four multiplier lights, four booster lights, three medal lights, nine rank lights, 18 progress lights, wormhole exit arrows, and objective-specific blue mission arrows.
- All 20 missions, selected by rank and mission target; ordered stages, acceptance/completion awards, upgrade prerequisites, fuel aborts, and 18-light promotions. The second rank in each middle mission tier offers an advanced objective.
- Field points multiply; mission awards, accumulated bonus, and jackpot payouts do not. Bonus/jackpot pools accumulate base points while their booster modes are active. Bonus is capped at 5,000,000.
- Automatic and wormhole replays preserve the table and mission. Extra balls reset table awards without consuming the numbered ball. Tilt removes replay and crash bonus eligibility but preserves earned extra balls.

## Conflicting or approximate details

The detailed table or mission entry takes priority over contradictory summaries:

| Topic | Interpretation |
| --- | --- |
| Time Warp forward | 12 progress lights and one immediate rank, plus a promotion if progress reaches 18. The secondary-objective summary's 9-light value is not used. |
| Time Warp backward | One-rank demotion, no new progress, previously earned progress retained, as stated in the mission notes. |
| Rank completion | Progress lights clear on promotion, including any overrun. No drain/early-acceptance rank-skipping exploits. Fleet Admiral continues playing. |
| Matching open wormhole | 5,000 total field points and a replay, following the table entry rather than the awards summary's 2,500. |
| Hyperspace reflex | +20,000 in addition to that hyperspace award. Ramp reflex is 25,000 total. |
| Automatic replay | Preserves table state, as specified in Replay Ball and Mission Basics; the contradictory Re-Deploy message note saying it resets is not used. |
| Timing | Bumper, medal, multiplier, booster, hyperspace, post, and extra-ball windows use 60 seconds. Fuel intervals are 10/12/14/16/18/20 seconds (90 total). Reflex windows use 8 seconds because no exact duration is specified. |
| Fuel at serve | A fresh ball begins with six fuel lights. Replay retains remaining fuel. |
| Maelstrom completion | Lights the medal, booster, multiplier, and hyperspace banks and grants the associated awards. |

The simulation uses deterministic fixed steps and guided motion for ramps and kickouts. Tests cover scoring, ordered objectives, timer boundaries, replay/reset behavior, weak launches, kickback routing, raised geometry, and randomized ball containment. Browser rendering still needs a visual review when a connected browser is available.

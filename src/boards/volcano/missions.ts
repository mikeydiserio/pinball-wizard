export type ExpeditionKind =
  | 'ramp' | 'summit' | 'vent' | 'boulder' | 'drop' | 'spot' | 'target' | 'lane' | 'out' | 'vanes'
  | 'fumarole' | 'pressure' | 'tube' | 'sulfur' | 'magma' | 'obsidian' | 'crater' | 'lavaLake'
  | 'ash' | 'bomb' | 'rebound' | 'tremor'
export interface ExpeditionStep { kind: ExpeditionKind; goal: number; brief: string; requires?: 'vents' | 'fountains' | 'vanes' }
export interface Expedition { name: string; accept: number; award: number; progress: number; steps: readonly ExpeditionStep[]; goal: number; brief: string }
const step = (kind: ExpeditionKind, goal: number, brief: string, requires?: ExpeditionStep['requires']): ExpeditionStep => ({ kind, goal, brief, requires })
const expedition = (name: string, accept: number, award: number, progress: number, ...steps: ExpeditionStep[]): Expedition => ({ name, accept, award, progress, steps, goal: steps.reduce((sum, s) => sum + s.goal, 0), brief: steps[0].brief })

/**
 * Seventeen expeditions, one per Space Cadet mission slot. Slots 5, 7, 15, and 16
 * keep their special roles (upgrade gate, ordered tubes, tremor, finale).
 */
export const EXPEDITIONS: readonly Expedition[] = [
  expedition('Seismograph Calibration', 10_000, 400_000, 6, step('rebound', 6, 'Shake the slingshots')),
  expedition('Trailhead Climb', 10_000, 500_000, 6, step('ramp', 2, 'Climb the crater rim ramp')),
  expedition('Vent Survey', 10_000, 500_000, 6, step('vent', 10, 'Probe the vent bumpers')),
  expedition('Rock Sampling', 15_000, 750_000, 9, step('drop', 6, 'Chip drop targets'), step('summit', 1, 'Carry samples through a summit lane')),
  expedition('Ash Cleanup', 20_000, 750_000, 7, step('vanes', 30, 'Spin the ash vanes')),
  expedition('Lava Tube Scouting', 20_000, 800_000, 7, step('tube', 2, 'Superheat the vanes, then enter lava tubes', 'vanes')),
  expedition('Boulder Run', 20_000, 800_000, 7, step('boulder', 2, 'Hit the boulder bumper'), step('ramp', 1, 'Escape up the rim ramp')),
  expedition('Three Rivers', 30_000, 1_500_000, 10, step('sulfur', 1, 'Enter the sulfur tube'), step('magma', 1, 'Enter the magma tube'), step('obsidian', 1, 'Enter the obsidian tube')),
  expedition('Lava Bomb Shelter', 20_000, 1_000_000, 8, step('bomb', 1, 'Fill the right lava bomb bank'), step('lavaLake', 1, 'Dive into the lava lake')),
  expedition('Ashfall Warning', 20_000, 1_000_000, 8, step('ash', 1, 'Fill the left ash bank'), step('fumarole', 1, 'Vent through the fumarole')),
  expedition('Fountain Dive', 25_000, 1_100_000, 8, step('lavaLake', 1, 'Raise the fountains, then dive into the lava lake', 'fountains')),
  expedition('Pyroclastic Flow', 30_000, 1_750_000, 11, step('lane', 12, 'Race through any lane'), step('crater', 1, 'Outrun it into the crater')),
  expedition('Fumarole Mapping', 20_000, 1_250_000, 9, step('fumarole', 2, 'Map the fumarole'), step('pressure', 1, 'Reach the top pressure rollover')),
  expedition('Magma Chamber Probe', 25_000, 1_250_000, 9, step('vent', 10, 'Heat the vents, then probe the vent bumpers', 'vents')),
  expedition('Rim Patrol', 20_000, 1_250_000, 9, step('target', 12, 'Clear spot or drop targets'), step('out', 1, 'Patrol an out-lane')),
  expedition('Tremor', 30_000, 2_000_000, 12, step('rebound', 20, 'Rattle the slingshots'), step('tremor', 1, 'Ramp to rise; crater to fall')),
  expedition('Cataclysm', 40_000, 6_000_000, 18, step('summit', 3, 'Pass summit lanes'), step('drop', 3, 'Hit drop targets'), step('vanes', 10, 'Spin the ash vanes'), step('tube', 1, 'Enter a lava tube'), step('lavaLake', 1, 'Dive into the lava lake'), step('ramp', 1, 'Climb the rim ramp'), step('pressure', 1, 'Reach the top pressure rollover'), step('crater', 1, 'Crater to unleash the eruption')),
]

export function expeditionsForRank(rank: number): readonly number[] {
  if (rank === 0) return [0, 1, 2, 3]
  if (rank < 3) return [4, 5, 6, 7]
  if (rank < 5) return [8, 9, 10, 11]
  if (rank < 7) return [12, 13, 14, 15]
  return [9, 7, 15, 16]
}

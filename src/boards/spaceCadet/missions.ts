export type MissionKind = 'ramp' | 'reentry' | 'bumper' | 'satellite' | 'drop' | 'spot' | 'target' | 'lane' | 'out' | 'flags' | 'spaceWarp' | 'fuel' | 'wormhole' | 'yellow' | 'red' | 'green' | 'hyperspace' | 'blackHole' | 'radiation' | 'comet' | 'rebound' | 'timeWarp'
export interface MissionStep { kind: MissionKind; goal: number; brief: string; requires?: 'attack' | 'engine' | 'flags' }
export interface Mission { name: string; accept: number; award: number; progress: number; steps: readonly MissionStep[]; goal: number; brief: string }
const step = (kind: MissionKind, goal: number, brief: string, requires?: MissionStep['requires']): MissionStep => ({ kind, goal, brief, requires })
const mission = (name: string, accept: number, award: number, progress: number, ...steps: MissionStep[]): Mission => ({ name, accept, award, progress, steps, goal: steps.reduce((sum, s) => sum + s.goal, 0), brief: steps[0].brief })

export const MISSIONS: readonly Mission[] = [
  mission('Launch Training', 10_000, 500_000, 6, step('ramp', 3, 'Pass the launch ramp')),
  mission('Re-entry Training', 10_000, 500_000, 6, step('reentry', 3, 'Pass the re-entry lanes')),
  mission('Target Practice', 10_000, 500_000, 6, step('bumper', 8, 'Hit attack bumpers')),
  mission('Science Mission', 10_000, 750_000, 9, step('drop', 9, 'Hit drop targets')),
  mission('Bug Hunt Mission', 20_000, 750_000, 7, step('target', 15, 'Hit spot or drop targets')),
  mission('Rescue Mission', 20_000, 750_000, 7, step('hyperspace', 1, 'Upgrade flags, then enter hyperspace', 'flags')),
  mission('Alien Menace Mission', 20_000, 750_000, 7, step('bumper', 8, 'Upgrade weapons, then hit attack bumpers', 'attack')),
  mission('Secret Mission', 30_000, 1_500_000, 10, step('yellow', 1, 'Enter the yellow wormhole'), step('red', 1, 'Enter the red wormhole'), step('green', 1, 'Enter the green wormhole')),
  mission('Stray Comet Mission', 20_000, 1_000_000, 8, step('comet', 1, 'Fill the right hazard bank'), step('hyperspace', 1, 'Enter the hyperspace kicker')),
  mission('Space Radiation Mission', 20_000, 1_000_000, 8, step('radiation', 1, 'Fill the left hazard bank'), step('wormhole', 1, 'Enter any wormhole')),
  mission('Black Hole Mission', 20_000, 1_000_000, 8, step('blackHole', 1, 'Upgrade engines, then enter the black hole', 'engine')),
  mission('Cosmic Plague Mission', 30_000, 1_750_000, 11, step('flags', 75, 'Spin flags'), step('spaceWarp', 1, 'Hit the space warp rollover')),
  mission('Satellite Retrieval Mission', 20_000, 1_250_000, 9, step('satellite', 3, 'Hit the satellite bumper')),
  mission('Recon Mission', 20_000, 1_250_000, 9, step('lane', 15, 'Pass any lane')),
  mission('Doomsday Machine Mission', 20_000, 1_250_000, 9, step('out', 3, 'Pass the out-lanes')),
  mission('Time Warp Mission', 30_000, 2_000_000, 12, step('rebound', 25, 'Hit rebounds'), step('timeWarp', 1, 'Ramp to promote; hyperspace to demote')),
  mission('Maelstrom', 30_000, 5_000_000, 18, step('drop', 3, 'Hit drop targets'), step('spot', 3, 'Hit spot targets'), step('lane', 5, 'Pass lanes'), step('fuel', 1, 'Reach the top fuel rollover'), step('ramp', 1, 'Pass the launch ramp'), step('flags', 1, 'Spin a flag'), step('wormhole', 1, 'Enter a wormhole'), step('hyperspace', 1, 'Hyperspace to end Maelstrom')),
  mission('Bumper Squadron', 20_000, 1_250_000, 9, step('bumper', 12, 'Clear the attack bumper field')),
  mission('Wormhole Survey', 20_000, 1_500_000, 10, step('yellow', 1, 'Survey the yellow wormhole'), step('red', 1, 'Survey the red wormhole'), step('green', 1, 'Survey the green wormhole')),
  mission('Reactor Run', 20_000, 1_500_000, 10, step('drop', 6, 'Clear two drop banks'), step('bumper', 10, 'Charge the attack bumpers')),
]

export function missionsForRank(rank: number): readonly number[] {
  if (rank === 0) return [0, 1, 2, 3]
  if (rank === 1) return [4, 5, 6, 7]
  if (rank === 2) return [4, 5, 17, 7]
  if (rank === 3) return [8, 9, 10, 11]
  if (rank === 4) return [8, 18, 10, 11]
  if (rank === 5) return [12, 13, 14, 15]
  if (rank === 6) return [12, 13, 19, 15]
  return [11, 7, 15, 16]
}

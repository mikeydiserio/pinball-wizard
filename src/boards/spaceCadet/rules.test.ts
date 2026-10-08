import { describe, expect, it } from 'vitest'
import { MISSIONS, missionsForRank } from './missions'
import { SpaceCadetGame } from './game'
import { BUMPERS, BALL_Y, SERVE } from './layout'

// Isolate rules from ball trajectories; game.test.ts verifies physical collisions
// dispatch into these same handlers. Bracket access retains TypeScript signatures.
function bank(game: SpaceCadetGame, start: number) {
  for (let index = start; index < start + 3; index++) game['hitDrop'](index)
}

function resetDrops(game: SpaceCadetGame) {
  for (let i = 0; i < 8; i++) game.update(.1)
}

function accept(game: SpaceCadetGame, mission: number) {
  game['patch']({ selectedMission: mission, missionReady: true })
  game['awardRamp']()
}

function bump(game: SpaceCadetGame, index: number) {
  const bumper = BUMPERS[index]
  Object.assign(game.ball, { x: bumper.x, z: bumper.z + bumper.radius + .15, y: BALL_Y + bumper.elevation, vx: 0, vz: -8 })
  game['elapsed'] += .11
  game['collideBumper'](index)
}

describe('rank-specific mission selection', () => {
  it.each([
    [0, ['Launch Training', 'Re-entry Training', 'Target Practice', 'Science Mission']],
    [1, ['Bug Hunt Mission', 'Rescue Mission', 'Alien Menace Mission', 'Secret Mission']],
    [2, ['Bug Hunt Mission', 'Rescue Mission', 'Alien Menace Mission', 'Secret Mission']],
    [3, ['Stray Comet Mission', 'Space Radiation Mission', 'Black Hole Mission', 'Cosmic Plague Mission']],
    [4, ['Stray Comet Mission', 'Space Radiation Mission', 'Black Hole Mission', 'Cosmic Plague Mission']],
    [5, ['Satellite Retrieval Mission', 'Recon Mission', 'Doomsday Machine Mission', 'Time Warp Mission']],
    [6, ['Satellite Retrieval Mission', 'Recon Mission', 'Doomsday Machine Mission', 'Time Warp Mission']],
    [7, ['Cosmic Plague Mission', 'Secret Mission', 'Time Warp Mission', 'Maelstrom']],
    [8, ['Cosmic Plague Mission', 'Secret Mission', 'Time Warp Mission', 'Maelstrom']],
  ])('offers the reference missions in target order for rank %i', (rank, names) => {
    expect(missionsForRank(rank as number).map(index => MISSIONS[index].name)).toEqual(names)
  })
})

describe('Space Cadet scoring and awards', () => {
  it.each([15_000, 30_000, 75_000, 30_000, 15_000, 7500].map((points, index) => [points, index]))('awards %i points at deployment level index %i', (points, index) => {
    const game = new SpaceCadetGame()
    game.startCharge(); game.releaseCharge()
    game['currentState'].deploymentLights = index + 1
    Object.assign(game.ball, { x: SERVE.x, z: 4.7, vx: 0, vz: 1 })
    game.update(1 / 240)
    expect(game.getSnapshot().score).toBe(points)
    expect(game.ball.x).toBeLessThan(2.85)
  })

  it('leaves the gravity well inert until its fifth-hyperspace award and normalizes after capture', () => {
    const game = new SpaceCadetGame()
    game.startCharge(); game.releaseCharge()
    Object.assign(game.ball, { x: -.25, z: 2.05, vx: 0, vz: 0 })
    game['checkCaptures']()
    expect(game.getSnapshot().score).toBe(0)
    expect(game['capture']).toBeNull()
    game.gravityActive = true
    game['elapsed'] = 1
    game['checkCaptures']()
    expect(game.getSnapshot().score).toBe(50_000)
    expect(game.gravityActive).toBe(false)
    expect(game['capture']).toMatchObject({ kind: 'well' })
  })

  it('consumes each bonus-lane award once and resets all game state on a new game', () => {
    const game = new SpaceCadetGame()
    game['bonusLit'] = true
    game['bonusValue'] = 200_000
    game['boosterUntil'][3] = 60
    game['hitRollover'](5)
    game['hitRollover'](5)
    expect(game.getSnapshot().score).toBe(230_000)
    game['patch']({ rank: 7, rankProgress: 11, extraBalls: 4 })
    game.newGame()
    expect(game.getSnapshot()).toMatchObject({ score: 0, rank: 0, rankProgress: 0, extraBalls: 0, fuel: 6 })
    expect(game['bonusValue']).toBe(10_000)
    expect(game['boosterUntil']).toEqual([0, 0, 0, 0])
  })

  it('selects the last mission target hit and the fourth mission when all three are lit', () => {
    const game = new SpaceCadetGame()
    game['hitTarget'](4)
    expect(game.getSnapshot()).toMatchObject({ selectedMission: 1, missionReady: true, mission: null, score: 1000 })
    game['hitTarget'](3)
    expect(game.getSnapshot().selectedMission).toBe(0)
    game['hitTarget'](5)
    expect(game.getSnapshot()).toMatchObject({ selectedMission: 3, score: 3000 })
    expect(game.targetLit.slice(3, 6)).toEqual([false, false, false])
  })

  it.each([[7, 0], [10, 1]])('arms only the corresponding kicker from hazard bank %i', (start, side) => {
    const game = new SpaceCadetGame()
    game['hitTarget'](start)
    game['hitTarget'](start + 1)
    expect(game.kickersArmed).toEqual([false, false])
    game['hitTarget'](start + 2)
    expect(game.kickersArmed[side]).toBe(true)
    expect(game.kickersArmed[1 - side]).toBe(false)
    expect(game.getSnapshot().score).toBe(2250)
    expect(game.dropsDown.every(down => !down)).toBe(true)
  })

  it('awards multiplier banks in 2x, 3x, 5x, 10x order and multiplies the completing hit', () => {
    const game = new SpaceCadetGame()
    let expectedScore = 0
    for (const [previous, next] of [[1, 2], [2, 3], [3, 5], [5, 10], [10, 10]]) {
      bank(game, 0)
      expectedScore += 1000 * previous + 1500 * next
      expect(game.getSnapshot()).toMatchObject({ multiplier: next, score: expectedScore })
      game['hitDrop'](2)
      expect(game.getSnapshot().score).toBe(expectedScore)
      resetDrops(game)
      expect(game.dropsDown.slice(0, 3)).toEqual([false, false, false])
    }
  })

  it('awards two medal scores, then repeatable extra balls without a third-level score', () => {
    const game = new SpaceCadetGame()
    const totals = [13_000, 66_000, 69_000, 72_000]
    totals.forEach((score, index) => {
      bank(game, 3)
      expect(game.getSnapshot()).toMatchObject({ score, extraBalls: Math.max(0, index - 1) })
      expect(game.medalLevel).toBe(Math.min(3, index + 1))
      resetDrops(game)
    })
  })

  it('activates booster modes in order and accumulates base points without multiplying bonus and jackpot pools', () => {
    const game = new SpaceCadetGame()
    for (let stage = 0; stage < 4; stage++) {
      bank(game, 6)
      expect(Array.from({ length: 4 }, (_, i) => game.lightLevel('booster', i))).toEqual([0, 1, 2, 3].map(i => i <= stage ? 1 : 0))
      resetDrops(game)
    }
    game['patch']({ multiplier: 5 })
    const bonus = game['bonusValue'], jackpot = game['jackpotValue'], score = game.getSnapshot().score
    game['hitTarget'](0)
    expect(game.getSnapshot().score - score).toBe(3750)
    expect(game['bonusValue'] - bonus).toBe(750)
    expect(game['jackpotValue'] - jackpot).toBe(750)
    game['bonusValue'] = 4_999_900
    game['hitTarget'](1)
    expect(game['bonusValue']).toBe(5_000_000)
  })

  it.each([false, true])('preserves accrued bonus on table reset only when bonus hold is %s', held => {
    const game = new SpaceCadetGame()
    game['bonusValue'] = 123_000
    game['jackpotValue'] = 87_000
    if (held) game['boosterUntil'][3] = 60
    game['resetTable']()
    expect(game['bonusValue']).toBe(held ? 123_000 : 10_000)
    expect(game['jackpotValue']).toBe(20_000)
    expect(game.lightLevel('booster', 3)).toBe(0)
  })

  it.each([0, 1, 2, 3])('scores attack, satellite and engine bumpers at upgrade level %i', level => {
    const game = new SpaceCadetGame()
    game.attackLevel = game.engineLevel = level
    bump(game, 1)
    bump(game, 0)
    bump(game, 4)
    const expected = 500 + level * 500 + 2 * (1500 + level * 1000)
    expect(game.getSnapshot()).toMatchObject({ score: expected, hits: 3 })
    expect(game.consumeEvents().filter(event => event.type === 'bumper').map(event => event.value)).toEqual([500 + level * 500, 1500 + level * 1000, 1500 + level * 1000])
  })

  it('toggles lane lights and upgrades attack and engine banks independently', () => {
    const game = new SpaceCadetGame()
    game['hitReentry'](0)
    game['hitReentry'](0)
    expect(game.reentryLit).toEqual([false, false, false])
    for (let index = 0; index < 3; index++) game['hitReentry'](index)
    expect([game.attackLevel, game.engineLevel]).toEqual([1, 0])
    for (let index = 0; index < 3; index++) game['hitEngine'](index)
    expect([game.attackLevel, game.engineLevel]).toEqual([1, 1])
    expect(game.reentryLit).toEqual([false, false, false])
    expect(game.engineLit).toEqual([false, false, false])
    expect(game.getSnapshot().score).toBe(11_500)
  })

  it('rotates both lane light sets once per flipper press, in opposite directions', () => {
    const game = new SpaceCadetGame()
    game.startCharge(); game.releaseCharge()
    game['hitReentry'](0); game['hitEngine'](1)
    game.setFlipper('left', true)
    expect(game.reentryLit).toEqual([false, false, true])
    expect(game.engineLit).toEqual([true, false, false])
    game.setFlipper('left', true)
    expect(game.reentryLit).toEqual([false, false, true])
    game.setFlipper('right', true)
    expect(game.reentryLit).toEqual([true, false, false])
    expect(game.engineLit).toEqual([false, true, false])
  })

  it('downgrades bumpers one level at 60 seconds and refreshes the timer at maximum level', () => {
    const game = new SpaceCadetGame()
    for (let upgrade = 0; upgrade < 3; upgrade++) for (let lane = 0; lane < 3; lane++) game['hitReentry'](lane)
    game['elapsed'] = 59.99
    game['updateAwards']()
    expect(game.attackLevel).toBe(3)
    for (let lane = 0; lane < 3; lane++) game['hitReentry'](lane)
    game['elapsed'] = 60
    game['updateAwards']()
    expect(game.attackLevel).toBe(3)
    game['elapsed'] = game['attackUntil'] - .001
    game['updateAwards']()
    expect(game.attackLevel).toBe(3)
    game['elapsed'] = game['attackUntil']
    game['updateAwards']()
    expect(game.attackLevel).toBe(2)
  })

  it('lights both return lanes with zero-point space warp and consumes each award separately', () => {
    const game = new SpaceCadetGame()
    game['hitRollover'](3)
    expect(game.getSnapshot().score).toBe(0)
    expect(game.returnLit).toEqual([true, true])
    game['hitRollover'](6)
    expect(game.getSnapshot().score).toBe(25_000)
    expect(game.returnLit).toEqual([false, true])
    game['hitRollover'](6); game['hitRollover'](7)
    expect(game.getSnapshot().score).toBe(55_000)
    expect(game.returnLit).toEqual([false, false])
  })

  it('advances five hyperspace awards with a separate unmultiplied jackpot', () => {
    const game = new SpaceCadetGame()
    game['patch']({ multiplier: 2 })
    const totals = [20_000, 80_000, 120_000, 220_000, 520_000]
    totals.forEach((score, index) => {
      game['awardSaucer'](0)
      expect(game.getSnapshot()).toMatchObject({ score, hyperspace: (index + 1) % 5, extraBalls: 0 })
    })
    expect(game.gravityActive).toBe(true)
    expect(game['centerPostUntil']).toBe(60)
    game['hitRollover'](4)
    expect(game.getSnapshot().extraBalls).toBe(1)
    game['hitRollover'](8)
    expect(game.getSnapshot().extraBalls).toBe(1)
  })

  it.each([
    { open: false, from: 0, exit: 1, points: 2000, replay: false, destination: 0 },
    { open: true, from: 0, exit: 1, points: 7500, replay: false, destination: 1 },
    { open: true, from: 1, exit: 1, points: 5000, replay: true, destination: 1 },
  ])('scores wormhole entry $points and routes to $destination', ({ open, from, exit, points, replay, destination }) => {
    const game = new SpaceCadetGame()
    if (open) game['hitTarget'](6)
    game.wormholeExit = exit
    const before = game.getSnapshot().score
    game['enterWormhole'](from)
    expect(game.getSnapshot()).toMatchObject({ score: before + points, replay })
    expect(game['capture']).toMatchObject({ kind: 'wormhole', from, to: destination })
  })
})

describe('Space Cadet missions and ball lifecycle', () => {
  it('awards unmultiplied mission acceptance and completion and promotes after 18 progress lights', () => {
    const game = new SpaceCadetGame()
    game['patch']({ multiplier: 5, rankProgress: 12 })
    accept(game, 0)
    expect(game.getSnapshot()).toMatchObject({ mission: 0, score: 35_000, missionProgress: 0 })
    game['awardRamp'](); game['awardRamp']()
    expect(game.getSnapshot()).toMatchObject({ mission: 0, missionProgress: 2, rank: 0 })
    game['awardRamp']()
    expect(game.getSnapshot()).toMatchObject({ score: 610_000, mission: null, rank: 1, rankProgress: 0 })
    expect(game.lightLevel('bonusLane')).toBe(1)
    const before = game.getSnapshot().score
    game['hitRollover'](5)
    expect(game.getSnapshot().score - before).toBe(60_000)
    expect(game.lightLevel('bonusLane')).toBe(0)
  })

  it('requires fuel to accept a mission and refuels through fuel targets', () => {
    const game = new SpaceCadetGame()
    game.fuelLit.fill(false)
    game['patch']({ fuel: 0 })
    game['hitTarget'](3)
    game['awardRamp']()
    expect(game.getSnapshot()).toMatchObject({ mission: null, selectedMission: 0 })
    game['hitTarget'](0); game['hitTarget'](1)
    expect(game.getSnapshot().fuel).toBe(0)
    game['hitTarget'](2)
    expect(game.getSnapshot().fuel).toBe(6)
    expect(game.fuelLit).toEqual([true, true, true, true, true, true])
    game['awardRamp']()
    expect(game.getSnapshot().mission).toBe(0)
  })

  it('drains six fuel lights over 90 seconds and aborts a mission only at empty', () => {
    const game = new SpaceCadetGame()
    game['refuel']()
    accept(game, 0)
    for (const [elapsed, fuel] of [[10, 5], [22, 4], [36, 3], [52, 2], [70, 1], [90, 0]]) {
      game['elapsed'] = elapsed - .001
      game['updateAwards']()
      expect(game.getSnapshot().fuel).toBe(fuel + 1)
      game['elapsed'] = elapsed
      game['updateAwards']()
      expect(game.getSnapshot()).toMatchObject({ fuel, mission: fuel ? 0 : null })
    }
    expect(game.getSnapshot().message).toContain('MISSION ABORTED')
  })

  it('partially refuels dark lower lights and fully refuels from the dark blue light', () => {
    const game = new SpaceCadetGame()
    game.fuelLit.fill(false)
    game['patch']({ fuel: 0 })
    game['hitRollover'](10)
    expect(game.getSnapshot()).toMatchObject({ fuel: 1, score: 500 })
    game['hitRollover'](10)
    expect(game.getSnapshot()).toMatchObject({ fuel: 1, score: 1000 })
    game['hitRollover'](14)
    expect(game.getSnapshot()).toMatchObject({ fuel: 6, score: 2500 })
    game['hitRollover'](14)
    expect(game.getSnapshot().score).toBe(3000)
  })

  it('resets Bug Hunt targets at acceptance and counts spot and drop hits, not bumpers', () => {
    const game = new SpaceCadetGame()
    game.targetLit.fill(true); game.dropsDown.fill(true)
    accept(game, 4)
    expect(game.targetLit.every(lit => !lit)).toBe(true)
    expect(game.dropsDown.every(down => !down)).toBe(true)
    bump(game, 1)
    expect(game.getSnapshot().missionProgress).toBe(0)
    game['hitTarget'](0); game['hitDrop'](3)
    expect(game.getSnapshot().missionProgress).toBe(2)
    for (let i = 0; i < 13; i++) game['hitTarget'](0)
    expect(game.getSnapshot()).toMatchObject({ mission: null, rankProgress: 7 })
  })

  it.each([
    { mission: 5, event: 'hyperspace' as const, prerequisite: 'flags' },
    { mission: 10, event: 'blackHole' as const, prerequisite: 'engine' },
  ])('requires a live $prerequisite upgrade to finish mission $mission', ({ mission, event, prerequisite }) => {
    const game = new SpaceCadetGame()
    game.engineLevel = 2; game['flagsUntil'] = 60
    accept(game, mission)
    game['advanceMission'](event)
    expect(game.getSnapshot().mission).toBe(mission)
    if (prerequisite === 'flags') bank(game, 6)
    else for (let i = 0; i < 3; i++) game['hitEngine'](i)
    game['elapsed'] = 60
    game['updateAwards']()
    game['advanceMission'](event)
    expect(game.getSnapshot().mission).toBe(mission)
    if (prerequisite === 'flags') { resetDrops(game); bank(game, 6) }
    else for (let i = 0; i < 3; i++) game['hitEngine'](i)
    game['advanceMission'](event)
    expect(game.getSnapshot().mission).toBeNull()
    expect(game.getSnapshot().rankProgress).toBe(mission === 5 ? 7 : 8)
  })

  it('requires yellow, red, green in order for Secret and suppresses matching wormhole replay', () => {
    const game = new SpaceCadetGame()
    accept(game, 7)
    game.wormholeOpen = true; game.wormholeExit = 0
    game['enterWormhole'](0)
    expect(game.getSnapshot()).toMatchObject({ missionStage: 0, replay: false })
    for (const [index, stage] of [[2, 1], [1, 2]]) {
      game.wormholeOpen = true; game.wormholeExit = index
      game['enterWormhole'](index)
      expect(game.getSnapshot()).toMatchObject({ missionStage: stage, replay: false })
    }
    game.wormholeOpen = true; game.wormholeExit = 0
    game['enterWormhole'](0)
    expect(game.getSnapshot()).toMatchObject({ mission: null, replay: false, rankProgress: 10 })
  })

  it('requires all hazard lights before the final Stray Comet hyperspace shot', () => {
    const game = new SpaceCadetGame()
    game.targetLit.fill(true, 10, 13)
    accept(game, 8)
    expect(game.targetLit.slice(10, 13)).toEqual([false, false, false])
    game['awardSaucer'](0)
    expect(game.getSnapshot().missionStage).toBe(0)
    for (let i = 10; i < 13; i++) game['hitTarget'](i)
    expect(game.getSnapshot()).toMatchObject({ mission: 8, missionStage: 1 })
    game['awardSaucer'](0)
    expect(game.getSnapshot()).toMatchObject({ mission: null, rankProgress: 8 })
  })

  it('requires 75 flag spins before Cosmic Plague can finish on space warp', () => {
    const game = new SpaceCadetGame()
    accept(game, 11)
    game['hitRollover'](3)
    for (let i = 0; i < 74; i++) game['advanceMission']('flags')
    game['hitRollover'](3)
    expect(game.getSnapshot()).toMatchObject({ mission: 11, missionStage: 0, missionProgress: 74 })
    game['advanceMission']('flags')
    expect(game.getSnapshot()).toMatchObject({ missionStage: 1, missionProgress: 0 })
    game['hitRollover'](3)
    expect(game.getSnapshot()).toMatchObject({ mission: null, rankProgress: 11, score: 1_785_000 })
  })

  it.each([['ramp', 7, 0], ['hyperspace', 4, 9]] as const)('finishes Time Warp via %s with the correct rank and progress', (finish, rank, progress) => {
    const game = new SpaceCadetGame()
    game['patch']({ rank: 5, rankProgress: 9 })
    accept(game, 15)
    game['advanceMission'](finish)
    expect(game.getSnapshot().missionStage).toBe(0)
    for (let i = 0; i < 25; i++) game['advanceMission']('rebound')
    game['advanceMission'](finish)
    expect(game.getSnapshot()).toMatchObject({ mission: null, rank, rankProgress: progress, score: 2_035_000 })
  })

  it('plays every Maelstrom stage in order and awards the final bank benefits', () => {
    const game = new SpaceCadetGame()
    game['patch']({ rank: 8 })
    accept(game, 16)
    game['advanceMission']('hyperspace')
    expect(game.getSnapshot().missionStage).toBe(0)
    const events = [['drop', 3], ['spot', 3], ['lane', 5], ['fuel', 1], ['ramp', 1], ['flags', 1], ['wormhole', 1], ['hyperspace', 1]] as const
    events.forEach(([kind, count], stage) => {
      for (let i = 0; i < count; i++) game['advanceMission'](kind)
      expect(game.getSnapshot().missionStage).toBe(stage < 7 ? stage + 1 : 0)
    })
    expect(game.getSnapshot()).toMatchObject({ mission: null, rank: 8, rankProgress: 0, multiplier: 10, hyperspace: 4, extraBalls: 1 })
    expect(game.medalLevel).toBe(3)
    expect([0, 1, 2, 3].map(index => game.lightLevel('booster', index))).toEqual([1, 1, 1, 1])
  })

  it('consumes automatic replay first and preserves mission and table state at the plunger', () => {
    const game = new SpaceCadetGame()
    game.startCharge(); game.releaseCharge()
    accept(game, 0)
    bank(game, 0)
    game['hitTarget'](6)
    game['enterWormhole'](game.wormholeExit)
    const before = game.getSnapshot().score
    game['drain']()
    expect(game.getSnapshot()).toMatchObject({ ballNumber: 1, launchReady: true, replay: true, mission: 0, multiplier: 2, bonus: null, score: before })
    expect(game.ball).toMatchObject({ x: SERVE.x, z: SERVE.z, vx: 0, vz: 0 })
    game.startCharge(); game.releaseCharge()
    game['elapsed'] = game['saveUntil']
    game['drain']()
    expect(game.getSnapshot()).toMatchObject({ ballNumber: 1, replay: false, mission: 0, multiplier: 2, bonus: null, score: before })
  })

  it('uses an extra ball without advancing the counter while resetting table awards and aborting the mission', () => {
    const game = new SpaceCadetGame()
    game.startCharge(); game.releaseCharge()
    accept(game, 0)
    bank(game, 0)
    game['awardExtraBall']()
    game['elapsed'] = game['saveUntil']
    game['drain']()
    expect(game.getSnapshot().bonus?.total).toBe(10_000)
    game.skipBonus()
    expect(game.getSnapshot()).toMatchObject({ ballNumber: 1, extraBalls: 0, launchReady: true, mission: null, multiplier: 1 })
    expect(game.dropsDown.every(down => !down)).toBe(true)
  })

  it('suppresses scoring, replay and crash bonus on tilt and serves the next ball cleanly', () => {
    const game = new SpaceCadetGame()
    game.startCharge(); game.releaseCharge()
    game['hitTarget'](6); game['enterWormhole'](game.wormholeExit)
    for (const elapsed of [1, 2, 3]) { game['elapsed'] = elapsed; game.nudge() }
    expect(game.getSnapshot()).toMatchObject({ tilted: true, ballSave: false, replay: false })
    const score = game.getSnapshot().score
    game['hitTarget'](3); game['hitDrop'](0); game['hitRollover'](5)
    game['drain']()
    expect(game.getSnapshot()).toMatchObject({ score, ballNumber: 2, tilted: false, launchReady: true, bonus: null })
  })
})

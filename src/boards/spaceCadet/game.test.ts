import { describe, expect, it } from 'vitest'
import { SpaceCadetGame, MISSIONS } from './game'
import { BALL_Y, DECK_Y, DECK_RAILS, BUMPERS, DROPS, HYPERSPACE_HOOD, KICKERS, LANE_DIR, RAMP_ENTRY, RAMP_PATH, SERVE, TABLE, TARGETS, WORMHOLES, hyperspaceLane } from './layout'

function advance(game: SpaceCadetGame, seconds: number, hz = 240) {
  for (let i = 0; i < Math.round(seconds * hz); i++) game.update(1 / hz)
}

function launch(game: SpaceCadetGame, charge = 0.5) {
  game.startCharge()
  advance(game, charge * 1.05)
  game.releaseCharge()
}

/** Put the ball in play at a position. */
function place(game: SpaceCadetGame, x: number, z: number, vx = 0, vz = 0) {
  launch(game)
  advance(game, 0.05)
  Object.assign(game.ball, { x, z, vx, vz })
}

/** Launch, then park the ball on open playfield until the re-deploy ball save expires. */
function launchWithoutSave(game: SpaceCadetGame) {
  launch(game)
  advance(game, 0.3)
  for (let i = 0; i < 60 * 31; i++) {
    Object.assign(game.ball, { x: -1.1, z: -0.4, vx: 0, vz: 0 })
    game.update(1 / 60)
  }
  expect(game.getSnapshot().ballSave).toBe(false)
}

describe('space cadet table', () => {
  it('scores a weak deployment through the skill lane and suppresses that award on a replay', () => {
    const game = new SpaceCadetGame()
    launch(game, .13)
    let skill = false
    for (let i = 0; i < 240 * 4; i++) {
      game.update(1 / 240)
      if (game.getSnapshot().message.includes('SKILL SHOT +')) { skill = true; break }
    }
    expect(skill).toBe(true)
    expect(game.ball.x).toBeLessThan(2.85)
    game['drain']()
    const before = game.getSnapshot().score
    launch(game, .13)
    for (let i = 0; i < 240 * 4; i++) {
      game.update(1 / 240)
      if (game.ball.x < 2.85) break
    }
    expect(game.getSnapshot().score).toBe(before)
  })

  it.each([0, 1])('routes out-lane kicker %i through the correct chute', side => {
    const game = new SpaceCadetGame()
    launchWithoutSave(game)
    game.fuelLit.fill(false)
    game['patch']({ fuel: 0 })
    game.kickersArmed[side] = true
    Object.assign(game.ball, { x: KICKERS[side].x, y: BALL_Y, z: 3, vx: 0, vz: 2 })
    let routed = false
    for (let i = 0; i < 240 * 4; i++) {
      game.update(1 / 240)
      if (side === 0 ? game.getSnapshot().fuel === 6 : game.ball.x > 2.85 && game.ball.z < 0) { routed = true; break }
    }
    expect(routed).toBe(true)
    expect(game.kickersArmed[side]).toBe(false)
    expect(game.getSnapshot().ballNumber).toBe(1)
  })

  it.each([0.9, 1])('launches through the deployment gate onto the playfield at %s charge', charge => {
    const game = new SpaceCadetGame()
    launch(game, charge)
    let leftChute = false
    let onField = false
    for (let i = 0; i < 240 * 4; i++) {
      game.update(1 / 240)
      const { x, z } = game.ball
      expect(Number.isFinite(x + z)).toBe(true)
      if (z < -2.6) leftChute = true
      if (leftChute && x < 2.7) onField = true
    }
    expect(leftChute).toBe(true)
    expect(onField).toBe(true)
    expect(game.getSnapshot().launchReady).toBe(false)
  })

  it('carries a ramp shot around the raised U-turn and onto the left launch deck', () => {
    const game = new SpaceCadetGame()
    // A played shot, after the launch orbit window, earns full ramp credit.
    launchWithoutSave(game)
    Object.assign(game.ball, { x: (RAMP_ENTRY.x0 + RAMP_ENTRY.x1) / 2, z: RAMP_ENTRY.z1 + .05, vx: 0, vz: -9 })
    let maxHeight = 0
    for (let i = 0; i < 240 * 4; i++) {
      game.update(1 / 240)
      maxHeight = Math.max(maxHeight, game.ball.y)
    }
    expect(maxHeight).toBeGreaterThan(1)
    expect(game.getSnapshot().hyperspace).toBe(0)
    expect(game.getSnapshot().score).toBeGreaterThanOrEqual(5_000)
    const exit = RAMP_PATH[RAMP_PATH.length - 1]
    expect(exit[0]).toBeLessThan(-2)
    expect(exit[1]).toBe(DECK_Y)
  })

  it('rolls beneath raised bumpers without scoring or bouncing off them', () => {
    const game = new SpaceCadetGame()
    const bumper = BUMPERS[5]
    place(game, bumper.x + .5, bumper.z, -4, 0)
    const before = game.getSnapshot().score
    advance(game, .15)
    expect(game.ball.y).toBe(BALL_Y)
    expect(game.ball.x).toBeLessThan(bumper.x)
    expect(game.ball.vx).toBeLessThan(-3)
    expect(game.getSnapshot().score).toBe(before)
    expect(game.bumperFlashes[5]).toBe(0)
  })

  it('lets a ground-level ball cross a raised deck rail', () => {
    const game = new SpaceCadetGame()
    const rail = DECK_RAILS[4]
    const x = (rail.a[0] + rail.b[0]) / 2
    const z = (rail.a[1] + rail.b[1]) / 2
    place(game, x + .3, z, -4, 0)
    advance(game, .13)
    expect(game.ball.x).toBeLessThan(x - .15)
    expect(game.ball.y).toBe(BALL_Y)
  })

  it('plays the elevated bumpers and returns through the deck exit to ground level', () => {
    const game = new SpaceCadetGame()
    launchWithoutSave(game)
    Object.assign(game.ball, {x: -1.52, z: .42, vx: 0, vz: -9})
    let onDeck = false, elevatedHit = false, returned = false
    for (let i = 0; i < 240 * 12; i++) {
      game.update(1 / 240)
      if (game.ball.y === DECK_Y + BALL_Y) onDeck = true
      if (game.bumperFlashes.slice(4).some(value => value > 0)) elevatedHit = true
      if (onDeck && game.ball.y === BALL_Y) { returned = true; break }
    }
    expect(onDeck).toBe(true)
    expect(elevatedHit).toBe(true)
    expect(returned).toBe(true)
  })

  it('accepts a mission from the ramp after the mission targets are lit', () => {
    const game = new SpaceCadetGame()
    launch(game)
    const target = TARGETS[3]
    Object.assign(game.ball, { x: target.x + .25, z: target.z, vx: -6, vz: 0 })
    advance(game, .1)
    expect(game.getSnapshot().missionReady).toBe(true)
    Object.assign(game.ball, { x: (RAMP_ENTRY.x0 + RAMP_ENTRY.x1) / 2, z: RAMP_ENTRY.z1 + .05, vx: 0, vz: -9 })
    advance(game, 0.2)
    advance(game, 3)
    expect(game.getSnapshot().mission).toBe(0)
    expect(MISSIONS[0].name).toBe('Launch Training')
  })

  it('returns a ball entering a closed wormhole to the same entrance', () => {
    const game = new SpaceCadetGame()
    const [from] = WORMHOLES
    place(game, from.x, from.z - 0.05, 0, 0.5)
    let visited = false
    for (let i = 0; i < 240 * 1.5; i++) {
      game.update(1 / 240)
      if (i > 120 && Math.hypot(game.ball.x - from.x, game.ball.z - from.z) < 0.05) visited = true
    }
    expect(visited).toBe(true)
    expect(game.getSnapshot().score).toBeGreaterThanOrEqual(2_000)
  })

  it('knocks down the multiplier bank and resets it', () => {
    const game = new SpaceCadetGame()
    launch(game)
    for (let i = 0; i < 3; i++) {
      const drop = DROPS[i]
      Object.assign(game.ball, { x: drop.x + 0.45, z: drop.z, vx: -8, vz: 0 })
      advance(game, 0.15)
    }
    expect(game.dropsDown.slice(0, 3)).toEqual([true, true, true])
    advance(game, 2)
    expect(game.dropsDown.slice(0, 3)).toEqual([false, false, false])
  })

  it('scores an attack bumper and kicks the ball away', () => {
    const game = new SpaceCadetGame()
    launch(game)
    const bumper = BUMPERS[1]
    Object.assign(game.ball, { x: bumper.x, z: bumper.z + 0.56, vx: 0, vz: -15 })
    game.update(1 / 240)
    expect(game.ball.vz).toBeGreaterThan(0)
    expect(game.getSnapshot().score).toBe(500)
    expect(game.consumeEvents().some(event => event.type === 'bumper')).toBe(true)
  })

  it('awards the crash bonus on a normal drain and returns an automatic replay to the plunger', () => {
    const game = new SpaceCadetGame()
    launchWithoutSave(game)
    Object.assign(game.ball, { x: -0.25, z: 5.0, vx: 0, vz: 0.5 })
    advance(game, 1)
    expect(game.getSnapshot().bonus?.total).toBe(10_000)
    game.skipBonus()
    expect(game.getSnapshot().ballNumber).toBe(2)

    const saved = new SpaceCadetGame()
    launch(saved)
    advance(saved, 0.1)
    Object.assign(saved.ball, { x: -0.25, z: 4.95, vx: 0, vz: 0.5 })
    advance(saved, 1)
    expect(saved.getSnapshot().launchReady).toBe(true)
    expect(saved.ball).toMatchObject({ x: SERVE.x, z: SERVE.z, vx: 0, vz: 0 })
    expect(saved.centerPostUp).toBe(false)
    expect(saved.getSnapshot().ballNumber).toBe(1)
  })

  it('drains outlane balls but kicks them back when the kicker is armed', () => {
    const game = new SpaceCadetGame()
    launchWithoutSave(game)
    Object.assign(game.ball, { x: KICKERS[0].x, z: 3.0, vx: 0, vz: 2 })
    advance(game, 1.5)
    game.skipBonus()
    expect(game.getSnapshot().ballNumber).toBe(2)

    const kicked = new SpaceCadetGame()
    launchWithoutSave(kicked)
    kicked.kickersArmed.fill(true)
    Object.assign(kicked.ball, { x: KICKERS[0].x, z: 3.0, vx: 0, vz: 2 })
    advance(kicked, 0.6)
    expect(kicked.ball.z).toBeLessThan(3)
    expect(kicked.getSnapshot().ballNumber).toBe(1)
  })

  it('rolls down both return lanes onto the flippers', () => {
    for (const x of [-2.5, 2.0]) {
      const game = new SpaceCadetGame()
      launchWithoutSave(game)
      Object.assign(game.ball, { x, z: 2.6, vx: 0, vz: 0.5 })
      let reachedFlipper = false
      for (let i = 0; i < 240 * 3; i++) {
        game.update(1 / 240)
        if (game.ball.z > 4.3 && Math.abs(game.ball.x + 0.25) < 1.6) reachedFlipper = true
      }
      expect(reachedFlipper).toBe(true)
    }
  })

  it('keeps every ball on the table across long randomized games', () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let run = 0; run < 24; run++) {
      const game = new SpaceCadetGame()
      launch(game, random())
      for (let frame = 0; frame < 60 * 45; frame++) {
        if (frame % 9 === 0) {
          // Flip when the ball approaches the flippers, the way a player would.
          const near = game.ball.z > 3.9 && game.ball.vz > 0
          game.setFlipper('left', near && game.ball.x < -0.25 && random() > 0.15)
          game.setFlipper('right', near && game.ball.x >= -0.25 && random() > 0.15)
        }
        game.update(1 / 60)
        const { x, z, y } = game.ball
        expect(Number.isFinite(x + z + y)).toBe(true)
        expect(x).toBeGreaterThan(TABLE.left - 0.01)
        expect(x).toBeLessThan(TABLE.right + 0.01)
        expect(z).toBeGreaterThan(TABLE.top - 0.01)
        const snapshot = game.getSnapshot()
        if (snapshot.status === 'gameover') break
        if (snapshot.launchReady) launch(game, random())
        expect(snapshot.message).not.toContain('RETURNED')
      }
    }
  }, 15_000)

  it('resets to a fresh game', () => {
    const game = new SpaceCadetGame()
    launch(game)
    advance(game, 1)
    game.newGame()
    expect(game.getSnapshot()).toMatchObject({ status: 'ready', score: 0, ballNumber: 1, rank: 0, mission: null, launchReady: true })
    expect(game.ball).toMatchObject({ x: SERVE.x, z: SERVE.z, vx: 0, vz: 0 })
  })
})

describe('hyperspace chute', () => {
  it.each([0.3, 0.6, 0.9, 1])('keeps a %s-charge plunger launch out of the hooded kickout', charge => {
    const game = new SpaceCadetGame()
    launch(game, charge)
    for (let i = 0; i < 240 * 4; i++) {
      game.update(1 / 240)
      expect(game['capture']?.kind).not.toBe('chute')
    }
    expect(game.getSnapshot().hyperspace).toBe(0)
  })

  it('bounces a playfield ball off the hood instead of capturing it', () => {
    const game = new SpaceCadetGame()
    launchWithoutSave(game)
    Object.assign(game.ball, { x: HYPERSPACE_HOOD.x, y: BALL_Y, z: HYPERSPACE_HOOD.z - .6, vx: 0, vz: 3 })
    advance(game, .5)
    expect(game.getSnapshot().hyperspace).toBe(0)
    expect(Math.hypot(game.ball.x - HYPERSPACE_HOOD.x, game.ball.z - HYPERSPACE_HOOD.z)).toBeGreaterThan(HYPERSPACE_HOOD.radius + .1)
  })

  it('carries a lane shot up the chute into the kickout and ejects it outside the hood', () => {
    const game = new SpaceCadetGame()
    launchWithoutSave(game)
    const [x, z] = hyperspaceLane(1.4, .3)
    Object.assign(game.ball, { x, y: BALL_Y, z, vx: LANE_DIR[0] * 9, vz: LANE_DIR[1] * 9 })
    let rode = false
    for (let i = 0; i < 240 * 3 && game.getSnapshot().hyperspace === 0; i++) {
      game.update(1 / 240)
      if (game['capture']?.kind === 'chute') rode = true
    }
    expect(rode).toBe(true)
    expect(game.getSnapshot().hyperspace).toBe(1)
    advance(game, 1.2)
    expect(game['capture']).toBeNull()
    expect(Math.hypot(game.ball.x - HYPERSPACE_HOOD.x, game.ball.z - HYPERSPACE_HOOD.z)).toBeGreaterThan(HYPERSPACE_HOOD.radius)
  })

  it('takes a late left-flipper shot up the funnel', () => {
    let entered = 0
    for (const delay of [.44, .47, .5, .53, .56, .59, .62, .65]) {
      const game = new SpaceCadetGame()
      launch(game)
      advance(game, .1)
      game['currentState'].deploying = false
      Object.assign(game.ball, { x: -2.0, y: BALL_Y, z: 4.45, vx: 1.6, vz: 0.9 })
      for (let t = 0; t < 1.5 && game['capture']?.kind !== 'chute'; t += 1 / 240) {
        game.setFlipper('left', t > delay && t < delay + .25)
        game.update(1 / 240)
      }
      if (game['capture']?.kind === 'chute') entered++
    }
    expect(entered).toBeGreaterThanOrEqual(6)
  })

  it('ignores a ball crossing the mouth sideways', () => {
    const game = new SpaceCadetGame()
    launchWithoutSave(game)
    const [x, z] = hyperspaceLane(2.85, -.2)
    Object.assign(game.ball, { x, y: BALL_Y, z, vx: -LANE_DIR[1] * 6, vz: LANE_DIR[0] * 6 })
    for (let i = 0; i < 60; i++) { game.update(1 / 240); expect(game['capture']?.kind).not.toBe('chute') }
  })
})

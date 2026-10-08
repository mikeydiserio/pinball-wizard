import { describe, expect, it } from 'vitest';
import { BALLS_PER_GAME, BUMPERS, FLIPPER_RAISED, PinballGame } from './physics';

function advance(game: PinballGame, seconds: number, hz = 60) {
  for (let i = 0; i < Math.round(seconds * hz); i++) game.update(1 / hz);
}

function launch(game: PinballGame, charge = 0.5) {
  game.startCharge();
  advance(game, charge);
  game.releaseCharge();
}

describe('pinball simulation', () => {
  it('holds a stable immutable store snapshot until observable data changes', () => {
    const game = new PinballGame();
    const snapshot = game.getSnapshot();
    let calls = 0;
    const unsubscribe = game.subscribe(() => { calls++; });
    game.update(1 / 60);
    expect(game.getSnapshot()).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    game.startCharge();
    advance(game, 0.2);
    expect(game.getSnapshot()).not.toBe(snapshot);
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
    calls = 0;
    game.releaseCharge();
    expect(calls).toBe(0);
  });

  it('routes even a minimum-charge launch from the shooter lane onto the table', () => {
    const game = new PinballGame();
    game.startCharge();
    game.releaseCharge();
    let enteredTable = false;
    for (let i = 0; i < 180; i++) {
      game.update(1 / 60);
      if (game.ball.x < 2.2 && game.ball.z < 0) enteredTable = true;
      expect(Number.isFinite(game.ball.x + game.ball.z + game.ball.vx + game.ball.vz)).toBe(true);
    }
    expect(enteredTable).toBe(true);
    expect(game.getSnapshot().status).toBe('playing');
  });

  it('has identical trajectories at 30 Hz and 120 Hz render rates', () => {
    const slow = new PinballGame();
    const fast = new PinballGame();
    for (const game of [slow, fast]) launch(game, 0.5);
    advance(slow, 2, 30);
    advance(fast, 2, 120);
    expect(slow.ball.x).toBeCloseTo(fast.ball.x, 10);
    expect(slow.ball.z).toBeCloseTo(fast.ball.z, 10);
    expect(slow.getSnapshot().score).toBe(fast.getSnapshot().score);
  });

  it('reflects a fast bumper hit, scores it once, and emits a consumable event', () => {
    const game = new PinballGame();
    launch(game);
    const bumper = BUMPERS[0];
    Object.assign(game.ball, { x: bumper.x, z: bumper.z + 0.61, vx: 0, vz: -20 });
    game.update(1 / 240);
    expect(game.ball.vz).toBeGreaterThan(0);
    expect(game.getSnapshot().score).toBe(100);
    expect(game.getSnapshot().hits).toBe(1);
    expect(game.consumeEvents().filter(event => event.type === 'bumper')).toHaveLength(1);
    expect(game.consumeEvents()).toEqual([]);
  });

  it('launches a timed flipper strike and does not boost a stationary held flipper', () => {
    const strike = new PinballGame();
    launch(strike);
    Object.assign(strike.ball, { x: -0.6, z: 3.72, vx: 0, vz: 2 });
    strike.setFlipper('left', true);
    advance(strike, 0.1, 240);
    expect(strike.ball.vz).toBeLessThan(-7);

    const held = new PinballGame();
    launch(held);
    held.setFlipper('left', true);
    advance(held, 0.1);
    expect(held.leftAngle).toBe(FLIPPER_RAISED);
    Object.assign(held.ball, { x: -0.6, z: 2.91, vx: 0, vz: 2 });
    advance(held, 0.1, 240);
    expect(Math.hypot(held.ball.vx, held.ball.vz)).toBeLessThan(4);
  });

  it('lets the ball drain between the tapered tips of resting flippers', () => {
    const game = new PinballGame();
    launch(game);
    Object.assign(game.ball, { x: 0, z: 3.75, vx: 0, vz: 0.2 });
    advance(game, 1.2);
    expect(game.getSnapshot().launchReady).toBe(true);
    expect(game.getSnapshot().ballNumber).toBe(2);
  });

  it('rolls smoothly from both lower guides across the flipper heels', () => {
    for (const x of [-1.55, 1.55]) {
      const game = new PinballGame();
      launch(game);
      Object.assign(game.ball, { x, z: 3.2, vx: 0, vz: 0.1 });
      advance(game, 4);
      expect(game.getSnapshot().launchReady).toBe(true);
    }
  });

  it('consumes exactly three balls including early drains, then resets a complete game', () => {
    const game = new PinballGame();
    for (let ball = 1; ball <= BALLS_PER_GAME; ball++) {
      launch(game);
      Object.assign(game.ball, { x: 0, z: 5.7, vx: 0, vz: 1 });
      game.update(1 / 60);
      expect(game.getSnapshot().ballNumber).toBe(Math.min(ball + 1, BALLS_PER_GAME));
      expect(game.getSnapshot().launchReady).toBe(ball < BALLS_PER_GAME);
    }
    expect(game.getSnapshot().status).toBe('gameover');
    expect(game.getSnapshot().ballNumber).toBe(3);
    game.newGame();
    expect(game.getSnapshot()).toMatchObject({ status: 'ready', score: 0, ballNumber: 1, multiplier: 1, launchReady: true, tilted: false });
    expect(game.ball).toEqual({ x: 2.77, z: 4.7, vx: 0, vz: 0 });
  });

  it('freezes the entire simulation while paused and drops background-tab gaps', () => {
    const game = new PinballGame();
    launch(game);
    advance(game, 0.1);
    game.togglePause();
    const ball = { ...game.ball };
    const snapshot = game.getSnapshot();
    game.update(60);
    expect(game.ball).toEqual(ball);
    expect(game.getSnapshot()).toBe(snapshot);
    game.togglePause();
    game.update(60);
    expect(game.ball.z).toBeGreaterThan(ball.z - 2.5);
    expect(game.getSnapshot().ballNumber).toBe(1);
  });

  it('rate limits nudges and locks flippers after three quick nudges', () => {
    const game = new PinballGame();
    launch(game);
    game.nudge();
    const velocity = game.ball.vz;
    game.nudge();
    expect(game.ball.vz).toBe(velocity);
    advance(game, 0.5);
    game.nudge();
    advance(game, 0.5);
    game.nudge();
    expect(game.getSnapshot()).toMatchObject({ tilted: true });
    game.setFlipper('left', true);
    advance(game, 0.2);
    expect(game.leftAngle).toBeGreaterThan(0);
  });
});

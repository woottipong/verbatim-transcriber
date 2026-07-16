import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateRms,
  getCanvasMetrics,
  createInputSignalMonitor,
  smoothWaveformBars,
  toFrequencyBars,
  toWaveformBars,
} from './audioSignal.ts';

test('canvas metrics retain display size when backing dimensions already match', () => {
  assert.deepEqual(getCanvasMetrics(320, 64, 2), {
    displayWidth: 320,
    displayHeight: 64,
    backingWidth: 640,
    backingHeight: 128,
  });
});

test('calculateRms returns zero for a centered silent signal', () => {
  assert.equal(calculateRms(new Uint8Array([128, 128, 128, 128])), 0);
});

test('calculateRms normalizes a full-scale alternating signal', () => {
  const rms = calculateRms(new Uint8Array([0, 255, 0, 255]));

  assert.ok(rms > 0.99 && rms <= 1);
});

test('toWaveformBars keeps the requested shape and clamps amplitudes', () => {
  const bars = toWaveformBars(new Uint8Array([128, 255, 128, 0]), 2);

  assert.equal(bars.length, 2);
  assert.ok(bars.every(value => value >= 0 && value <= 1));
  assert.ok(bars[0] > 0.9);
  assert.ok(bars[1] > 0.9);
});

test('toFrequencyBars amplifies useful input while keeping silence flat', () => {
  assert.deepEqual(toFrequencyBars(new Uint8Array([0, 0, 0, 0]), 2), [0, 0]);

  const bars = toFrequencyBars(new Uint8Array([0, 64, 128, 255]), 2);
  assert.equal(bars.length, 2);
  assert.ok(bars[0] > 0.2);
  assert.equal(bars[1], 1);
});

test('smoothWaveformBars reacts faster to attack than release', () => {
  const bars = smoothWaveformBars([0, 0.8], [1, 0], {
    attack: 0.5,
    release: 0.25,
  });

  assert.deepEqual(bars, [0.5, 0.6]);
});

test('input signal monitor reports activity without treating it as speech', () => {
  const monitor = createInputSignalMonitor({
    activityThreshold: 0.02,
    lowInputThreshold: 0.004,
    lowInputDelayMs: 1_500,
    activityHoldMs: 250,
  });

  assert.equal(monitor.update(0.01, 0), 'listening');
  assert.equal(monitor.update(0.03, 100), 'active');
  assert.equal(monitor.update(0.005, 300), 'active');
  assert.equal(monitor.update(0.005, 400), 'listening');
});

test('input signal monitor delays low-input feedback to avoid flicker', () => {
  const monitor = createInputSignalMonitor({
    activityThreshold: 0.02,
    lowInputThreshold: 0.004,
    lowInputDelayMs: 1_500,
    activityHoldMs: 250,
  });

  assert.equal(monitor.update(0.002, 0), 'listening');
  assert.equal(monitor.update(0.002, 1_499), 'listening');
  assert.equal(monitor.update(0.002, 1_500), 'low');
  assert.equal(monitor.update(0.03, 1_600), 'active');
});

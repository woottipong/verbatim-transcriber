export type InputSignalState = 'listening' | 'active' | 'low';

export interface InputSignalMonitorOptions {
  activityThreshold: number;
  lowInputThreshold: number;
  lowInputDelayMs: number;
  activityHoldMs: number;
}

export function getCanvasMetrics(width: number, height: number, pixelRatio: number) {
  const safePixelRatio = Math.min(Math.max(pixelRatio || 1, 1), 2);
  return {
    displayWidth: width,
    displayHeight: height,
    backingWidth: Math.max(1, Math.floor(width * safePixelRatio)),
    backingHeight: Math.max(1, Math.floor(height * safePixelRatio)),
  };
}

const DEFAULT_MONITOR_OPTIONS: InputSignalMonitorOptions = {
  activityThreshold: 0.018,
  lowInputThreshold: 0.004,
  lowInputDelayMs: 1_800,
  activityHoldMs: 280,
};

export function calculateRms(samples: Uint8Array): number {
  if (samples.length === 0) return 0;

  let sumOfSquares = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sumOfSquares += normalized * normalized;
  }

  return Math.min(1, Math.sqrt(sumOfSquares / samples.length));
}

export function toWaveformBars(samples: Uint8Array, barCount: number): number[] {
  if (barCount <= 0) return [];
  if (samples.length === 0) return new Array(barCount).fill(0);

  const bars = new Array<number>(barCount).fill(0);
  for (let barIndex = 0; barIndex < barCount; barIndex++) {
    const start = Math.floor((barIndex * samples.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((barIndex + 1) * samples.length) / barCount));

    let peak = 0;
    for (let sampleIndex = start; sampleIndex < Math.min(end, samples.length); sampleIndex++) {
      peak = Math.max(peak, Math.abs(samples[sampleIndex] - 128) / 128);
    }
    bars[barIndex] = Math.min(1, peak);
  }

  return bars;
}

export function toFrequencyBars(samples: Uint8Array, barCount: number): number[] {
  if (barCount <= 0) return [];
  if (samples.length === 0) return new Array(barCount).fill(0);

  const bars = new Array<number>(barCount).fill(0);
  for (let barIndex = 0; barIndex < barCount; barIndex++) {
    const start = Math.floor((barIndex * samples.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((barIndex + 1) * samples.length) / barCount));

    let peak = 0;
    for (let sampleIndex = start; sampleIndex < Math.min(end, samples.length); sampleIndex++) {
      peak = Math.max(peak, samples[sampleIndex] / 255);
    }

    const noiseGated = Math.max(0, (peak - 0.02) / 0.98);
    bars[barIndex] = Math.min(1, Math.pow(noiseGated, 0.72) * 1.25);
  }

  return bars;
}

export function smoothWaveformBars(
  previous: readonly number[],
  current: readonly number[],
  options: { attack?: number; release?: number } = {},
): number[] {
  const attack = options.attack ?? 0.42;
  const release = options.release ?? 0.14;

  return current.map((value, index) => {
    const previousValue = previous[index] ?? 0;
    const smoothing = value > previousValue ? attack : release;
    return Number((previousValue + (value - previousValue) * smoothing).toFixed(4));
  });
}

export function createInputSignalMonitor(
  overrides: Partial<InputSignalMonitorOptions> = {},
) {
  const options = { ...DEFAULT_MONITOR_OPTIONS, ...overrides };
  let monitoringStartedAt: number | null = null;
  let lastActivityAt = Number.NEGATIVE_INFINITY;

  return {
    update(level: number, now: number): InputSignalState {
      monitoringStartedAt ??= now;

      if (level >= options.activityThreshold) {
        lastActivityAt = now;
        return 'active';
      }

      if (now - lastActivityAt <= options.activityHoldMs) {
        return 'active';
      }

      const monitoringDuration = now - monitoringStartedAt;
      if (monitoringDuration >= options.lowInputDelayMs && level <= options.lowInputThreshold) {
        return 'low';
      }

      return 'listening';
    },
  };
}

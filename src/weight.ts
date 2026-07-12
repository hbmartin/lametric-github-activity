/**
 * Number of vertical pixels a LaMetric spike-chart bar can occupy.
 * Weights therefore range from 0 to MAX_PIXEL - 1 (0..7).
 */
export const MAX_PIXEL = 8;

/**
 * Map raw daily contribution counts onto LaMetric chart weights (0..7).
 *
 * Exact port of the original PHP `Api::mapData`:
 *   - `max` starts at 0, `min` is seeded from the first day.
 *   - `difference = max - min`.
 *   - For each value, scan `i` from MAX_PIXEL down to 1; on the first `i`
 *     where `value < difference / i` (float division), the weight is
 *     `MAX_PIXEL - i`. If none match (the max value), the weight stays at
 *     the default `MAX_PIXEL - 1` (7).
 *   - When every day is equal but non-zero (`difference === 0`, `max > 0`),
 *     `value < 0` is never true, so every weight is 7 (consistent activity).
 *   - When there is no activity at all (`max === 0`), every weight is 0, so
 *     the device shows an empty chart rather than a misleading full spike.
 *
 * An empty input returns an empty array, guarding the original code's crash
 * when it seeded `min` from `data[0]` of an empty set.
 */
export function weightActivity(activity: number[]): number[] {
  if (activity.length === 0) {
    return [];
  }

  let max = 0;
  let min = activity[0];

  for (const value of activity) {
    if (value > max) {
      max = value;
    }
    if (value < min) {
      min = value;
    }
  }

  if (max === 0) {
    return activity.map(() => 0);
  }

  const difference = max - min;

  return activity.map((value) => {
    let weight = MAX_PIXEL - 1;
    for (let i = MAX_PIXEL; i > 0; i--) {
      if (value < difference / i) {
        weight = MAX_PIXEL - i;
        break;
      }
    }
    return weight;
  });
}

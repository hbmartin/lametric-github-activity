import { describe, expect, it } from "vitest";
import { weightActivity } from "../src/weight";
import worker, { type Env } from "../src/index";

describe("weightActivity", () => {
  it("returns an empty array for empty input (guards the original crash)", () => {
    expect(weightActivity([])).toEqual([]);
  });

  it("maps all-equal non-zero input to all 7s (difference === 0 branch)", () => {
    expect(weightActivity([3, 3, 3, 3])).toEqual([7, 7, 7, 7]);
  });

  it("maps all-zero input to all 0s (empty chart when there is no activity)", () => {
    expect(weightActivity([0, 0, 0, 0, 0, 0, 0])).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("maps a single value to [7]", () => {
    expect(weightActivity([5])).toEqual([7]);
  });

  it("buckets a known spread into 0..7 (locks the i = 8..1 port)", () => {
    // min 0, max 7, difference 7; thresholds difference/i for i = 8..1.
    expect(weightActivity([0, 1, 2, 3, 4, 5, 6, 7])).toEqual([
      0, 2, 5, 6, 7, 7, 7, 7,
    ]);
  });

  it("keeps every weight within 0..7", () => {
    const weights = weightActivity([0, 10, 3, 25, 1, 40, 7, 2, 18]);
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(7);
    }
  });
});

describe("worker error frames", () => {
  const env: Env = { GITHUB_TOKEN: "test-token" };

  it("returns 'Missing GITHUB_TOKEN' when the secret is unset", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/?username=someone"),
      { GITHUB_TOKEN: "" },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"frames":[{"index":0,"text":"Missing GITHUB_TOKEN","icon":"null"}]}',
    );
  });

  it("returns the exact 'Missing username argument' frame with HTTP 200", async () => {
    const res = await worker.fetch(new Request("https://example.com/"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"frames":[{"index":0,"text":"Missing username argument","icon":"null"}]}',
    );
  });

  it("returns the 'Invalid username argument' frame for an empty username", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/?username="),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"frames":[{"index":0,"text":"Invalid username argument","icon":"null"}]}',
    );
  });
});

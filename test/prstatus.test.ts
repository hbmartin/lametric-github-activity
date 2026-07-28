import { describe, expect, it } from "vitest";
import {
  type PullRequestStatus,
  summarizePrStatuses,
} from "../src/prstatus";

const prs = (...states: PullRequestStatus["state"][]): PullRequestStatus[] =>
  states.map((state) => ({ state }));

describe("summarizePrStatuses", () => {
  it("returns an all-zero, 'none' summary for no PRs", () => {
    expect(summarizePrStatuses([])).toEqual({
      total: 0,
      passing: 0,
      failing: 0,
      pending: 0,
      none: 0,
      overall: "none",
    });
  });

  it("buckets each rollup state and keeps total = sum of buckets", () => {
    const summary = summarizePrStatuses(
      prs("SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED", null),
    );
    expect(summary).toEqual({
      total: 6,
      passing: 1,
      failing: 2, // FAILURE + ERROR
      pending: 2, // PENDING + EXPECTED
      none: 1, // null -> no checks
      overall: "fail",
    });
    expect(
      summary.passing + summary.failing + summary.pending + summary.none,
    ).toBe(summary.total);
  });

  it("reports 'pass' only when every checked PR succeeds", () => {
    expect(summarizePrStatuses(prs("SUCCESS", "SUCCESS")).overall).toBe("pass");
  });

  it("prefers 'fail' over pending and pass", () => {
    expect(
      summarizePrStatuses(prs("SUCCESS", "PENDING", "FAILURE")).overall,
    ).toBe("fail");
  });

  it("reports 'pending' when nothing is failing but something is running", () => {
    expect(summarizePrStatuses(prs("SUCCESS", "PENDING")).overall).toBe(
      "pending",
    );
  });

  it("reports 'none' when no PR has checks configured", () => {
    expect(summarizePrStatuses(prs(null, null)).overall).toBe("none");
  });
});

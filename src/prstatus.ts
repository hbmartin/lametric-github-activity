/**
 * Pure aggregation of pull-request CI/job status, kept network-free so it can be
 * unit-tested directly (mirrors how `weight.ts` isolates the charting algorithm).
 */

/**
 * GitHub `StatusState` enum as returned by a commit's `statusCheckRollup.state`.
 * `null` means the PR's head commit has no checks/statuses configured at all.
 */
export type RollupState =
  | "EXPECTED"
  | "ERROR"
  | "FAILURE"
  | "PENDING"
  | "SUCCESS"
  | null;

/** One open pull request reduced to just the signal we chart: its rollup state. */
export interface PullRequestStatus {
  state: RollupState;
}

/** Overall health across every open PR, in precedence order fail > pending > pass. */
export type OverallStatus = "pass" | "fail" | "pending" | "none";

export interface PrStatusSummary {
  /** Total open, non-draft PRs authored by the user. */
  total: number;
  /** Rollup SUCCESS. */
  passing: number;
  /** Rollup FAILURE or ERROR. */
  failing: number;
  /** Rollup PENDING or EXPECTED (queued / in progress). */
  pending: number;
  /** No checks configured on the head commit (rollup null). */
  none: number;
  /** Aggregate indicator: fail if any failing, else pending, else pass, else none. */
  overall: OverallStatus;
}

/**
 * Bucket each PR by its rollup state and compute the aggregate indicator.
 * `total` always equals `passing + failing + pending + none`.
 */
export function summarizePrStatuses(prs: PullRequestStatus[]): PrStatusSummary {
  let passing = 0;
  let failing = 0;
  let pending = 0;
  let none = 0;

  for (const pr of prs) {
    switch (pr.state) {
      case "SUCCESS":
        passing += 1;
        break;
      case "FAILURE":
      case "ERROR":
        failing += 1;
        break;
      case "PENDING":
      case "EXPECTED":
        pending += 1;
        break;
      default:
        // null / unknown -> no checks configured.
        none += 1;
        break;
    }
  }

  let overall: OverallStatus;
  if (failing > 0) {
    overall = "fail";
  } else if (pending > 0) {
    overall = "pending";
  } else if (passing > 0) {
    overall = "pass";
  } else {
    overall = "none";
  }

  return {
    total: prs.length,
    passing,
    failing,
    pending,
    none,
    overall,
  };
}

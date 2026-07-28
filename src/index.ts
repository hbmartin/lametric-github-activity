import { weightActivity } from "./weight";
import {
  type PrStatusSummary,
  type PullRequestStatus,
  type RollupState,
  summarizePrStatuses,
} from "./prstatus";

export interface Env {
  /** GitHub Personal Access Token. Set via `wrangler secret put GITHUB_TOKEN`. */
  GITHUB_TOKEN: string;
}

const GRAPHQL_URL = "https://api.github.com/graphql";

/**
 * GitHub requires a User-Agent header; the Workers runtime does not set one by
 * default and GitHub responds with 403 when it is missing.
 */
const USER_AGENT = "lametric-github-activity-worker";

/** Number of days of contribution history to chart (matches the original app). */
const WINDOW_DAYS = 36;

/** GraphQL query copied verbatim from the original PHP `Api::fetchData`. */
const QUERY = `query userInfo($login: String!, $dateFrom: DateTime!, $dateTo: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $dateFrom, to: $dateTo) {
          contributionCalendar {
          weeks {
            contributionDays {
              contributionCount
            }
          }
        }
      }
    }
}`;

/** Upper bound on how many open PRs to summarise in a single poll. */
const MAX_PRS = 100;

/**
 * Open, non-draft PRs authored by the user, with each head commit's aggregate
 * check state. The `is:open` qualifier excludes merged and closed PRs and
 * `draft:false` excludes drafts, so no client-side state filtering is needed.
 */
const PR_QUERY = `query openPullRequests($searchQuery: String!, $first: Int!) {
  search(query: $searchQuery, type: ISSUE, first: $first) {
    nodes {
      ... on PullRequest {
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    }
  }
}`;

// Fields are modelled as nullable/optional because this is an external GraphQL
// payload: on partial or error responses any of them can be absent or null.
// This keeps the defensive optional chaining below meaningful to the type checker.
interface ContributionDay {
  contributionCount?: number | null;
}

interface ContributionWeek {
  contributionDays?: (ContributionDay | null)[] | null;
}

interface GraphQLResponse {
  data?: {
    user: {
      contributionsCollection?: {
        contributionCalendar?: {
          weeks?: (ContributionWeek | null)[] | null;
        } | null;
      } | null;
    } | null;
  };
  errors?: unknown[];
}

type FetchResult =
  | { ok: true; days: number[] }
  | { ok: false; message: string };

// Search payload for the PR-status mode. Every field is optional/nullable
// because it is an external GraphQL response and `search` returns a union type
// (only PullRequest nodes carry these fields).
interface StatusCheckRollup {
  state?: RollupState;
}

interface CommitNode {
  commit?: {
    statusCheckRollup?: StatusCheckRollup | null;
  } | null;
}

interface PullRequestNode {
  commits?: {
    nodes?: (CommitNode | null)[] | null;
  } | null;
}

interface SearchResponse {
  data?: {
    search?: {
      nodes?: (PullRequestNode | null)[] | null;
    } | null;
  };
  errors?: unknown[];
}

type PrFetchResult =
  | { ok: true; prs: PullRequestStatus[] }
  | { ok: false; message: string };

/**
 * Cache-control for a success response. Token-bearing URLs (per-user `?token=`)
 * must never land in a shared cache, so those are served `no-store`.
 */
function successCacheControl(cacheable: boolean): string {
  return cacheable ? "public, max-age=300" : "no-store";
}

/**
 * Build a LaMetric success frame containing the chart data.
 * Shape preserved verbatim: {"frames":[{"index":0,"chartData":[...]}]}
 */
function successFrame(chartData: number[], cacheable: boolean): Response {
  return new Response(JSON.stringify({ frames: [{ index: 0, chartData }] }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": successCacheControl(cacheable),
    },
  });
}

/**
 * Build a LaMetric error frame. Shape preserved verbatim, including `icon`
 * being the literal string "null" (not JSON null):
 *   {"frames":[{"index":0,"text":"<message>","icon":"null"}]}
 *
 * Always returned with HTTP 200 so LaMetric renders the message instead of
 * falling back to its default "Notifications" banner on a 500.
 */
function errorFrame(message: string): Response {
  return new Response(
    JSON.stringify({ frames: [{ index: 0, text: message, icon: "null" }] }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * LaMetric icon IDs for the PR-status frames. These are plain icon-gallery IDs
 * (strings like "iNNNN" for static, "aNNNN" for animated). The defaults below
 * are sensible placeholders — browse https://developer.lametric.com/icons and
 * swap in the exact icons you want; the frame text ("3 pass", "1 fail") keeps
 * every frame legible even if an ID is wrong or the icon is missing.
 */
const ICON_PR = "i100"; // pull request / open PRs
const ICON_PASS = "i120"; // green check — all checks passing
const ICON_FAIL = "i552"; // red cross — a check failed
const ICON_PENDING = "i2143"; // hourglass — checks queued / running
const ICON_NONE = "i94"; // neutral dot — no checks configured

/** LaMetric frame: text plus an optional icon, cycled on the device by index. */
interface TextFrame {
  index: number;
  text: string;
  icon: string;
}

/**
 * Build the LaMetric PR-status response: a total-open-PRs frame followed by one
 * frame per non-empty status bucket (passing / failing / pending / no-checks),
 * each an indicator icon plus its count. All frames cycle on the device.
 */
function prStatusFrames(
  summary: PrStatusSummary,
  cacheable: boolean,
): Response {
  const frames: TextFrame[] = [];
  const push = (text: string, icon: string): void => {
    frames.push({ index: frames.length, text, icon });
  };

  if (summary.total === 0) {
    push("No open PRs", ICON_PR);
  } else {
    push(`${summary.total} PR${summary.total === 1 ? "" : "s"}`, ICON_PR);
    if (summary.failing > 0) push(`${summary.failing} fail`, ICON_FAIL);
    if (summary.pending > 0) push(`${summary.pending} busy`, ICON_PENDING);
    if (summary.passing > 0) push(`${summary.passing} pass`, ICON_PASS);
    if (summary.none > 0) push(`${summary.none} none`, ICON_NONE);
  }

  return new Response(JSON.stringify({ frames }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": successCacheControl(cacheable),
    },
  });
}

function httpErrorMessage(status: number): string {
  if (status === 401) {
    return "GitHub auth error";
  }
  if (status === 403 || status === 429) {
    return "Rate limited";
  }
  return "GitHub error";
}

async function fetchContributionDays(
  username: string,
  token: string,
): Promise<FetchResult> {
  const now = Date.now();
  const dateTo = new Date(now).toISOString();
  const dateFrom = new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { login: username, dateFrom, dateTo },
    }),
  });

  if (!res.ok) {
    return { ok: false, message: httpErrorMessage(res.status) };
  }

  let json: GraphQLResponse;
  try {
    json = (await res.json()) as GraphQLResponse;
  } catch {
    return { ok: false, message: "GitHub error" };
  }

  if (json.errors && json.errors.length > 0) {
    return { ok: false, message: "GitHub error" };
  }

  const user = json.data?.user;
  if (user == null) {
    return { ok: false, message: "User not found" };
  }

  const weeks = user.contributionsCollection?.contributionCalendar?.weeks;
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return { ok: false, message: "User not found" };
  }

  const days: number[] = [];
  for (const week of weeks) {
    for (const day of week?.contributionDays ?? []) {
      days.push(day?.contributionCount ?? 0);
    }
  }

  if (days.length === 0) {
    return { ok: false, message: "User not found" };
  }

  return { ok: true, days };
}

async function fetchOpenPullRequests(
  username: string,
  token: string,
): Promise<PrFetchResult> {
  const searchQuery = `is:pr is:open draft:false author:${username}`;

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: PR_QUERY,
      variables: { searchQuery, first: MAX_PRS },
    }),
  });

  if (!res.ok) {
    return { ok: false, message: httpErrorMessage(res.status) };
  }

  let json: SearchResponse;
  try {
    json = (await res.json()) as SearchResponse;
  } catch {
    return { ok: false, message: "GitHub error" };
  }

  if (json.errors && json.errors.length > 0) {
    return { ok: false, message: "GitHub error" };
  }

  const nodes = json.data?.search?.nodes;
  if (!Array.isArray(nodes)) {
    return { ok: false, message: "GitHub error" };
  }

  const prs: PullRequestStatus[] = [];
  for (const node of nodes) {
    if (node == null) {
      continue;
    }
    const rollup =
      node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
    prs.push({ state: rollup });
  }

  return { ok: true, prs };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      // Token resolution. A per-user `?token=` (supplied by the LaMetric app
      // config) takes precedence over the deployment-wide GITHUB_TOKEN secret,
      // so one Worker can serve many installers. When the token came from the
      // URL the response must never be cached in a shared cache.
      const queryToken = (url.searchParams.get("token") ?? "").trim();
      const token = queryToken || env.GITHUB_TOKEN;
      const cacheable = queryToken === "";

      if (!token) {
        return errorFrame("Missing GITHUB_TOKEN");
      }

      const rawUsername = url.searchParams.get("username");
      const username = (rawUsername ?? "").trim();

      if (username === "") {
        // Preserve the two distinct messages from the original Validator:
        // absent param -> "Missing"; present-but-empty -> "Invalid".
        return errorFrame(
          rawUsername === null
            ? "Missing username argument"
            : "Invalid username argument",
        );
      }

      // PR-status mode: aggregate CI/job status across the user's open PRs.
      if (url.pathname === "/pull-requests" || url.pathname === "/prs") {
        const prResult = await fetchOpenPullRequests(username, token);
        if (!prResult.ok) {
          return errorFrame(prResult.message);
        }
        return prStatusFrames(summarizePrStatuses(prResult.prs), cacheable);
      }

      // Default mode: contribution spike chart.
      const result = await fetchContributionDays(username, token);
      if (!result.ok) {
        return errorFrame(result.message);
      }

      return successFrame(weightActivity(result.days), cacheable);
    } catch {
      // Last-resort guard: never surface a 500 to LaMetric.
      return errorFrame("Internal error");
    }
  },
};

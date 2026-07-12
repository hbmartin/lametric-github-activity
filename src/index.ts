import { weightActivity } from "./weight";

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

/**
 * Build a LaMetric success frame containing the chart data.
 * Shape preserved verbatim: {"frames":[{"index":0,"chartData":[...]}]}
 */
function successFrame(chartData: number[]): Response {
  return new Response(JSON.stringify({ frames: [{ index: 0, chartData }] }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (!env.GITHUB_TOKEN) {
        return errorFrame("Missing GITHUB_TOKEN");
      }

      const params = new URL(request.url).searchParams;
      const rawUsername = params.get("username");
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

      const result = await fetchContributionDays(username, env.GITHUB_TOKEN);
      if (!result.ok) {
        return errorFrame(result.message);
      }

      return successFrame(weightActivity(result.days));
    } catch {
      // Last-resort guard: never surface a 500 to LaMetric.
      return errorFrame("Internal error");
    }
  },
};

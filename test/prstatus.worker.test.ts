import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const env: Env = { GITHUB_TOKEN: "test-token" };

/** Minimal search payload with one PR per rollup state. */
function searchPayload(states: (string | null)[]): string {
  return JSON.stringify({
    data: {
      search: {
        nodes: states.map((state) => ({
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: state === null ? null : { state },
                },
              },
            ],
          },
        })),
      },
    },
  });
}

/** Stub global fetch so the worker never hits the network; returns the mock. */
function stubGitHub(body: string, init?: ResponseInit) {
  const mock = vi.fn(async (..._args: unknown[]) => new Response(body, init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Authorization header the worker sent to GitHub on its first fetch call. */
function sentAuth(mock: ReturnType<typeof stubGitHub>): string | undefined {
  const init = mock.mock.calls[0]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

describe("worker pull-request mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the exact 'Missing GITHUB_TOKEN' frame when the secret is unset", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/pull-requests?username=someone"),
      { GITHUB_TOKEN: "" },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"frames":[{"index":0,"text":"Missing GITHUB_TOKEN","icon":"null"}]}',
    );
  });

  it("returns the 'Missing username argument' frame when username is absent", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/pull-requests"),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"frames":[{"index":0,"text":"Missing username argument","icon":"null"}]}',
    );
  });

  it("builds one frame per non-empty status bucket, most-severe first", async () => {
    stubGitHub(searchPayload(["SUCCESS", "FAILURE", "PENDING", null]));
    const res = await worker.fetch(
      new Request("https://example.com/pull-requests?username=octocat"),
      env,
    );
    expect(res.status).toBe(200);
    // Secret-based (no ?token=) responses are cacheable.
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toBe(
      '{"frames":[' +
        '{"index":0,"text":"4 PRs","icon":"i100"},' +
        '{"index":1,"text":"1 fail","icon":"i552"},' +
        '{"index":2,"text":"1 busy","icon":"i2143"},' +
        '{"index":3,"text":"1 pass","icon":"i120"},' +
        '{"index":4,"text":"1 none","icon":"i94"}' +
        "]}",
    );
  });

  it("shows a single 'No open PRs' frame when the search is empty", async () => {
    stubGitHub(searchPayload([]));
    const res = await worker.fetch(
      new Request("https://example.com/prs?username=octocat"),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"frames":[{"index":0,"text":"No open PRs","icon":"i100"}]}',
    );
  });

  it("uses a per-request ?token= even when the secret is unset, and never caches it", async () => {
    const mock = stubGitHub(searchPayload(["SUCCESS"]));
    const res = await worker.fetch(
      new Request(
        "https://example.com/pull-requests?username=octocat&token=ghp_user",
      ),
      { GITHUB_TOKEN: "" },
    );
    expect(res.status).toBe(200);
    // A token in the URL must not be stored in a shared cache.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(sentAuth(mock)).toBe("Bearer ghp_user");
    expect(await res.text()).toBe(
      '{"frames":[' +
        '{"index":0,"text":"1 PR","icon":"i100"},' +
        '{"index":1,"text":"1 pass","icon":"i120"}' +
        "]}",
    );
  });

  it("prefers the ?token= over the deployment secret", async () => {
    const mock = stubGitHub(searchPayload([]));
    await worker.fetch(
      new Request(
        "https://example.com/pull-requests?username=octocat&token=ghp_user",
      ),
      { GITHUB_TOKEN: "ghp_secret" },
    );
    expect(sentAuth(mock)).toBe("Bearer ghp_user");
  });

  it("maps a rate-limited response to the shared error frame", async () => {
    stubGitHub("", { status: 429 });
    const res = await worker.fetch(
      new Request("https://example.com/pull-requests?username=octocat"),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"frames":[{"index":0,"text":"Rate limited","icon":"null"}]}',
    );
  });
});

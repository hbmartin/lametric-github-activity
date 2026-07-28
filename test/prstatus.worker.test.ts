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

/** Stub global fetch so the worker never hits the network. */
function stubGitHub(body: string, init?: ResponseInit): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init)),
  );
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

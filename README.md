# GitHub Activity for LaMetric

Display the last ~36 days of your GitHub contributions as an 8-pixel spike chart on your
LaMetric device.

This is a single [Cloudflare Worker](https://developers.cloudflare.com/workers/): LaMetric
polls the Worker URL, the Worker queries the [GitHub GraphQL API](https://docs.github.com/en/graphql)
for your contribution calendar, and returns LaMetric-formatted frames. There is no PHP and no
server to host — just the Worker and a GitHub token.

The Worker always responds with `HTTP 200` and a valid `{"frames":[…]}` body. On any failure
(bad username, token problem, rate limit) it returns a readable text frame instead of an error,
so the device never falls back to its blank "Notifications" placeholder.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (Workers free tier is enough)
- A GitHub Personal Access Token (see below)

## GitHub token (minimal scope)

Contribution-calendar data is public, so a **classic PAT with only the `read:user` scope** is
sufficient. You do **not** need `repo` or `public_repo`. Create one at
<https://github.com/settings/tokens>.

## Setup

```bash
npm install
```

### Secrets

| Secret | Where | How |
| --- | --- | --- |
| `GITHUB_TOKEN` | Worker (production) | `npx wrangler secret put GITHUB_TOKEN`, then paste the PAT |
| `GITHUB_TOKEN` | Local dev | `cp .dev.vars.example .dev.vars` and paste the PAT into `.dev.vars` |
| `CLOUDFLARE_API_TOKEN` | GitHub repo secret | Cloudflare dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub repo secret | Cloudflare dashboard → Workers overview |

`.dev.vars` is gitignored and the Worker `GITHUB_TOKEN` is set once via `wrangler secret put`
(it persists across deploys), so no token is ever committed or passed through CI.

## Develop

```bash
npm run dev        # wrangler dev on http://localhost:8787
npm test           # vitest — weighting algorithm + error-frame shape
npm run typecheck  # tsc --noEmit
```

## Deploy

Pushes to `master` deploy automatically via `.github/workflows/deploy.yml` (which runs
`typecheck` + `test` first). You can also trigger it manually from the Actions tab
(`workflow_dispatch`), or deploy from your machine:

```bash
npm run deploy
```

The first deploy prints the public URL, e.g.
`https://lametric-github-activity.<your-subdomain>.workers.dev`.

## Point LaMetric at it

The poll URL is your Worker URL with your GitHub login as a query param:

```
https://lametric-github-activity.<your-subdomain>.workers.dev/?username=YOUR_GITHUB_LOGIN
```

- **Easiest (no-code):** install the **My Data DIY** app on your clock and set its request URL
  to the URL above.
- **Published app:** in the [LaMetric developer portal](https://developer.lametric.com), create
  an Indicator (Poll) app with a `username` text field and the same poll URL.

## Debug

Hit the URL directly — you should always get `HTTP 200` and valid frame JSON:

```bash
curl -i "https://lametric-github-activity.<your-subdomain>.workers.dev/?username=YOUR_GITHUB_LOGIN"
# {"frames":[{"index":0,"chartData":[0,2,5,...]}]}
```

If something is wrong, the response is a readable error frame, e.g.
`{"frames":[{"index":0,"text":"User not found","icon":"null"}]}`. If the device shows the
blank "Notifications" banner again, it means the response was not valid frames — re-run the
curl above to see what came back.

## Credits

Originally a PHP app by Pierre Grimaud [@pgrimaud](https://github.com/pgrimaud) and Yannis Obert
[@yannisobert](https://github.com/yannisobert); rewritten as a Cloudflare Worker.

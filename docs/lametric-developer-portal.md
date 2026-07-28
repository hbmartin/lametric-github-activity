# Publishing as a shareable LaMetric app

This guide shows how to publish the Worker as **Indicator (Poll) apps** in the
[LaMetric developer portal](https://developer.lametric.com) so other people can install them and
enter **their own** GitHub username and token — nothing is hardcoded.

The Worker exposes two modes, so you publish two apps (or one app with a mode field):

| App | Poll URL path | Config fields |
| --- | --- | --- |
| Pull request status | `/pull-requests` | `username`, `token` |
| Contribution chart | `/` | `username`, `token` |

## How LaMetric passes configuration to the Worker

When you add configuration parameters to a poll app, LaMetric appends each installer's values to
your data URL as **query parameters** on every poll request:

```
https://<your-worker>/pull-requests?username=VALUE&token=VALUE
```

The Worker already reads exactly these two params:

- **`username`** — whose open PRs to summarise (`author:<username>`).
- **`token`** — a per-user GitHub token. It **takes precedence** over the Worker's
  `GITHUB_TOKEN` secret, so a single deployment can serve many installers. When a request
  carries `?token=`, the Worker responds with `Cache-Control: no-store` so the token-bearing URL
  is never held in a shared cache.

> If you'd rather run this only for yourself, skip the `token` field and set the token once as a
> Worker secret (`npx wrangler secret put GITHUB_TOKEN`); then installers only need `username`.
> See the main [README](../README.md).

## Prerequisites

1. The Worker deployed to a public URL, e.g.
   `https://lametric-github-activity.<subdomain>.workers.dev` (see the README's Deploy section).
2. A [LaMetric developer account](https://developer.lametric.com).
3. Confirm the endpoint works before wiring up LaMetric:
   ```bash
   curl -i "https://<your-worker>/pull-requests?username=YOUR_LOGIN&token=YOUR_PAT"
   # 200 + {"frames":[{"index":0,"text":"3 PRs","icon":"i100"}, ...]}
   ```

## Create the Pull request status app

In the developer portal:

1. **Create app → Indicator app.**
2. Pick an **icon** and an **initial value** shown before the first poll (e.g. `PRs`).
3. Set the communication type to **Poll** (not Push).
4. In **"URL to get data from"**, enter your PR-status endpoint:
   ```
   https://<your-worker>/pull-requests
   ```
   Enter the base URL only — do **not** hardcode `?username=`/`?token=`; the config fields below
   supply them.
5. Set **Poll frequency**. Every ~5–10 minutes is plenty and stays well within GitHub's rate
   limits; polling every few seconds will get you `Rate limited` frames.
6. Add the **configuration parameters** (these become the query params LaMetric sends). Add two
   text parameters:

   | Parameter name | Type | Required | Notes |
   | --- | --- | --- | --- |
   | `username` | text | yes | GitHub login whose PRs to show |
   | `token` | text (secret) | yes | GitHub PAT — see [Token](#the-token-field) |

   Name them **exactly** `username` and `token` (case-sensitive) — the Worker reads those keys.
   The portal shows a **sample of the parameters clocks will send**; confirm it renders as
   `…/pull-requests?username=…&token=…`.
7. Enter the app **name and description**. In the description, tell installers to paste a GitHub
   token with the scope described below.
8. Click **UPDATE** to publish, then install/reinstall the app on your device to test. On the
   device the app cycles: total open PRs, then `N fail` / `N busy` / `N pass` / `N none`.

### Publishing scope

- **Private (just you / a link):** publish privately and install from your own account. Best while
  testing, and fine for sharing with a few people.
- **Public (LaMetric market):** submit for review to list it publicly. Because installers paste a
  token that travels in the URL, read [Security](#security-the-token-in-the-url) first.

## Create the Contribution chart app (optional)

Same steps, with:

- **URL to get data from:** `https://<your-worker>/` (root path).
- **Config fields:** `username` (required). Add `token` only if you want per-user tokens here too;
  the contribution chart works with a token that has just `read:user`.

## The token field

The `token` value is passed straight through as the GitHub API bearer token. Give installers clear
guidance on what to create at <https://github.com/settings/tokens>:

- **Simple (classic PAT):** `repo` scope to include private repos, or `public_repo` for public
  repos only. `read:user` alone is **not** enough for PR check status.
- **Tighter (fine-grained PAT):** read-only access limited to the relevant repositories, granting
  **Pull requests: Read** plus **Checks: Read** and **Commit statuses: Read** (the PR mode reads
  the head commit's `statusCheckRollup`, which aggregates both).

Recommend a **short expiry** and that installers can revoke it anytime.

## Security: the token in the URL

LaMetric delivers config fields as query parameters, so the token appears in the poll URL. That
means:

- It transits and is stored by LaMetric's servers, and can appear in access logs.
- The Worker mitigates its side by sending `Cache-Control: no-store` for any `?token=` request and
  never logging the token. It cannot control LaMetric's or intermediaries' handling.

Therefore:

- Recommend **read-only, minimally-scoped, short-lived** tokens (see above).
- Never reuse a high-privilege token here.
- For a large public launch, a proper **OAuth** authorization flow (so the token never rides in the
  URL) is the more robust design — a larger change than this guide covers.

## Field reference

| Query param | Required | Example | Meaning |
| --- | --- | --- | --- |
| `username` | yes | `hbmartin` | GitHub login; PRs are matched with `author:<username>` |
| `token` | yes¹ | `ghp_…` / `github_pat_…` | GitHub PAT; overrides the Worker `GITHUB_TOKEN` secret |

¹ Optional if the deployment sets a `GITHUB_TOKEN` secret and you don't add a `token` field.

## Troubleshooting

The Worker always returns HTTP 200 with a readable frame, so whatever shows on the device tells you
what to fix:

| Frame text | Cause | Fix |
| --- | --- | --- |
| `Missing GITHUB_TOKEN` | no `token` param and no Worker secret | add the `token` field (or set the secret) |
| `Missing username argument` | no `username` param | add/populate the `username` field |
| `GitHub auth error` | bad/expired token | regenerate the PAT |
| `Rate limited` | polling too often / API limit | increase the poll interval |
| `User not found` | username typo (contribution mode) | check the login |
| `GitHub error` | token lacks scope, or GitHub-side error | grant `repo`/`public_repo` (or the fine-grained perms) |
| `No open PRs` | you have no open, non-draft PRs | nothing to fix — expected |

## Sources

- LaMetric — [First Indicator App guide](https://docs.lametric.com/en/latest/guides/first-steps/first-lametric-indicator-app.html)
- LaMetric Support — [Indicator App](https://help.lametric.com/support/solutions/articles/6000011972-indicator-app),
  [Creating a GitHub Followers App](https://help.lametric.com/support/solutions/articles/6000105072-creating-github-followers-app-for-lametric)

# YouNeiGui 🎬

> [中文](./README.md) · English

> **"Rat. Kill the deal."** —— *Infernal Affairs*, 2002

---

## What is this?

YouNeiGui is an **equal-sided, burn-after-chat, zero-social-residue** ephemeral communication window.

### What problem does it solve?

```
A cold-caller wants your WeChat to pitch a product.
You don't want to add them, but you feel bad saying no.
      ↓
You're stuck in an awkward "temporary conversation" with no exit.
      ↓
YouNeiGui gives you a negotiation window:
  ✅ If it works out → exchange contacts freely (we don't interfere)
  ✅ If it bombs → anyone taps "End Room" once. Data vanishes instantly.
```

### Core design

- **Equal termination right**: Both creator and participant can end the room. No confirmation needed from the other side.
- **Dual-layer destruction**: Manual end (prioritized, immediate and controllable) + TTL auto-destroy (safety net, so you never forget).
- **Zero social residue**: No friend system, no chat history feed, no contact list stored anywhere.
- **Human-only**: OAuth login keeps bots out, but we don't reuse your social identity across rooms.
- **Markdown export**: Grab the transcript before destroy. After destroy — gone forever.

---

## Quick Start (local dev)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables (copy from .env.example)
cp .env.example .env
# edit .env and fill in OAuth AppID / Secret

# 3. Start Redis (Docker required)
docker run -d --name youneigui-redis -p 6379:6379 redis:alpine

# 4. Run the dev server
npm run dev
# visit http://localhost:3000
```

## Docker Compose deployment

```bash
# one-shot start after configuring .env
docker-compose up -d

# visit http://your-server:3000
```

## OAuth setup

The current release supports **GitHub OAuth** only. Apply at:

👉 [github.com/settings/developers → New OAuth App](https://github.com/settings/developers)

| Field | What to put |
|-------|-------------|
| Application name | YouNeiGui Dev (or your own name) |
| Homepage URL | `http://localhost:3000` (or your deployment domain) |
| Authorization callback URL | `http://localhost:3000/auth/github/callback` (must match exactly) |

After creation, grab Client ID + Client Secret and paste into `.env`:

```bash
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
```

### Adding more OAuth providers (WeChat / Weibo / Google / ...)

The codebase is designed as a **single-provider-with-extensible-architecture**. **Recommended flow: fork first, then let AI do the work.**

1. **Fork this repo** → clone locally
2. **Let AI write it**: open Trae / Cursor, point it at the repo, and give it this prompt:
   ```
   Please add <target provider name> OAuth support.

   Reference docs: https://www.passportjs.org/packages/passport-<channel>/
   My Client ID / Secret: <your values>

   Existing architecture:
   - src/config.js holds per-provider clientId / clientSecret
   - src/oauth/index.js registers the passport Strategy plus two routes:
     /auth/<channel> and /auth/<channel>/callback
   - The login page HTML is an inline template inside router.get('/login')
   ```
   It will do everything in one shot: install `passport-<channel>`, add config fields, register the Strategy, wire the two routes, add the login button.
3. Manually verify the callback URL matches what you registered → open a PR back (if you want to contribute) or keep it for yourself.

> Why only GitHub in the MVP? Each provider has its own callback URL rules, scope names, and profile field shapes. More providers = bigger test matrix. Ship one that works, let the community and AI handle expansion.

---

## i18n (multi-language)

Ships with **Chinese (default) + English**. Top-right toggle `EN / 中` stores the choice in `localStorage` and takes effect after refresh.

### Architecture

- **Frontend**: `public/js/i18n.js` — Chinese source strings are the dictionary keys. At runtime, a TreeWalker walks all text nodes under `<body>` and replaces matches. Zero changes required to existing HTML.
- **Backend Markdown export**: `src/export/routes.js` accepts `?lang=en`, has two template sets (zh / en), and switches `Date.toLocaleString` locale accordingly.

### Adding a new language (Japanese / Korean / French / ...)

**Recommended flow: fork first, then let AI translate.**

1. **Fork this repo** → clone locally
2. **Let AI translate**: open Trae / Cursor, give it this prompt:
   ```
   Please add <target language> support.

   Two files to change:
   1. public/js/i18n.js — copy the existing LANGS.en block to LANGS.<lang>,
      translate every English value into <target language>
   2. src/export/routes.js — copy the existing I18N.en block to I18N.<lang>,
      translate every English value into <target language>

   Notes:
   - In the zh → en dictionary, Chinese is the key and English is the value
   - Make sure every zh entry has a corresponding <target language> value
   - Also add a case '<lang>': dateLocale = '<lang>-<REGION>' in the switch inside export/routes.js
   ```
3. Refresh the page manually, click the top-right toggle to verify → open a PR or keep it for yourself.

---

## Project structure

```
youneigui/
├── docs/
│   └── PRD.md
├── src/
│   ├── oauth/        # OAuth login module
│   ├── room/         # Room (session) management module
│   ├── ws/           # WebSocket realtime module
│   └── export/       # Markdown export module
├── public/           # Frontend static assets (single-page HTML + vanilla JS)
├── redis/            # Redis data model and scripts
├── docker-compose.yml
├── .env.example
└── LICENSE
```

## Security boundary

- ✅ Full-site HTTPS
- ✅ Chat content lives only in Redis with TTL. No persistent database.
- ✅ Exported files are generated on-the-fly and returned immediately — never stored on disk.
- ✅ After destroy, only redacted audit logs remain (room ID, timestamps, member count). No chat content.

> This product is for privacy-friendly casual communication. It does **not** constitute a compliant secure-communication solution and does not replace NDAs or formal contracts.

## What it explicitly does NOT do

- ❌ No friend system, no groups, no profile pages
- ❌ No session history list
- ❌ No read receipts, no online status
- ❌ No scraping of WeChat / Weibo nicknames or avatars
- ❌ No one-tap "open WeChat" or "copy WeChat ID"
- ❌ No screenshot prevention (technically impossible to enforce)

## License

AGPL-3.0 © YouNeiGui contributors

## Contributing

Issues and PRs welcome. This is an open-source validation project — come build it with us.

---

### Known risks

- WeChat's in-app browser may intercept third-party OAuth callbacks. Needs real-device testing.
- WeChat snsapi_base web authorization requires a verified service account — individuals may not qualify.
- Screenshots cannot be technically blocked. The product only reduces the risk of long-term conversation residue.

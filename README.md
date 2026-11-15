# AiKavach - IntentLock / TrustGraph

## Run locally
1. Install Node.js LTS.
2. Extract this ZIP and open the `aikavach-live-api-v3` folder in VS Code.
3. Open Terminal > New Terminal.
4. Run `npm install` (requires internet for the first install).
5. Run `npm run dev` and open the local URL printed in the terminal.
6. Open Settings and enter your Groq API key. Do not commit or share the key.

## Improvements in this version
- Attack Replay now checks that meaningful input exists, analyzes the current trusted-intent and untrusted-payload text/images, validates the response schema, and shows errors rather than silently accepting malformed output.
- Red Team validates all four required categories and the shape of each generated test. These are model-generated conceptual test cases, not proof that a real attack was blocked. It no longer invents threat scores for red-team events.
- Live Analytics export downloads a real PDF report with local metrics, recent event history, and explicit scope/limitations. The report does not invent activity if no events exist.
- Existing image upload and intent-image inputs are preserved.

## Important limitations
- Results are AI-assisted and can be wrong; verify important decisions manually.
- The report includes only local browser event history, not server-wide audit records.
- This is a browser prototype: the Groq key is stored in browser local storage and sent from the browser. Do not use a production or broadly privileged secret here; production should move AI calls to a secured backend.


## Secure sign-in and mailbox connection scaffold

This update adds a sign-in screen and Google/Microsoft mailbox-connect entry points while preserving the existing scanner, replay, red-team, analytics, and Groq settings UI. The frontend intentionally does **not** implement fake/local authentication or collect a Gmail/Outlook password.

To make sign-in and mailbox scanning functional, add a backend that implements these endpoints:
- `POST /api/auth/login` — verify AiKavach account credentials using a secure password hash and issue a server-side session cookie (`HttpOnly`, `Secure`, `SameSite`).
- `POST /api/auth/logout` — invalidate the session.
- `GET /api/oauth/google/start` and `GET /api/oauth/microsoft/start` — begin the provider's OAuth 2.0 authorization-code flow with state/PKCE and least-privilege mailbox-read scopes.
- OAuth callback endpoints — validate state, exchange the code server-side, securely store tokens, and show the granted scopes to the user.
- A mailbox scan endpoint — fetch only messages authorized by the user, apply rate limits, protect tokens, and avoid logging message bodies or secrets.

Do not request provider passwords, email a password to anyone, or treat opening an email as consent. Use the official Google/Microsoft consent page and provide a way to disconnect/revoke access. The current ZIP is a **frontend scaffold**; without the backend endpoints, login and mailbox connection will show an unavailable-service error or require backend routing.

## Backend authentication (new)
The project now includes `server.js`, a SQLite-backed account API, hashed passwords, session cookies, and Google/Microsoft OAuth authorization-start and callback routes. Copy `.env.example` to `.env`, set a long random `SESSION_SECRET`, and configure OAuth client credentials and callback URLs in the provider consoles. Never collect Gmail/Outlook passwords.

Run two terminals:
1. `npm install`
2. Terminal A: `npm run server`
3. Terminal B: `npm run dev`

Create an account by POSTing JSON `{ "email": "you@example.com", "password": "at-least-10-characters" }` to `/api/auth/register` (or wire a registration form to that endpoint). Login uses `/api/auth/login`. OAuth tokens are stored server-side in SQLite. Message retrieval/scanning intentionally remains disabled (`501`) until provider-specific scanning, token refresh, revocation, and data-retention policies are implemented and tested. Configure OAuth redirect URIs exactly as listed in `.env.example`. For production, use HTTPS, a strong secret, secure cookie settings, CSRF protection, rate limiting, encrypted token storage, and a persistent session store.


## Windows installation note
This local-development package removes native SQLite modules so `npm install` does not need Python or Visual Studio C++ Build Tools. It stores demo account/token data in `aikavach-data.json` and uses Express MemoryStore for sessions. This is for local testing only, not production. Use a secure persistent database/session store and encrypted token storage before deployment. Mailbox message scanning remains intentionally disabled until implemented.


## Google mailbox connection (local development)
1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. In Google Cloud Console, configure the OAuth consent screen and create an OAuth Client ID (Web application).
4. Add `http://localhost:5174` as an Authorized JavaScript origin (use the exact Vite origin shown in your terminal).
5. Add `http://localhost:3001/api/oauth/google/callback` as an Authorized redirect URI.
6. Put the OAuth client ID and client secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. Never put the secret in frontend code or commit `.env`.
7. Run `npm run server` in one terminal and `npm run dev` in another. Create an AiKavach account in the login screen, sign in, then start Google connection from the app.

Google OAuth consent is required. This project does not bypass Google authorization. The mailbox messages endpoint currently returns 501; actual Gmail message fetching/scanning still needs implementation.

## Redesign + fixes (v4)

- New "field manual" interface: paper/ink/marigold/vermilion/lime palette, stamped verdicts, segmented threat meter.
- Fixed: the **Run live security scan** button passed the click event into the scanner and crashed; it now calls it correctly.
- Fixed: Red Team asked Groq for a JSON array, but JSON mode only returns objects; tests now come back under a `"tests"` key.
- Fixed: scanning a Gmail message no longer attaches leftover images from the manual form.
- Added: optional `FRONTEND_URL` env var (default `http://localhost:5173`) for the OAuth return redirect.
- Added: refreshed Google access tokens are saved, so they are not re-refreshed on every request.
- Added: Disconnect Google button, mailbox status refresh after sign-in, and auto-open of the Inbox tab after Google consent.

# Connecting Zendo to your Microsoft 365 calendar

This is the setup for iteration 3 (Microsoft Graph on the local server). It is written for the owner of a small tenant who is also its administrator. Nothing here is needed for the prototype; the prototype imports `.ics` files.

## How hard is it?

**About ten minutes of clicking, once.** You create an "app registration" in the Microsoft Entra admin centre, copy two IDs into a local `.env` file, and sign in once in your browser when Zendo asks. There is no code to write, no server to host, and no secret to manage: Zendo registers as a *public client*, which is the type Microsoft intends for apps running on your own machine.

What can make it harder:

- If your Microsoft 365 is administered by an external IT provider who has switched off "Users can register applications", they have to do the registration (or grant you the *Application Developer* role). Default tenants allow it.
- If you ever move to a different tenant or add an Outlook.com account, the registration needs a different "supported account types" setting.

What stays simple:

- Permission is `Calendars.Read` only (read your own calendar). It needs no admin consent in a default tenant, and as the admin you can grant it anyway.
- Tokens are cached in `data/` (gitignored). Refresh tokens last 90 days, so you sign in roughly four times a year.

## Steps

1. Open https://entra.microsoft.com → **Identity → Applications → App registrations → New registration**.
2. Name: `Zendo (local)`. Supported account types: **Accounts in this organizational directory only** (single tenant). Redirect URI: platform **Mobile and desktop applications**, URI `http://localhost`. Register.
3. On the overview page copy **Application (client) ID** and **Directory (tenant) ID**.
4. **API permissions → Add a permission → Microsoft Graph → Delegated → `Calendars.Read`** (or `Calendars.ReadBasic` for the least privilege). Optionally **Grant admin consent** so you are never asked.
5. **Authentication → Advanced settings → Allow public client flows: Yes** (needed for the loopback/PKCE flow).
6. In the repo, copy `.env.example` to `.env` and fill in `MS_CLIENT_ID` and `MS_TENANT_ID`. Never create or paste a client secret.
7. Verify: `npm run calendar:check`. A browser window opens for sign-in; the script then lists your next seven days with their show-as status and exits. Nothing is stored.
8. Start Zendo with `npm run dev` (this also starts the local calendar service on port 5174), open Settings → Microsoft 365 → **Connect Microsoft 365**. The browser opens once for sign-in; afterwards the calendar syncs on every app start and on "Sync now". Tokens are cached in `data/msal-cache.json` (gitignored). **Disconnect** deletes the cache.

## On a hosted server

The same registration works when Zendo runs on a server (`ZENDO_CALENDAR_LOGIN=device`, which the Dockerfile sets). There is no browser on the server, so **Connect Microsoft 365** shows a short code instead: open the shown link (microsoft.com/devicelogin) on any device, enter the code and sign in. Settings continues by itself once you are signed in. This uses the device-code flow, which also depends on **Allow public client flows: Yes** (step 5). Tokens are cached in the server's data volume.

To move an existing local connection instead, copy `data/msal-cache.json` into the server's data directory together with the database; the refresh token keeps working there.

## What Zendo reads and how it maps it

- `GET /me/calendarView?startDateTime&endDateTime` for the visible range (one week back, five weeks ahead). Recurring series arrive already expanded as single occurrences.
- `showAs` → availability: `free` never blocks time; `tentative`, `busy`, `oof`, `workingElsewhere` block. All-day `free` entries (other people's holidays, reminders) are shown muted and ignored for capacity.
- `isCancelled` → skipped. `isAllDay` → all-day event. `sensitivity` private/personal/confidential → private event (masked while private items are hidden).
- Subject, location and online-meeting flag → kind heuristics (online, in person, workshop, coaching); you can override the kind and link a project, and these overrides survive every sync.
- `onlineMeeting.joinUrl` (Teams), else a Teams/Zoom/Webex/Meet link in the location or `bodyPreview` → the event's Join button. The body preview is only scanned for that link, never stored.
- Each sync replaces the previously synced events (moved and deleted meetings disappear; manual Zendo events and `.ics` imports are untouched). Range: last week to five weeks ahead.
- Multi-day all-day events (holidays, trips) become one entry per day.

## Fallback without an app registration

Outlook on the web → Settings → Calendar → Shared calendars → **Publish a calendar** → ICS link. Zendo's server can poll that link. Downsides: the link is a secret, recurring series come as rules with a limited horizon, and your admin may have disabled publishing. Use it only if the registration above is blocked.

# Zendo on a TRMNL display

Zendo can show your plan on a [TRMNL](https://trmnl.com) e-ink display. It has three screens, and each installation of the plugin shows one of them:

| Screen | Shows |
|---|---|
| **Today's to-dos** | Open tasks planned for today (timed ones first, with their time), open tasks due today or overdue, and one next step per project blocked in today's week plan, as on the Today page. |
| **Today's schedule** | A time grid of the day with meetings (black) and tasks planned for a time (outlined), the "now" line and the Today page's capacity line. |
| **Week** | The next five days from today: how full each day is, the hours still free, the plan blocks per project, all-day appointments and workshops by name, and the number of other meetings. Days off appear only when something is planned on them. |

Install the plugin three times (one per screen) and put them into your TRMNL playlist. Each screen also has a compact version for TRMNL mashups (half or quarter screen).

**Privacy.** TRMNL's servers fetch and render the screens, so your plan passes through TRMNL. Private projects and tasks are never sent, whatever the app's "hide private" setting, and private appointments only appear as "Busy". Zendo stores no TRMNL tokens, only their SHA-256 hashes.

## How it works

Zendo acts as a TRMNL plugin ([TRMNL plugin docs](https://docs.trmnl.com/go/plugin-marketplace/introduction)):

1. **Install.** In TRMNL you click *Install*, and TRMNL sends your browser to `/trmnl/install`. You sign in (hosted: at the login proxy) and pick the screen. Zendo exchanges TRMNL's one-time code for an access token and sends you back to TRMNL, where you click *Save*.
2. **Confirm.** TRMNL calls `/trmnl/installed` with that token. Only now does the installation become active. If `ZENDO_TRMNL_ACCOUNTS` is set, it must be completed by one of those TRMNL accounts.
3. **Screens.** Every refresh, TRMNL calls `/trmnl/markup` with the token. Zendo answers with HTML for the four TRMNL layouts (`markup`, `markup_half_horizontal`, `markup_half_vertical`, `markup_quadrant`).
4. **Configure.** *Configure* on the plugin in TRMNL opens `/trmnl/manage`, where you can switch that installation to another screen.
5. **Remove.** Uninstalling in TRMNL calls `/trmnl/uninstalled`, and Zendo forgets the installation.

The screens are built in `server/trmnl-screens.ts` from the same rules as the Today and Week pages (`src/domain/selectors.ts`). They are black on white only, because the original TRMNL dithers grey, and they are in the app's language (Settings).

## Setup

### 1. Zendo

In the server's `.env` (hosted: the app's compose file):

```bash
ZENDO_TRMNL=1
ZENDO_OAUTH_USERS=you@example.com        # hosted: who may install (as signed in at the login proxy)
# ZENDO_TRMNL_ACCOUNTS=you@example.com   # TRMNL account e-mail(s); default: ZENDO_OAUTH_USERS
TZ=Europe/Berlin                          # "today" and "now" on the screens
```

After a restart, the log shows `TRMNL: https://zendo.example.com/trmnl`. Running locally without `ZENDO_PUBLIC_URL`, only a browser on the same machine may install, and any TRMNL account is accepted unless `ZENDO_TRMNL_ACCOUNTS` is set. TRMNL's servers must be able to reach Zendo, so a local Zendo needs a tunnel.

### 2. Login proxy (hosted)

TRMNL's servers call three paths without a browser session; the token protects them. The installation and configuration pages stay behind the login, because Zendo reads the signed-in e-mail from the proxy there.

| Path | Login proxy |
|---|---|
| `/trmnl/install`, `/trmnl/manage` | **behind** `forward_auth` |
| `/trmnl/installed`, `/trmnl/markup`, `/trmnl/uninstalled` | bypass |

Caddy, inside the site block and before the login (next to the MCP routes, see [mcp.md](mcp.md#hosting-behind-caddy-and-oauth2-proxy)):

```caddy
@trmnl path /trmnl/installed /trmnl/markup /trmnl/uninstalled
handle @trmnl {
	reverse_proxy zendo:5174
}
```

Check afterwards (expect `401`, not a redirect to the login):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://zendo.example.com/trmnl/markup
```

### 3. TRMNL

At trmnl.com → *Plugins* → *My Plugins* → *New*. All fields are required:

| Field | Value |
|---|---|
| Name | Zendo |
| Description | Today's plan and the week (at most 35 characters) |
| Icon | `public/icon-512.png` from this repository |
| No Screen Padding | off |
| Category | Productivity |
| Supported Refresh Interval | every 15 minutes |
| Installation URL | `https://zendo.example.com/trmnl/install` |
| Installation Success Webhook URL | `https://zendo.example.com/trmnl/installed` |
| Plugin Management URL | `https://zendo.example.com/trmnl/manage` |
| Plugin Markup URL | `https://zendo.example.com/trmnl/markup` |
| Uninstallation Webhook URL | `https://zendo.example.com/trmnl/uninstalled` |
| Knowledge Base URL | a link to this page |

The plugin does not need to be published: *Install* tests it on your own account. Install it once per screen, give each installation a name (e.g. "Aufgaben", "Zeitplan", "Woche"), and add them to the playlist.

## Troubleshooting

| Symptom | Cause |
|---|---|
| The install page says the account may not connect | The signed-in e-mail is not in `ZENDO_OAUTH_USERS`. |
| "TRMNL did not accept the installation" | The code exchange at `trmnl.com/oauth/token` failed (see the server log). Start the installation again. |
| The installation completes, but the screen shows an error | TRMNL's confirmation did not arrive or was refused. The server log names the TRMNL account if it is not in `ZENDO_TRMNL_ACCOUNTS`. TRMNL sends the confirmation only once: uninstall and install again. |
| `/trmnl/markup` redirects to the Microsoft login | The Caddy bypass above is missing. |
| The screen is a few minutes behind | TRMNL refreshes every 15 minutes at the fastest; the title bar shows when the screen was made ("As of …"). |

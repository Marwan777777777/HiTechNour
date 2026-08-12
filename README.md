# HighTechNour Attendance

Geofenced check-in/check-out system for HighTechNour Technologies —
replaces WhatsApp live-location sharing across sites.

## What's included

**Backend** (`/backend`) — Node.js + Express + PostgreSQL
- Auth: bcrypt password hashing, JWT sessions, DB-checked on every
  request (disabling a user kills their session immediately, not up to
  12h later)
- Geofencing: server-side Haversine distance, 200m default radius,
  configurable per site
- Device binding with an **admin-approval workflow** — a worker's first
  device is only trusted after an admin approves it (in person or by
  phone), which closes the "attacker checks in first" race condition.
  Lost/replaced phones go through `reset-device`.
- Impossible-travel detection, mock-location flag, low-GPS-accuracy
  flag, off-hours flag, checkout-without-checkin flag
- Admin review queue (flagged + unreviewed only — resolved items drop
  off automatically)
- CSV export for payroll
- Rate limiting on login and check-ins, input validation throughout

**Frontend** (`/frontend`) — vanilla HTML/CSS/JS, installable PWA
- Dark navy / amber theme (HighTechNour's security-tech aesthetic)
- Animated radar/geofence visual on the check-in screen
- Employee view: check in/out, live distance-to-site, recent history
- Admin view: review queue, team management (add workers, approve/reset
  devices, enable/disable accounts), site management, CSV export
- `manifest.json` + service worker so it installs to the home screen
  like a native app (Android: auto-prompt; iOS: Share → Add to Home
  Screen, one-time manual step — an Apple platform restriction, not
  something fixable in code)
- Location permission is requested once via `watchPosition` and the
  browser remembers it for this site afterward

## Setup

### 1. Database (free: neon.tech)
Create a free Postgres project on Neon, copy the connection string.

### 2. Backend
```
cd backend
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET (generate with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# ), CORS_ORIGIN (your deployed frontend URL), SEED_ADMIN_USERNAME/PASSWORD
npm install
npm run migrate   # creates tables + seeds the first admin account
npm start         # or `npm run dev` locally
```
Deploy free on Render or Fly.io. Health check: `GET /health`.

### 3. Frontend
Edit `js/api.js` — set `window.HTN_API_BASE_URL` (in `index.html`, add
a small inline `<script>` before `api.js` loads, e.g.
`window.HTN_API_BASE_URL = "https://your-backend.onrender.com/api";`)
to point at your deployed backend.

Deploy free on Vercel or Netlify (static site — no build step needed).

### 4. Icons
`manifest.json` references `icons/icon-192.png`, `icon-512.png`, and a
maskable `icon-maskable-512.png`. These are placeholders — I can't
generate image files. Ask whoever manages HTN's WordPress site for the
source logo (SVG ideally), then export PNGs at those sizes, or use a
free tool like realfavicongenerator.net once you have the source mark.

### 5. First login
Log in with the `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` from your
`.env`, then use the Team tab to add real workers and the Sites tab to
add your other 14 site locations (the Nasr City HQ address is not yet
pre-seeded — add it as your first site via the admin panel with the
coordinates: lat 30.0452333, lng 31.341210, radius 200m).

## Known tradeoffs (by design, not bugs)
- Device binding on a PWA is a soft signal, not a hardware-level lock —
  a browser can't access real device IDs the way a native app could.
  The admin-approval step is what makes it meaningful anyway: someone
  would need to physically get a worker's phone approved as theirs.
- `isMockLocation` is sent by the client and currently always `false`
  from this web frontend — real GPS-spoofing detection
  (`Location.isFromMockProvider()`) is an Android-native API only
  reachable from a native wrapper, not a browser. Worth knowing if you
  ever wrap this in something like Capacitor later.

# Ableton Tracker

A local dashboard for browsing your Ableton Live project folders — see every
project's BPM, key, size, file/backup counts, and creation/modified dates at
a glance, plus your own rating, status, tags, and notes on top.

<img width="1669" height="680" alt="Screenshot 2026-08-30 at 20 43 56" src="https://github.com/user-attachments/assets/dab197fa-2d54-4aeb-9cad-1adaa2bef1ff" />


It's a small Node.js HTTP server with a plain HTML/JS frontend. Everything
runs locally; nothing leaves your machine.

## Install (macOS, no setup required)

Grab the latest build from [Releases](../../releases) — it's a self-contained
`.app` with Node bundled inside, so you don't need anything else installed.

1. Unzip and drag `Ableton Tracker.app` to Applications.
2. First launch: right-click the app → **Open** → **Open** again. (One-time —
   the app is ad-hoc signed rather than notarized with a paid Apple Developer
   ID, so Gatekeeper needs that nudge once. Every launch after is a normal
   double-click.)
3. It opens a browser tab at `localhost:4173`. Click **Change Folder…** and
   point it at wherever your `.als` projects live.

Your folder choice and any ratings/tags/notes are stored on your Mac in
`~/Library/Application Support/Ableton Tracker` — nothing is sent anywhere.
That metadata stays attached to a project even if you later rename it or
move it to a different folder, since each project folder gets a small
hidden ID marker rather than being tracked by its path.

### Backing up / editing your metadata

Use **Export** to save all your ratings, statuses, tags, and notes (plus
the scanned project info) as a `.json` or `.xlsx` file — handy for backups,
bulk-editing ratings and notes in a spreadsheet, or moving metadata to
another Mac. **Import** reads one of those files back in and merges it into
your library, matched by each project's stable ID (falling back to its
relative path if the ID isn't found). Rows for projects that aren't
currently scanned are kept and applied automatically once that project
reappears, e.g. after reconnecting an external drive.

## Running from source

```sh
npm start        # or: node server.js
```

Defaults to scanning `~/Music/Ableton`; override with `ABLETON_DIR=/path/to/projects`.

## Building the app bundle

```sh
VERSION=2.1 npm run build:mac
```

Builds a self-contained, ad-hoc-signed `Ableton Tracker.app` (plus a
matching `.zip`) into `dist/` — bundling the Node runtime for both Apple
Silicon and Intel so recipients don't need Node installed. `dist/` isn't
checked into this repo (a few hundred MB with both runtimes included); the
Node binaries are downloaded from nodejs.org on first build, or reused via
`NODE_ARM64_BIN` / `NODE_X64_BIN` env vars pointing at existing ones.

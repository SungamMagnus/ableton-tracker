# Ableton Tracker

A local dashboard for browsing your Ableton Live project folders — see every
project's BPM, key, size, file/backup counts, and creation/modified dates at
a glance, plus your own rating, status, tags, and notes on top.

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

## Running from source

```sh
npm start        # or: node server.js
```

Defaults to scanning `~/Music/Ableton`; override with `ABLETON_DIR=/path/to/projects`.

## Building the app bundle

The packaged `.app` bundles the Node runtime for both Apple Silicon and
Intel so recipients don't need Node installed. See `dist/` after running the
build (not checked into this repo — it's a few hundred MB with both runtimes
included).

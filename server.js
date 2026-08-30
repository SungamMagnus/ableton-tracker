const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DEFAULT_BASE_DIR = process.env.ABLETON_DIR ||
  path.join(os.homedir(), 'Music', 'Ableton');
const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.ABLETON_TRACKER_DATA_DIR ||
  path.join(os.homedir(), 'Library', 'Application Support', 'Ableton Tracker');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CACHE_MS = 60 * 1000;

// Each project folder gets a small hidden marker file holding a UUID, so a
// project's rating/status/tags/notes stay attached to it even if the folder
// is renamed, moved to a different subfolder, or the scanned base folder is
// changed entirely — none of which change this file's contents. Metadata
// keyed by absolute path (the old scheme) breaks on any of those.
const ID_FILE = '.abletontracker-id';

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2));
  fs.renameSync(tmpFile, CONFIG_FILE);
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Trust the saved folder without checking the filesystem here: this runs before
// the server starts listening, and a stat() into a not-yet-mounted Google Drive
// path (e.g. right after login/reboot, before Drive finishes initializing) can
// block for a long time, delaying the HTTP server past the launcher's timeout.
// If the folder turns out to be missing, scanning just degrades to 0 projects.
const savedConfig = loadConfig();
let BASE_DIR = savedConfig.baseDir || DEFAULT_BASE_DIR;

function escapeAppleScriptString(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const STATUSES = new Set(['sketch', 'needs-arrange', 'needs-mix', 'done']);
const MAX_TAGS = 2;
const MAX_DESCRIPTION_LEN = 1000;

const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SCALE_NAMES = [
  'Major', 'Minor', 'Dorian', 'Mixolydian', 'Lydian', 'Phrygian', 'Locrian',
  'Whole Tone', 'Half-Whole Dim.', 'Whole-Half Dim.', 'Minor Blues', 'Minor Pentatonic',
  'Major Pentatonic', 'Harmonic Minor', 'Harmonic Major', 'Dorian #4', 'Phrygian Dominant',
  'Melodic Minor', 'Lydian Augmented', 'Lydian Dominant', 'Super Locrian', '8-Tone Spanish',
  'Bhairav', 'Hungarian Minor',
];

let cache = null; // { at: number, data: [] }

function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveMeta(meta) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${META_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(meta, null, 2));
  fs.renameSync(tmpFile, META_FILE);
}

// Meta used to be keyed by path-relative-to-BASE_DIR, which broke whenever
// BASE_DIR changed (e.g. pointing it at a subfolder). Re-key any such legacy
// entries by absolute path, resolved against the original default root,
// which is what every legacy key was actually relative to.
function migrateMeta() {
  const meta = loadMeta();
  let changed = false;
  const migrated = {};
  for (const [key, value] of Object.entries(meta)) {
    if (path.isAbsolute(key)) {
      migrated[key] = value;
      continue;
    }
    const candidate = path.resolve(DEFAULT_BASE_DIR, key);
    if (isDir(candidate)) {
      migrated[candidate] = value;
      changed = true;
    } else {
      migrated[key] = value;
    }
  }
  if (changed) saveMeta(migrated);
}

// Returns the project's stable id, creating the marker file on first sight
// of a directory that doesn't have one yet. `migrations` collects
// old-absolute-path -> new-id pairs for freshly-created ids, so callers can
// carry forward any meta that was still keyed the old way (see
// applyMetaMigrations).
function getOrCreateStableId(dir, migrations) {
  const idPath = path.join(dir, ID_FILE);
  try {
    const existing = fs.readFileSync(idPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // No marker yet — fall through and create one.
  }

  const id = crypto.randomUUID();
  try {
    fs.writeFileSync(idPath, id);
  } catch {
    // Read-only or otherwise unwritable location: fall back to a
    // path-based id. Metadata still works, it just won't survive a move
    // for this one project.
    return `path:${path.resolve(dir)}`;
  }
  migrations.push({ oldKey: path.resolve(dir), newKey: id });
  return id;
}

function applyMetaMigrations(migrations) {
  if (!migrations.length) return;
  const meta = loadMeta();
  let changed = false;
  for (const { oldKey, newKey } of migrations) {
    if (meta[oldKey] && !meta[newKey]) {
      meta[newKey] = meta[oldKey];
      delete meta[oldKey];
      changed = true;
    }
  }
  if (changed) saveMeta(meta);
}

function parseAlsMusicalInfo(alsPath) {
  let xml;
  try {
    const raw = fs.readFileSync(alsPath);
    xml = zlib.gunzipSync(raw).toString('utf8');
  } catch {
    return { bpm: null, key: null };
  }

  let bpm = null;
  const tempoBlock = xml.match(/<Tempo>([\s\S]*?)<\/Tempo>/);
  if (tempoBlock) {
    const manual = tempoBlock[1].match(/<Manual Value="([\d.]+)"/);
    if (manual) bpm = Math.round(parseFloat(manual[1]) * 100) / 100;
  }

  let key = null;
  const scaleBlocks = [...xml.matchAll(/<ScaleInformation>\s*<Root Value="(\d+)"\s*\/>\s*<Name Value="(\d+)"\s*\/>\s*<\/ScaleInformation>\s*<InKey/g)];
  if (scaleBlocks.length > 0) {
    const [, rootStr, nameStr] = scaleBlocks[scaleBlocks.length - 1];
    const root = ROOT_NAMES[parseInt(rootStr, 10)];
    const scaleName = SCALE_NAMES[parseInt(nameStr, 10)];
    if (root) key = scaleName ? `${root} ${scaleName}` : root;
  }

  return { bpm, key };
}

function walkSize(dir) {
  let totalSize = 0;
  let fileCount = 0;
  let backupCount = 0;
  let maxMtime = 0;
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        totalSize += st.size;
        fileCount++;
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
        if (current.endsWith(`${path.sep}Backup`) && entry.name.toLowerCase().endsWith('.als')) {
          backupCount++;
        }
      }
    }
  }
  return { totalSize, fileCount, backupCount, maxMtime };
}

function findProjects(dir, base, results, migrations) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const alsFiles = entries.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.als')
  );

  if (alsFiles.length > 0) {
    let created;
    try {
      const dirStat = fs.statSync(dir);
      created = dirStat.birthtimeMs || dirStat.ctimeMs;
    } catch {
      created = Date.now();
    }

    const { totalSize, fileCount, backupCount, maxMtime } = walkSize(dir);
    const rel = path.relative(base, dir);
    const parts = rel.split(path.sep);
    const year = parts.length > 1 ? parts[0] : null;
    const subgroup = parts.length > 2 ? parts.slice(1, -1).join(' / ') : null;
    const name = parts[parts.length - 1].replace(/ Project$/i, '');

    let newestAls = alsFiles[0];
    let newestMtime = -1;
    for (const f of alsFiles) {
      try {
        const st = fs.statSync(path.join(dir, f.name));
        if (st.mtimeMs > newestMtime) {
          newestMtime = st.mtimeMs;
          newestAls = f;
        }
      } catch {
        // skip unreadable file
      }
    }
    const { bpm, key } = parseAlsMusicalInfo(path.join(dir, newestAls.name));

    results.push({
      id: getOrCreateStableId(dir, migrations),
      path: path.resolve(dir),
      name,
      folderName: parts[parts.length - 1],
      relPath: rel,
      year,
      subgroup,
      createdAt: created,
      modifiedAt: maxMtime || created,
      sizeBytes: totalSize,
      fileCount,
      alsCount: alsFiles.length,
      backupCount,
      bpm,
      key,
    });
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      findProjects(path.join(dir, entry.name), base, results, migrations);
    }
  }
}

function scan() {
  const results = [];
  const migrations = [];
  findProjects(BASE_DIR, BASE_DIR, results, migrations);
  applyMetaMigrations(migrations);
  return results;
}

function getProjects() {
  const now = Date.now();
  let data;
  if (cache && now - cache.at < CACHE_MS) {
    data = cache.data;
  } else {
    data = scan();
    cache = { at: now, data };
  }
  const meta = loadMeta();
  return data.map((p) => {
    const m = meta[p.id] || {};
    return {
      ...p,
      rating: m.rating ?? null,
      status: m.status ?? null,
      tags: m.tags ?? [],
      description: m.description ?? '',
    };
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/projects') {
    try {
      const force = url.searchParams.get('refresh') === '1';
      if (force) cache = null;
      const data = getProjects();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ baseDir: BASE_DIR, count: data.length, projects: data }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/meta' && req.method === 'POST') {
    readJsonBody(req)
      .then((body) => {
        const { id, patch } = body;
        if (typeof id !== 'string' || !id || typeof patch !== 'object' || !patch) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id and patch required' }));
          return;
        }

        const meta = loadMeta();
        const current = meta[id] || { rating: null, status: null, tags: [], description: '' };

        if ('rating' in patch) {
          const r = patch.rating;
          current.rating = r === null ? null : Math.min(10, Math.max(1, Math.round(Number(r))));
        }
        if ('status' in patch) {
          current.status = STATUSES.has(patch.status) ? patch.status : null;
        }
        if ('tags' in patch) {
          const tags = Array.isArray(patch.tags) ? patch.tags : [];
          current.tags = tags
            .map((t) => String(t).trim().slice(0, 24))
            .filter(Boolean)
            .filter((t, i, arr) => arr.indexOf(t) === i)
            .slice(0, MAX_TAGS);
        }
        if ('description' in patch) {
          current.description = String(patch.description ?? '').trim().slice(0, MAX_DESCRIPTION_LEN);
        }

        meta[id] = current;
        saveMeta(meta);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, ...current }));
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      });
    return;
  }

  if (url.pathname === '/api/open' && req.method === 'POST') {
    readJsonBody(req)
      .then((body) => {
        const full = typeof body.path === 'string' && path.isAbsolute(body.path) ? body.path : null;
        if (!full || !isDir(full)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid path' }));
          return;
        }
        execFile('open', [full], (err) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      })
      .catch(() => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      });
    return;
  }

  if (url.pathname === '/api/choose-folder' && req.method === 'POST') {
    let script = 'POSIX path of (choose folder with prompt "Select your Ableton projects folder"';
    if (isDir(BASE_DIR)) {
      script += ` default location (POSIX file "${escapeAppleScriptString(BASE_DIR)}")`;
    }
    script += ')';

    execFile('osascript', ['-e', script], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) {
        if (/User canceled/i.test(stderr || '')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ canceled: true }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }

      const chosen = stdout.trim();
      if (!chosen || !isDir(chosen)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid folder' }));
        return;
      }

      BASE_DIR = chosen;
      cache = null;
      saveConfig({ baseDir: BASE_DIR });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baseDir: BASE_DIR }));
    });
    return;
  }

  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(PUBLIC_DIR, filePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Ableton Tracker running at http://localhost:${PORT}`);
  console.log(`Scanning: ${BASE_DIR}`);
  // Runs after the server is already accepting connections, so a slow stat()
  // into a not-yet-ready network mount (see BASE_DIR comment above) can't
  // delay startup.
  migrateMeta();
});

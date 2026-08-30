let projects = [];
let sortKey = 'modifiedAt';
let sortDir = 'desc';
let filterText = '';
let openTagEditor = null; // id of row currently showing the tag input
let openNoteEditor = null; // id of row currently showing the note textarea

const FOLDER_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none"><path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.2 1.5h6.2a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

const STATUS_LABELS = {
  '': '— Status —',
  sketch: 'Sketch',
  'needs-arrange': 'Needs Arrange',
  'needs-mix': 'Needs Mix',
  done: 'Done',
};

const rowsEl = document.getElementById('rows');
const summaryEl = document.getElementById('summary');
const folderPathEl = document.getElementById('folderPath');
const emptyEl = document.getElementById('empty');
const searchEl = document.getElementById('search');
const refreshEl = document.getElementById('refresh');
const changeFolderEl = document.getElementById('changeFolder');
const tableEl = document.getElementById('table');

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
}

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRelative(ms) {
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const month = Math.round(day / 30);
  const year = Math.round(day / 365);

  if (sec < 60) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 30) return `${day}d ago`;
  if (month < 12) return `${month}mo ago`;
  return `${year}y ago`;
}

function locationLabel(p) {
  if (p.subgroup) return `${p.year} / ${p.subgroup}`;
  return p.year || '—';
}

function render() {
  const q = filterText.trim().toLowerCase();
  let filtered = projects;
  if (q) {
    filtered = projects.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      locationLabel(p).toLowerCase().includes(q)
    );
  }

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortKey === 'name') {
      av = a.name.toLowerCase();
      bv = b.name.toLowerCase();
    } else if (sortKey === 'location') {
      av = locationLabel(a).toLowerCase();
      bv = locationLabel(b).toLowerCase();
    } else {
      av = a[sortKey];
      bv = b[sortKey];
    }

    const aEmpty = av === null || av === undefined || av === '';
    const bEmpty = bv === null || bv === undefined || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;

    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();

    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  rowsEl.innerHTML = '';
  emptyEl.classList.toggle('hidden', sorted.length > 0);

  for (const p of sorted) {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.title = p.relPath;
    tr.innerHTML = `
      <td>
        <div class="name-row">
          <div class="proj-name">${escapeHtml(p.name)}</div>
          <button type="button" class="finder-btn" data-open-folder="1" title="Open in Finder">${FOLDER_ICON}</button>
        </div>
        ${p.alsCount > 1 ? `<div class="proj-sub">${p.alsCount} .als files · ${p.backupCount} backups</div>` : (p.backupCount ? `<div class="proj-sub">${p.backupCount} backups</div>` : '')}
      </td>
      <td><span class="tag">${escapeHtml(locationLabel(p))}</span></td>
      <td class="num">${p.bpm ? p.bpm : '<span class="muted">—</span>'}</td>
      <td>${p.key ? escapeHtml(p.key) : '<span class="muted">—</span>'}</td>
      <td>
        <div class="date-main">${formatDate(p.createdAt)}</div>
      </td>
      <td>
        <div class="date-main">${formatRelative(p.modifiedAt)}</div>
        <div class="date-sub">${formatDate(p.modifiedAt)}</div>
      </td>
      <td>${ratingHtml(p)}</td>
      <td>${statusHtml(p)}</td>
      <td>${tagsHtml(p)}</td>
      <td>${noteHtml(p)}</td>
      <td class="num">${formatSize(p.sizeBytes)}</td>
    `;
    rowsEl.appendChild(tr);
  }

  const totalSize = projects.reduce((sum, p) => sum + p.sizeBytes, 0);
  summaryEl.textContent = `${filtered.length} of ${projects.length} projects · ${formatSize(totalSize)} total`;
}

function ratingHtml(p) {
  const dots = Array.from({ length: 10 }, (_, i) => {
    const val = i + 1;
    const filled = p.rating && val <= p.rating;
    return `<button type="button" class="dot${filled ? ' filled' : ''}" data-val="${val}" title="Rate ${val}/10"></button>`;
  }).join('');
  return `
    <div class="rating">
      <span class="rating-dots">${dots}</span>
      <span class="rating-value">${p.rating ? p.rating + '/10' : '—'}</span>
    </div>
  `;
}

function statusHtml(p) {
  const status = p.status || '';
  const options = Object.entries(STATUS_LABELS)
    .map(([val, label]) => `<option value="${val}" ${val === status ? 'selected' : ''}>${label}</option>`)
    .join('');
  return `<select class="status-select" data-status="${status}">${options}</select>`;
}

function tagsHtml(p) {
  const chips = (p.tags || [])
    .map(
      (t) => `<span class="tag-chip">${escapeHtml(t)}<button type="button" data-remove-tag="${escapeHtml(t)}">×</button></span>`
    )
    .join('');
  const isEditing = openTagEditor === p.id;
  const canAdd = (p.tags || []).length < 2;
  let addControl = '';
  if (isEditing) {
    addControl = `<input type="text" class="tag-input" maxlength="24" placeholder="tag…" autofocus />`;
  } else if (canAdd) {
    addControl = `<button type="button" class="tag-add" data-add-tag="1">+ tag</button>`;
  }
  return `<div class="tags-cell">${chips}${addControl}</div>`;
}

function noteHtml(p) {
  if (openNoteEditor === p.id) {
    return `<textarea class="note-input" rows="2" placeholder="Add a note…">${escapeHtml(p.description || '')}</textarea>`;
  }
  if (p.description) {
    return `<div class="note-preview" title="${escapeHtml(p.description)}">${escapeHtml(p.description)}</div>`;
  }
  return `<button type="button" class="note-add" data-add-note="1">+ note</button>`;
}

async function openInFinder(folderPath) {
  const res = await fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  });
  if (!res.ok) {
    alert("Couldn't open that folder in Finder.");
  }
}

async function patchMeta(id, patch) {
  const res = await fetch('/api/meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, patch }),
  });
  if (!res.ok) return;
  const updated = await res.json();
  const p = projects.find((proj) => proj.id === id);
  if (p) {
    p.rating = updated.rating;
    p.status = updated.status;
    p.tags = updated.tags;
    p.description = updated.description;
  }
  render();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateSortHeaders() {
  document.querySelectorAll('th[data-key]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.key === sortKey);
    th.classList.toggle('asc', th.dataset.key === sortKey && sortDir === 'asc');
    th.classList.toggle('desc', th.dataset.key === sortKey && sortDir === 'desc');
  });
}

tableEl.querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  const key = th.dataset.key;
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = key === 'name' || key === 'location' ? 'asc' : 'desc';
  }
  updateSortHeaders();
  render();
});

searchEl.addEventListener('input', (e) => {
  filterText = e.target.value;
  render();
});

rowsEl.addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const id = tr.dataset.id;
  const p = projects.find((proj) => proj.id === id);
  if (!p) return;

  const openBtn = e.target.closest('[data-open-folder]');
  if (openBtn) {
    openInFinder(p.path);
    return;
  }

  const dot = e.target.closest('.rating-dots .dot');
  if (dot) {
    const val = Number(dot.dataset.val);
    const newRating = p.rating === val ? null : val;
    patchMeta(id, { rating: newRating });
    return;
  }

  const removeBtn = e.target.closest('[data-remove-tag]');
  if (removeBtn) {
    const tag = removeBtn.dataset.removeTag;
    patchMeta(id, { tags: (p.tags || []).filter((t) => t !== tag) });
    return;
  }

  const addBtn = e.target.closest('[data-add-tag]');
  if (addBtn) {
    openTagEditor = id;
    render();
    const input = rowsEl.querySelector(`tr[data-id="${cssEscape(id)}"] .tag-input`);
    if (input) input.focus();
    return;
  }

  const noteTrigger = e.target.closest('.note-preview, [data-add-note]');
  if (noteTrigger) {
    openNoteEditor = id;
    render();
    const textarea = rowsEl.querySelector(`tr[data-id="${cssEscape(id)}"] .note-input`);
    if (textarea) {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    }
    return;
  }
});

rowsEl.addEventListener('change', (e) => {
  const select = e.target.closest('.status-select');
  if (!select) return;
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  patchMeta(id, { status: select.value || null });
});

rowsEl.addEventListener('keydown', (e) => {
  if (e.target.classList.contains('tag-input')) {
    if (e.key === 'Escape') {
      openTagEditor = null;
      render();
      return;
    }
    if (e.key !== 'Enter') return;
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    const p = projects.find((proj) => proj.id === id);
    const value = e.target.value.trim();
    openTagEditor = null;
    if (value && p && (p.tags || []).length < 2 && !(p.tags || []).includes(value)) {
      patchMeta(id, { tags: [...(p.tags || []), value] });
    } else {
      render();
    }
    return;
  }

  if (e.target.classList.contains('note-input')) {
    if (e.key === 'Escape') {
      openNoteEditor = null;
      render();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      const tr = e.target.closest('tr');
      const id = tr.dataset.id;
      const value = e.target.value.trim();
      openNoteEditor = null;
      patchMeta(id, { description: value });
    }
  }
});

rowsEl.addEventListener(
  'blur',
  (e) => {
    if (e.target.classList.contains('tag-input')) {
      if (openTagEditor) {
        openTagEditor = null;
        render();
      }
      return;
    }
    if (e.target.classList.contains('note-input')) {
      if (openNoteEditor) {
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        const value = e.target.value.trim();
        openNoteEditor = null;
        patchMeta(id, { description: value });
      }
    }
  },
  true
);

function cssEscape(str) {
  return str.replace(/["\\]/g, '\\$&');
}

function updateFolderPath(baseDir) {
  const maxChars = 56;
  const display = baseDir.length > maxChars ? `…${baseDir.slice(-(maxChars - 1))}` : baseDir;
  folderPathEl.textContent = display;
  folderPathEl.title = baseDir;
}

async function load(force) {
  summaryEl.textContent = 'Scanning…';
  const res = await fetch(`/api/projects${force ? '?refresh=1' : ''}`);
  const data = await res.json();
  projects = data.projects;
  updateFolderPath(data.baseDir);
  updateSortHeaders();
  render();
}

refreshEl.addEventListener('click', () => load(true));

changeFolderEl.addEventListener('click', async () => {
  changeFolderEl.disabled = true;
  changeFolderEl.textContent = 'Choose a folder…';
  try {
    const res = await fetch('/api/choose-folder', { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      alert("Couldn't open the folder picker.");
    } else if (!data.canceled) {
      await load(true);
    }
  } catch {
    alert("Couldn't open the folder picker.");
  } finally {
    changeFolderEl.disabled = false;
    changeFolderEl.textContent = 'Change Folder…';
  }
});

load(false);

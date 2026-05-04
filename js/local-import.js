// Lokale Audio-Files importieren — von der Mac-Festplatte, einer externen
// Platte oder einem USB-Stick.
//
// Workflow: User wählt einen Ordner (oder zieht Files in die App).
// Browser scannt rekursiv nach Audio-Dateien, decodiert sie mit der Web Audio
// API und bestimmt BPM für jeden Track. Files bleiben lokal — kein Upload.

import { analyze } from 'https://cdn.jsdelivr.net/npm/web-audio-beat-detector@8.2.7/+esm';

const AUDIO_EXTENSIONS = [
  '.mp3', '.m4a', '.aac', '.wav', '.aif', '.aiff',
  '.flac', '.ogg', '.opus'
];

let _audioCtx;
function audioCtx() {
  if (!_audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    _audioCtx = new Ctx();
  }
  return _audioCtx;
}

function isAudioFile(name) {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/** "Artist - Title.mp3" → { artist, title }. Fallback auf nur Title. */
function parseFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  // Erst Track-Nummer abschneiden ("01 - " oder "01. ")
  const stripped = base.replace(/^\d+\s*[-.\s]+/, '');
  const m = stripped.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (m) {
    return { artist: m[1].trim(), title: m[2].trim() };
  }
  return { artist: 'Unbekannt', title: stripped.trim() };
}

async function analyzeFile(file) {
  const buffer = await file.arrayBuffer();
  const audio = await audioCtx().decodeAudioData(buffer);
  const bpm = await analyze(audio);
  return { bpm, durationSeconds: audio.duration };
}

/**
 * Verarbeitet eine Liste von File-Objekten (vom <input> oder Drag&Drop) und
 * gibt analysierte Track-Objekte zurück.
 *
 * @param {File[]} files
 * @param {(done:number,total:number,name:string)=>void} progress
 * @returns {Promise<Track[]>}
 */
export async function importFromFiles(files, progress) {
  const audioFiles = files.filter(f => isAudioFile(f.name));
  const result = [];
  let done = 0;

  for (const file of audioFiles) {
    if (progress) progress(done, audioFiles.length, file.name);
    try {
      const meta = parseFilename(file.name);
      const analysis = await analyzeFile(file);
      const path = file.webkitRelativePath || file.name;
      result.push({
        id: 'local:' + path,
        title: meta.title,
        artist: meta.artist,
        album: null,
        durationSeconds: analysis.durationSeconds,
        genre: null,
        artworkUrl: null,
        previewUrl: null,
        bpm: Math.round(analysis.bpm * 10) / 10,
        key: null,
        energy: null,
        source: 'local',
        enrichedAt: Date.now(),
        _localPath: path
      });
    } catch (e) {
      console.warn('Lokale Datei fehlgeschlagen:', file.name, e);
    }
    done++;
  }
  if (progress) progress(done, audioFiles.length, '');
  return result;
}

/**
 * Öffnet System-Dialog für Ordner-Auswahl. Browser scannt rekursiv.
 * Funktioniert auf macOS Chrome, Edge, Firefox, Safari (recent).
 */
export function pickFolder() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // webkitdirectory: macOS Chrome/Edge erlaubt Ordner-Picker
    input.webkitdirectory = true;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** File-Picker für einzelne Files (alternative wenn Folder-Picker zickt). */
export function pickFiles() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = AUDIO_EXTENSIONS.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Aktiviert globalen Drag&Drop. Files können irgendwo aufs Fenster gezogen
 * werden, App scannt rekursiv (auch ganze Ordner).
 */
export function installDropZone(element, onDrop) {
  let depth = 0;
  element.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    element.classList.add('drag-over');
  });
  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  element.addEventListener('dragleave', () => {
    depth--;
    if (depth <= 0) {
      depth = 0;
      element.classList.remove('drag-over');
    }
  });
  element.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    element.classList.remove('drag-over');
    const items = Array.from(e.dataTransfer.items || []);
    const files = await collectFilesFromItems(items);
    if (files.length > 0) onDrop(files);
  });
}

async function collectFilesFromItems(items) {
  const files = [];
  const promises = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      promises.push(collectFromEntry(entry, files, ''));
    } else {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  await Promise.all(promises);
  return files;
}

async function collectFromEntry(entry, files, prefix) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        try {
          Object.defineProperty(file, 'webkitRelativePath', {
            value: prefix + file.name,
            configurable: true
          });
        } catch { /* ignore */ }
        files.push(file);
        resolve();
      }, () => resolve());
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries gibt nur batches zurück, deshalb Schleife
    const allEntries = [];
    while (true) {
      const batch = await new Promise((resolve) =>
        reader.readEntries((es) => resolve(es), () => resolve([]))
      );
      if (batch.length === 0) break;
      allEntries.push(...batch);
    }
    await Promise.all(
      allEntries.map(sub => collectFromEntry(sub, files, prefix + entry.name + '/'))
    );
  }
}

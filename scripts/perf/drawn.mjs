// What the stage actually draws. Counts of nodes are not a picture.
import { readFileSync } from 'node:fs';

const MARK = /[\u064B-\u0652\u0656-\u065F\u0670\u06D6-\u06ED\u08D4-\u08E1\u08E3-\u08FF]/g;

export function norm(value) {
  return String(value || '')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function bare(value) {
  return norm(value).replace(MARK, '');
}

function plain(value) {
  return norm(String(value || '').replace(/\*\*/g, '').replace(/\*/g, ''));
}

function passageTitle(keys) {
  if (!keys.length || keys.some((key) => key !== 'voice' && key !== 'choir')) return null;
  const voice = keys.includes('voice');
  const choir = keys.includes('choir');
  if (voice && choir) return 'Голос и хор';
  if (choir) return 'Хор';
  return 'Голос';
}

/** Strings the stage is allowed to draw for one song. Built from the files, not from the DOM. */
export function corpusFor(slug) {
  const song = JSON.parse(readFileSync(`content/songs/${slug}/song.json`, 'utf8'));
  const lyrics = JSON.parse(readFileSync(`content/songs/${slug}/lyrics.json`, 'utf8'));
  const names = new Map();
  const natives = new Map();
  const list = readFileSync('src/instruments/list.ts', 'utf8');
  for (const hit of list.matchAll(/key: '([^']+)', name: '([^']+)'(?:, native: '([^']+)')?/g)) {
    names.set(hit[1], hit[2]);
    if (hit[3]) natives.set(hit[1], hit[3]);
  }
  const words = new Set();
  const lines = [];
  const translations = new Set();
  const notes = new Set();
  const chips = new Set(['Инструменты', 'Голос', 'Хор', 'Голос и хор']);
  const voices = new Set();
  const extras = new Set(['повтор', song.title, song.artist, song.version?.label || '', ...names.values(), ...natives.values()]);
  if (song.titleOriginal) extras.add(song.titleOriginal);
  if (song.performance?.event) extras.add(`${song.artist} · ${song.performance.event}`);
  if (Array.isArray(song.poets)) extras.add(song.poets.map((poet) => poet.name).join(' · '));
  for (const section of lyrics.sections || []) {
    if (section.note) notes.add(norm(section.note));
    if (section.mode) extras.add(norm(section.mode));
    if (section.label) extras.add(norm(section.label));
    if (section.voice) voices.add(norm(section.voice));
    for (const performer of section.performers || []) {
      extras.add(norm(performer));
      const named = String(performer).match(/^(.*?)\s*\([^)]+\)\s*$/);
      if (named) extras.add(norm(named[1]));
    }
    if (section.kind === 'instrumental') {
      const keys = section.instruments || [];
      const title = passageTitle(keys) ?? (keys.length === 0 ? section.label || 'Инструменты' : null);
      const kicker = title || 'Инструменты';
      const suffix = title ? '' : keys.length ? ` ${keys.map((key) => names.get(key) || key).join(' · ')}` : '';
      chips.add(norm(`${kicker}${suffix}`));
      chips.add(norm(kicker));
    }
    for (const line of section.lines || []) {
      const row = [];
      for (const word of line.words || []) {
        const text = norm(word.w);
        if (!text) continue;
        words.add(bare(text));
        row.push(bare(text));
      }
      if (row.length) lines.push(row.join('\u0001'));
      if (line.tr?.ru) translations.add(plain(line.tr.ru));
      if (line.translit) extras.add(plain(line.translit));
      if (line.alt?.text) extras.add(norm(line.alt.text));
      if (line.voice) voices.add(norm(line.voice));
    }
  }
  return {
    words: [...words],
    lines,
    translations: [...translations],
    notes: [...notes],
    chips: [...chips],
    voices: [...voices],
    extras: [...extras].filter(Boolean),
  };
}

/**
 * One frame of the stage. Runs in the page. `corpus` is the song's own strings.
 * Overlap is checked inside each `.stage-view`: the departing picture is a second view.
 */
export function sampleInPage(corpus) {
  const normText = (value) =>
    String(value || '')
      .replace(/\u200b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const bareText = (value) => normText(value).replace(/[\u064B-\u0652\u0656-\u065F\u0670\u06D6-\u06ED\u08D4-\u08E1\u08E3-\u08FF]/g, '');
  const stage = document.querySelector('.scene-stage');
  if (!stage) return { ok: false, why: 'no stage', texts: 0, bad: [], overlap: [] };
  const stageBox = stage.getBoundingClientRect();
  const words = new Set(corpus.words);
  const lines = corpus.lines.map((line) => line.split('\u0001'));
  const isSlice = (row) => {
    if (!row.length) return true;
    for (const line of lines) {
      if (row.length > line.length) continue;
      for (let i = 0; i + row.length <= line.length; i++) {
        let same = true;
        for (let k = 0; k < row.length; k++) {
          if (line[i + k] !== row[k]) {
            same = false;
            break;
          }
        }
        if (same) return true;
      }
    }
    return false;
  };
  const translations = new Set(corpus.translations);
  const notes = new Set(corpus.notes);
  const chips = new Set(corpus.chips);
  const voices = new Set(corpus.voices);
  const extras = new Set(corpus.extras);
  const shown = (el, view) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden || el.closest('[hidden]')) return false;
    let node = el;
    while (node && node !== view) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (!(Number(style.opacity) > 0.05)) return false;
      node = node.parentElement;
    }
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    if (box.bottom <= 0 || box.top >= window.innerHeight || box.right <= 0 || box.left >= window.innerWidth) return false;
    const ix = Math.min(box.right, stageBox.right) - Math.max(box.left, stageBox.left);
    const iy = Math.min(box.bottom, stageBox.bottom) - Math.max(box.top, stageBox.top);
    return ix > 2 && iy > 2;
  };
  const stray = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = normText(node.nodeValue);
      if (value) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 1 && rect.height > 1) return value.slice(0, 90);
        }
      }
      node = walker.nextNode();
    }
    return '';
  };
  const bad = [];
  const overlap = [];
  let texts = 0;
  let leafId = 0;
  const views = [...stage.querySelectorAll('.stage-view')];
  views.forEach((view, viewIndex) => {
    const leaves = [];
    // One inline that wraps has several client rects. The union box of that
    // wrap used to cover the next fragment and look like two strings colliding.
    const push = (el, text) => {
      const value = normText(text);
      if (!value || !shown(el, view)) return;
      const id = ++leafId;
      const rects = [...el.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
      if (!rects.length) return;
      texts += 1;
      for (const rect of rects) {
        leaves.push({
          id,
          text: value.slice(0, 90),
          box: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        });
      }
    };
    for (const orig of view.querySelectorAll('.fb-orig')) {
      if (!shown(orig, view)) continue;
      const parts = [...orig.querySelectorAll('.w')];
      const row = [];
      for (const el of parts) {
        const text = bareText(el.textContent);
        if (!text || !shown(el, view)) continue;
        row.push(text);
        push(el, el.textContent);
        if (!words.has(text)) bad.push(`word «${text.slice(0, 40)}»`);
      }
      // A line taller than the stage shows a contiguous slice. A hole, or two
      // lines written into one host, is not a slice of any original.
      if (row.length && !isSlice(row)) bad.push(`line «${row.join(' ').slice(0, 70)}»`);
    }
    for (const tr of view.querySelectorAll('.fb-tr')) {
      if (!shown(tr, view)) continue;
      if (tr.hasAttribute('data-scrub')) {
        const drawn = normText(tr.getAttribute('data-scrub'));
        const leaked = stray(tr);
        push(tr, drawn);
        if (leaked) bad.push(`leftover «${leaked}»`);
        if (drawn && !translations.has(drawn)) bad.push(`translation «${drawn.slice(0, 70)}»`);
        continue;
      }
      const parts = [...tr.querySelectorAll('.tr-tx, .tr-em, em')].filter((el) => shown(el, view));
      const joined = normText(parts.map((el) => el.textContent || '').join(''));
      for (const el of parts) push(el, el.textContent);
      if (!parts.length) {
        const text = normText(tr.innerText);
        push(tr, text);
        if (text && !translations.has(text)) bad.push(`translation «${text.slice(0, 70)}»`);
      } else if (joined && !translations.has(joined)) bad.push(`translation «${joined.slice(0, 70)}»`);
    }
    for (const el of view.querySelectorAll('.fb-translit, .fb-alt, .intro-title, .intro-original, .intro-meta, .intro-poets')) {
      if (!shown(el, view)) continue;
      const text = normText(el.innerText);
      push(el, text);
      if (text && !extras.has(text) && !translations.has(text) && !notes.has(text)) bad.push(`caption «${text.slice(0, 70)}»`);
    }
    for (const el of view.querySelectorAll('.fb-voice, .fb-repeat')) {
      if (!shown(el, view)) continue;
      const text = normText(el.textContent);
      push(el, text);
      if (text && !voices.has(text) && !extras.has(text)) bad.push(`voice «${text.slice(0, 40)}»`);
    }
    for (const el of view.querySelectorAll('.fb-inst-compact')) {
      if (!shown(el, view)) continue;
      const text = normText(el.innerText);
      push(el, text);
      if (text && !chips.has(text)) bad.push(`chip «${text.slice(0, 70)}»`);
    }
    for (const el of view.querySelectorAll('.fb-inst-note, .fb-inst-mode')) {
      if (!shown(el, view)) continue;
      const text = normText(el.innerText);
      push(el, text);
      if (text && !notes.has(text) && !extras.has(text)) bad.push(`note «${text.slice(0, 70)}»`);
    }
    for (const el of view.querySelectorAll('.fb-inst-count, .fb-wait')) {
      if (!shown(el, view)) continue;
      const text = normText(el.textContent);
      if (!text) continue;
      push(el, text);
      if (!/^(Голос через |До конца |через )/.test(text)) bad.push(`clock «${text.slice(0, 40)}»`);
    }
    for (const el of view.querySelectorAll('.ist-name, .ist-native, .ist-perf')) {
      if (!shown(el, view)) continue;
      const text = normText(el.textContent);
      push(el, text);
      if (text && !extras.has(text) && !chips.has(text) && !voices.has(text)) bad.push(`plate «${text.slice(0, 40)}»`);
    }
    for (const el of view.querySelectorAll('.ist-chip')) {
      if (!shown(el, view)) continue;
      const text = normText(el.textContent);
      push(el, text);
      if (text && !/^ещё \d+$/.test(text)) bad.push(`chip «${text.slice(0, 40)}»`);
    }
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        if (leaves[i].id === leaves[j].id) continue;
        const a = leaves[i].box;
        const b = leaves[j].box;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 2 && y > 2) {
          overlap.push(`v${viewIndex} «${leaves[i].text}» × «${leaves[j].text}»`);
        }
      }
    }
  });
  const textBoxes = [];
  const artBoxes = [];
  const chainShown = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node instanceof HTMLElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (!(Number(style.opacity) > 0.05)) return false;
      }
      const root = node.getRootNode();
      const next = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
      if (!next || next === node) break;
      node = next;
    }
    const box = el.getBoundingClientRect();
    const ix = Math.min(box.right, stageBox.right) - Math.max(box.left, stageBox.left);
    const iy = Math.min(box.bottom, stageBox.bottom) - Math.max(box.top, stageBox.top);
    return box.width > 1 && box.height > 1 && ix > 1 && iy > 1;
  };
  for (const el of stage.querySelectorAll('.fb-orig .w, .fb-tr, .intro-title')) {
    if (!chainShown(el)) continue;
    const box = el.getBoundingClientRect();
    textBoxes.push(box);
  }
  const walkArt = (root) => {
    for (const el of root.querySelectorAll('.ist-art, .ist-art-mount')) {
      if (el.classList.contains('ist-art') && chainShown(el)) artBoxes.push(el.getBoundingClientRect());
      if (el.shadowRoot) walkArt(el.shadowRoot);
    }
  };
  walkArt(stage);
  for (const art of artBoxes) {
    for (const text of textBoxes) {
      const x = Math.min(art.right, text.right) - Math.max(art.left, text.left);
      const y = Math.min(art.bottom, text.bottom) - Math.max(art.top, text.top);
      if (x > 1 && y > 1) {
        overlap.push('engraving × text');
        break;
      }
    }
  }
  // A passage whose engraving is still loading shows its caption. That frame is
  // not empty; it only does not count for the engraving × text overlap.
  let captions = 0;
  if (textBoxes.length === 0 && artBoxes.length === 0) {
    for (const el of stage.querySelectorAll('.fb-inst-note')) if (chainShown(el)) captions += 1;
  }
  if (textBoxes.length === 0 && artBoxes.length === 0 && captions === 0) bad.push('empty');
  return {
    ok: bad.length === 0 && overlap.length === 0,
    texts,
    bad: bad.slice(0, 4),
    overlap: overlap.slice(0, 4),
  };
}

export function noteCardInPage() {
  const card = document.querySelector('.note-card');
  const player = document.querySelector('.player');
  const line = document.querySelector('.fb--line.is-current');
  if (!(card instanceof HTMLElement) || !(player instanceof HTMLElement)) return { ok: false, why: 'missing' };
  const cardBox = card.getBoundingClientRect();
  const playerBox = player.getBoundingClientRect();
  const lineBox = line instanceof HTMLElement ? line.getBoundingClientRect() : null;
  const text = card.querySelector('.note-line-text');
  const above = cardBox.bottom <= playerBox.top + 0.5;
  const clear = !lineBox || cardBox.top >= lineBox.bottom - 2;
  const oneLine = text instanceof HTMLElement && getComputedStyle(text).whiteSpace === 'nowrap';
  return {
    ok: cardBox.height > 32 && cardBox.height <= 52 && above && clear && oneLine && cardBox.width > 40,
    why: `card ${Math.round(cardBox.bottom)} player ${Math.round(playerBox.top)} h ${Math.round(cardBox.height)} clear ${clear} line ${oneLine}`,
  };
}

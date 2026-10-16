/**
 * What a recording is, from its bytes: container, codec, bitrate, sample rate, length, and a plain
 * verdict for the person who sent it. Used by the Telegram inbox (api/telegram.ts). Files starting
 * with an underscore are not deployed as endpoints.
 */
export type Quality = { format: string; codec?: string; kbps?: number; sampleRate?: number; channels?: number; seconds?: number; lossless: boolean; verdict: string };

export function mp4Info(b: Buffer) {
  const out: { codec?: string; sampleRate?: number; channels?: number; seconds?: number; avgKbps?: number } = {};
  const walk = (start: number, end: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = b.readUInt32BE(p);
      const type = b.toString('latin1', p + 4, p + 8);
      let hdr = 8;
      if (size === 1) {
        size = Number(b.readBigUInt64BE(p + 8));
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) return;
      const body = p + hdr;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(body, p + size);
      else if (type === 'mvhd') {
        const v1 = b[body] === 1;
        const scale = b.readUInt32BE(body + (v1 ? 20 : 12));
        const dur = v1 ? Number(b.readBigUInt64BE(body + 24)) : b.readUInt32BE(body + 16);
        if (scale) out.seconds = dur / scale;
      } else if (type === 'stsd' && !out.codec) {
        const e = body + 8; // version/flags + entry count
        const fmt = b.toString('latin1', e + 4, e + 8);
        out.channels = b.readUInt16BE(e + 24);
        out.sampleRate = b.readUInt32BE(e + 32) >>> 16;
        out.codec = { mp4a: 'AAC', alac: 'ALAC', fLaC: 'FLAC', Opus: 'Opus', 'ac-3': 'AC-3', 'ec-3': 'E-AC-3' }[fmt] ?? fmt;
        const esds = b.indexOf('esds', e, 'latin1');
        if (fmt === 'mp4a' && esds > 0 && esds < e + b.readUInt32BE(e)) {
          // ES_Descriptor (0x03) → DecoderConfigDescriptor (0x04): object type, stream type,
          // buffer size (3 bytes), max bitrate, average bitrate
          const skipLen = (q: number) => {
            let i = 0;
            while (b[q + i] & 0x80 && i < 3) i++;
            return q + i + 1;
          };
          let q = esds + 8;
          if (b[q] === 0x03) {
            let r = skipLen(q + 1);
            const flags = b[r + 2];
            r += 3;
            if (flags & 0x80) r += 2;
            if (flags & 0x40) r += 1 + b[r];
            if (flags & 0x20) r += 2;
            q = r;
          }
          if (b[q] === 0x04) {
            const avg = b.readUInt32BE(skipLen(q + 1) + 9);
            if (avg) out.avgKbps = Math.round(avg / 1000);
          }
        }
      }
      p += size;
    }
  };
  try {
    walk(0, b.length);
  } catch {
    /* a damaged box only costs us the details */
  }
  return out;
}

export function inspect(b: Buffer, name: string, mime: string, seconds?: number): Quality {
  const head = b.toString('latin1', 0, 12);
  let q: Quality = { format: 'неизвестный', lossless: false, verdict: '' };
  if (head.slice(4, 8) === 'ftyp') {
    const m = mp4Info(b);
    q = { format: 'MP4/M4A', codec: m.codec, sampleRate: m.sampleRate, channels: m.channels, seconds: m.seconds ?? seconds, kbps: m.avgKbps, lossless: m.codec === 'ALAC' || m.codec === 'FLAC', verdict: '' };
  } else if (head.startsWith('fLaC')) q = { format: 'FLAC', codec: 'FLAC', lossless: true, seconds, verdict: '' };
  else if (head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE') q = { format: 'WAV', codec: 'PCM', lossless: true, seconds, verdict: '' };
  else if (head.startsWith('OggS')) q = { format: 'Ogg', codec: b.indexOf('OpusHead', 0, 'latin1') > 0 && b.indexOf('OpusHead', 0, 'latin1') < 200 ? 'Opus' : 'Vorbis', lossless: false, seconds, verdict: '' };
  else if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) q = { format: 'WebM', codec: b.indexOf('A_OPUS', 0, 'latin1') > 0 ? 'Opus' : undefined, lossless: false, seconds, verdict: '' };
  else if (head.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) q = { format: 'MP3', codec: 'MP3', lossless: false, seconds, verdict: '' };
  else q = { format: mime || name.split('.').pop() || 'неизвестный', lossless: false, seconds, verdict: '' };
  if (!q.kbps && q.seconds) q.kbps = Math.round((b.length * 8) / q.seconds / 1000);

  const k = q.kbps ?? 0;
  if (q.lossless) q.verdict = 'Без потерь — лучше не бывает.';
  else if (q.codec === 'MP3' && k >= 256) q.verdict = 'MP3 с высоким битрейтом. Если его сделали из YouTube, качества от этого не прибавилось — спектр проверит обработка.';
  else if (k >= 120) q.verdict = 'Уровень YouTube и стримингов (128–160 кбит/с) — для сайта хорошо. Лучше бывает только запись без потерь (покупка FLAC/ALAC).';
  else if (k > 0) q.verdict = 'Битрейт низкий — по возможности найдите запись лучше.';
  else q.verdict = 'Формат не распознан — обработка проверит файл.';
  if (q.sampleRate && q.sampleRate < 44100) q.verdict += ` Частота ${q.sampleRate} Гц — ниже обычной.`;
  return q;
}

const mmss = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');

export function describe(q: Quality, bytes: number) {
  const parts = [q.codec && q.codec !== q.format ? `${q.format}, ${q.codec}` : q.format];
  if (q.kbps) parts.push(`≈${q.kbps} кбит/с`);
  if (q.sampleRate) parts.push(`${(q.sampleRate / 1000).toFixed(1)} кГц`);
  if (q.channels) parts.push(q.channels === 1 ? 'моно' : 'стерео');
  parts.push(mmss(q.seconds), `${(bytes / 1048576).toFixed(1)} МБ`);
  return `${parts.join(' · ')}\n${q.verdict}`;
}

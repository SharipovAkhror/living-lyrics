/**
 * Phone and desktop frames after the T27 caps.
 * Desktop must still report live backdrop-filter. Phone playback must report none.
 *
 *   node scripts/perf/shots.mjs --url http://127.0.0.1:4179
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { flag, installAudioRoute, phoneContext, prepareAudio, probe } from './lib.mjs';

const args = process.argv.slice(2);
const url = flag(args, '--url', 'http://127.0.0.1:4179');
const outDir = flag(args, '--out', 'work/perf/t27/shots');
const slug = flag(args, '--slug', 'karitas');
const songSeconds = Number(flag(args, '--song-seconds', '977'));
const song = `${url.replace(/\/$/, '')}/song/${slug}`;

mkdirSync(outDir, { recursive: true });
const audio = prepareAudio(songSeconds, outDir);

async function shoot(name, contextOptions, openSettings) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  await installAudioRoute(context, audio.body, audio.type);
  const page = await context.newPage();
  await page.goto(song, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.scrub-track', { timeout: 30000 });
  const play = page.getByRole('button', { name: 'Воспроизвести' });
  if (await play.count()) await play.click();
  await page.waitForTimeout(700);
  const playing = await probe(page);
  await page.screenshot({ path: `${outDir}/${name}-song.png` });
  if (openSettings) {
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(450);
    const sheet = await probe(page);
    await page.screenshot({ path: `${outDir}/${name}-settings.png` });
    await browser.close();
    return { playing, sheet };
  }
  await browser.close();
  return { playing };
}

const phone = phoneContext();
const desktop = { viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'ru-RU' };
const phoneLight = { ...phone, colorScheme: 'light' };

const report = {
  phoneDark: await shoot('phone-dark', phone, true),
  phoneLight: await shoot('phone-light', phoneLight, false),
  desktopDark: await shoot('desktop-dark', desktop, true),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
const phoneBlur = report.phoneDark.playing.blur;
const desktopBlur = report.desktopDark.playing.blur;
if (phoneBlur !== 0) {
  process.stderr.write(`phone still has ${phoneBlur} backdrop layers\n`);
  process.exitCode = 2;
}
if (!desktopBlur) {
  process.stderr.write(`desktop lost its backdrop layers (${desktopBlur})\n`);
  process.exitCode = 2;
}

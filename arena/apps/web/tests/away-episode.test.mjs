import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/away-episode.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { createAwayEpisode, AWAY_THRESHOLD_MS } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

test('ambang keluar layar adalah 5 detik', () => {
  assert.equal(AWAY_THRESHOLD_MS, 5000);
});

test('refresh singkat (kurang dari 5 detik) tidak dicatat', () => {
  const episode = createAwayEpisode();
  episode.start(1000);
  assert.equal(episode.settle(1000 + 750), false);
  assert.equal(episode.settle(4999), false);
  episode.cancel();
  assert.equal(episode.settle(6000), false);
});

test('layar mati lebih dari 5 detik dicatat tepat satu kali per episode', () => {
  const episode = createAwayEpisode();
  episode.start(10_000);
  assert.equal(episode.settle(14_999), false);
  assert.equal(episode.settle(15_000), true, 'tepat 5 detik sudah dihitung');
  assert.equal(episode.settle(45_000), false, 'episode yang sama tidak boleh dobel');
  episode.cancel();
  episode.start(60_000);
  assert.equal(episode.settle(66_000), true, 'episode baru dicatat lagi');
});

test('timer yang dibekukan sistem tetap dihitung saat halaman kembali', () => {
  const episode = createAwayEpisode();
  episode.start(0);
  // Timer tidak sempat berjalan (layar mati), lalu halaman kembali 30 detik kemudian.
  assert.equal(episode.settle(30_000), true);
});

test('dua refresh berturut-turut masing-masing dibatalkan tanpa pelanggaran', () => {
  const episode = createAwayEpisode();
  episode.start(0);
  episode.cancel();
  episode.start(2000);
  episode.cancel();
  assert.equal(episode.recorded, false);
  assert.equal(episode.active, false);
  assert.equal(episode.settle(3000), false);
});

// Generated covers must be stable, so the same title always gets the same picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverSvg } from '../../web/js/ui/cover.js';

test('coverSvg is a deterministic SVG data URL per title', () => {
  const a = coverSvg('Attention Is All You Need');
  assert.ok(a.startsWith('data:image/svg+xml'));
  assert.equal(a, coverSvg('Attention Is All You Need'));
  assert.notEqual(a, coverSvg('CLIP'));
  assert.equal(coverSvg(''), coverSvg('paper'), 'an empty title uses the default key');
});

test('coverFor shows an uploaded image whole and lets a generated cover fill the frame', async () => {
  const { coverFor, coverSvg } = await import('../../web/js/ui/cover.js');
  assert.deepEqual(coverFor({ title: 'X', image: 'data:image/png;base64,AAAA' }), { src: 'data:image/png;base64,AAAA', fit: true });
  assert.deepEqual(coverFor({ title: 'X', image: '' }), { src: coverSvg('X'), fit: false });
});

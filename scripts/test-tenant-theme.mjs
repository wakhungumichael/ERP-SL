import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../artifacts/erp-ui/src/lib/tenant-theme.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { hexToHsl, contrastText, themeVariables } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('black, white, and gray remain neutral with their exact brightness', () => {
  assert.deepEqual(hexToHsl('#000000'), { h: 0, s: 0, l: 0 });
  assert.deepEqual(hexToHsl('#fff'), { h: 0, s: 0, l: 100 });
  assert.deepEqual(hexToHsl('#808080'), { h: 0, s: 0, l: 128 / 255 * 100 });
  assert.equal(themeVariables({ primary_color: '#000000' })['--primary'], '0 0% 0%');
});

test('text uses the more readable black or white for each background', () => {
  assert.equal(contrastText('#000'), '#ffffff');
  assert.equal(contrastText('#fff'), '#000000');
  assert.equal(contrastText('#ffff00'), '#000000');
  assert.equal(contrastText('#000080'), '#ffffff');
});

test('secondary, accent, and sidebar colors are independently applied', () => {
  const palette = themeVariables({ primary_color: '#000000', secondary_color: '#ffffff', accent_color: '#ff0000', sidebar_color: '#0000ff' });
  assert.equal(palette['--secondary'], '0 0% 100%');
  assert.equal(palette['--secondary-foreground'], '0 0% 0%');
  assert.equal(palette['--accent'], '0 100% 50%');
  assert.equal(palette['--sidebar'], '240 100% 50%');
  assert.equal(palette['--sidebar-primary'], palette['--primary']);
  assert.equal(palette['--sidebar-primary-foreground'], '0 0% 100%');
  assert.equal(palette['--ring'], palette['--primary']);
});

test('unset optional colors fall back to CSS defaults instead of previous tenant colors', () => {
  const palette = themeVariables({ secondary_color: '', accent_color: '', sidebar_color: '' });
  for (const name of ['--secondary', '--accent', '--sidebar']) assert.equal(name in palette, false);
  assert.equal(contrastText('invalid'), '#ffffff');
  assert.ok(Object.values(themeVariables({ primary_color: 'invalid' })).every((v) => !v.includes('NaN')));
});

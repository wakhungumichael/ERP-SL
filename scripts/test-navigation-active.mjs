import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../artifacts/erp-ui/src/lib/navigation-active.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { activeNavigationPath } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('only the most specific project menu matches nested task routes', () => {
  const paths = ['/projects', '/projects/tasks', '/projects/my-tasks', '/projects/board'];
  assert.equal(activeNavigationPath('/projects/tasks', paths), '/projects/tasks');
  assert.equal(activeNavigationPath('/projects/tasks/42?tab=followups', paths), '/projects/tasks');
  assert.equal(activeNavigationPath('/projects/board', paths), '/projects/board');
  assert.equal(activeNavigationPath('/projects/42', paths), '/projects');
});
test('unrelated and prefix-sharing paths do not match', () => {
  assert.equal(activeNavigationPath('/projects-other', ['/projects']), undefined);
  assert.equal(activeNavigationPath('/projects', ['/procurement']), undefined);
});

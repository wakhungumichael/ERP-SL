/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
export function activeNavigationPath(location: string, paths: string[]) {
  const current = location.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  const matches = paths.filter(path => current === path || (path !== '/' && current.startsWith(path + '/')) || (path === '/dashboard' && current === '/'));
  return matches.sort((left, right) => right.length - left.length)[0];
}

/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
export function hexToHsl(hex: string) {
  let normalized = hex.replace('#', '').trim();
  if (normalized.length === 3) {
    normalized = normalized.split('').map((ch) => ch + ch).join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return { h: 15, s: 80, l: 50 };

  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }

  h = h * 60;
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}
export function contrastText(hex: string) {
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
  if (!/^[0-9a-f]{6}$/i.test(value)) return '#ffffff';
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

export function themeVariables(settings: Record<string, string | undefined>) {
  const primary = settings.primary_color || '#E85D26';
  const variables: Record<string, string> = {};
  const hsl = (hex: string) => {
    const { h, s, l } = hexToHsl(hex);
    return `${h} ${s}% ${l}%`;
  };
  const color = (name: string, hex: string) => {
    variables[`--${name}`] = hsl(hex);
    variables[`--${name}-foreground`] = hsl(contrastText(hex));
  };
  color('primary', primary);
  color('sidebar-primary', primary);
  variables['--ring'] = variables['--sidebar-ring'] = hsl(primary);
  if (settings.secondary_color) color('secondary', settings.secondary_color);
  if (settings.accent_color) color('accent', settings.accent_color);
  if (settings.sidebar_color) {
    const sidebar = settings.sidebar_color;
    const { h, s, l } = hexToHsl(sidebar);
    color('sidebar', sidebar);
    variables['--sidebar-accent'] = `${h} ${s}% ${l > 50 ? l - 8 : l + 8}%`;
    variables['--sidebar-accent-foreground'] = hsl(contrastText(sidebar));
    variables['--sidebar-border'] = variables['--sidebar-accent'];
  }
  return variables;
}

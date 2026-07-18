/**
 * SL-ERP Industrial Rust palette — mirrors the sibling web artifact (erp-ui).
 * Primary: hsl(15 80% 50%) = #E85A1A  |  Sidebar dark: hsl(24 10% 12%) = #1E1A17
 */

const colors = {
  light: {
    // Legacy alias
    text: '#1A1612',
    tint: '#E85A1A',

    // Surfaces
    background: '#F7F5F2',
    foreground: '#1A1612',

    // Cards
    card: '#FFFFFF',
    cardForeground: '#1A1612',

    // Primary — rust orange
    primary: '#E85A1A',
    primaryForeground: '#FFFFFF',
    primaryLight: '#FEF2EC',
    primaryDark: '#C44510',

    // Secondary
    secondary: '#F0EDE9',
    secondaryForeground: '#1A1612',

    // Muted
    muted: '#F0EDE9',
    mutedForeground: '#8C8480',

    // Accent
    accent: '#FEF2EC',
    accentForeground: '#C44510',

    // Destructive
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',

    // Borders & inputs
    border: '#E8E4DF',
    input: '#E8E4DF',

    // Sidebar (dark nav panel — matches web)
    sidebar: '#1E1A17',
    sidebarForeground: '#F0EDE9',
    sidebarMuted: '#3A3430',

    // Semantic
    success: '#22C55E',
    successForeground: '#FFFFFF',
    successLight: '#DCFCE7',
    warning: '#F59E0B',
    warningForeground: '#FFFFFF',
    warningLight: '#FEF3C7',
    info: '#3B82F6',
    infoForeground: '#FFFFFF',
    infoLight: '#DBEAFE',
  },

  radius: 8,
};

export default colors;

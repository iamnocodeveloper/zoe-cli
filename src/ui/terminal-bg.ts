const BG_DARK = '\x1b[48;5;235m';
const BG_LIGHT = '\x1b[48;5;255m';

export async function detectBg(): Promise<string> {
  // Try to detect terminal background color
  // This is a simplified version - in production, use more robust detection

  const termProgram = process.env.TERM_PROGRAM;
  const colorFgBg = process.env.COLORFGBG;

  // Check COLORFGBG environment variable
  if (colorFgBg) {
    const parts = colorFgBg.split(';');
    if (parts.length >= 2) {
      const bg = parseInt(parts[1], 10);
      if (bg < 8) {
        return BG_DARK; // Dark background
      } else {
        return BG_LIGHT; // Light background
      }
    }
  }

  // Check terminal program
  if (termProgram) {
    const darkTerminals = ['iTerm.app', 'Apple_Terminal', 'vscode', 'hyper', 'alacritty', 'kitty', 'wezterm'];
    if (darkTerminals.some(t => termProgram.toLowerCase().includes(t.toLowerCase()))) {
      return BG_DARK;
    }
  }

  // Check for dark mode environment variables
  if (process.env.TERM?.includes('256color') || process.env.COLORTERM === 'truecolor') {
    return BG_DARK;
  }

  // Default to dark background (most common for developers)
  return BG_DARK;
}

export function getBackgroundColor(): string {
  // Synchronous version for cases where async is not possible
  const colorFgBg = process.env.COLORFGBG;

  if (colorFgBg) {
    const parts = colorFgBg.split(';');
    if (parts.length >= 2) {
      const bg = parseInt(parts[1], 10);
      if (bg < 8) {
        return BG_DARK;
      } else {
        return BG_LIGHT;
      }
    }
  }

  return BG_DARK;
}

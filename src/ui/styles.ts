// ANSI color codes
export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
} as const;

// Export individual color constants for convenience
export const RESET = COLORS.reset;
export const BOLD = COLORS.bold;
export const DIM = COLORS.dim;
export const GREEN = COLORS.green;
export const CYAN = COLORS.cyan;
export const GRAY = COLORS.gray;
export const YELLOW = COLORS.yellow;
export const RED = COLORS.red;
export const MAGENTA = COLORS.magenta;
export const WHITE = COLORS.brightWhite;

// Common style combinations
export const STYLES = {
  success: `${COLORS.green}${COLORS.bold}`,
  error: `${COLORS.red}${COLORS.bold}`,
  warning: `${COLORS.yellow}${COLORS.bold}`,
  info: `${COLORS.cyan}${COLORS.bold}`,
  debug: `${COLORS.gray}`,
  muted: `${COLORS.dim}`,
  highlight: `${COLORS.cyan}`,
  code: `${COLORS.brightWhite}`,
  path: `${COLORS.cyan}${COLORS.dim}`,
  command: `${COLORS.green}`,
  model: `${COLORS.cyan}`,
  user: `${COLORS.green}`,
} as const;

// Helper functions
export function success(text: string): string {
  return `${STYLES.success}${text}${COLORS.reset}`;
}

export function error(text: string): string {
  return `${STYLES.error}${text}${COLORS.reset}`;
}

export function warning(text: string): string {
  return `${STYLES.warning}${text}${COLORS.reset}`;
}

export function info(text: string): string {
  return `${STYLES.info}${text}${COLORS.reset}`;
}

export function debug(text: string): string {
  return `${STYLES.debug}${text}${COLORS.reset}`;
}

export function muted(text: string): string {
  return `${STYLES.muted}${text}${COLORS.reset}`;
}

export function highlight(text: string): string {
  return `${STYLES.highlight}${text}${COLORS.reset}`;
}

export function code(text: string): string {
  return `${STYLES.code}${text}${COLORS.reset}`;
}

export function path(text: string): string {
  return `${STYLES.path}${text}${COLORS.reset}`;
}

export function command(text: string): string {
  return `${STYLES.command}${text}${COLORS.reset}`;
}

export function model(text: string): string {
  return `${STYLES.model}${text}${COLORS.reset}`;
}

export function user(text: string): string {
  return `${STYLES.user}${text}${COLORS.reset}`;
}

// Box drawing
export function box(content: string, options?: { padding?: number; borderColor?: string }): string {
  const padding = options?.padding ?? 1;
  const borderColor = options?.borderColor ?? COLORS.dim;

  const lines = content.split('\n');
  const maxLength = Math.max(...lines.map((l) => l.length));
  const width = maxLength + padding * 2 + 2;

  const top = `${borderColor}┌${'─'.repeat(width - 2)}┐${COLORS.reset}`;
  const bottom = `${borderColor}└${'─'.repeat(width - 2)}┘${COLORS.reset}`;
  const empty = `${borderColor}│${' '.repeat(width - 2)}│${COLORS.reset}`;

  const result: string[] = [top];

  // Add padding
  for (let i = 0; i < padding; i++) {
    result.push(empty);
  }

  // Add content
  for (const line of lines) {
    const padded = ' '.repeat(padding) + line + ' '.repeat(maxLength - line.length + padding);
    result.push(`${borderColor}│${COLORS.reset}${padded}${borderColor}│${COLORS.reset}`);
  }

  // Add padding
  for (let i = 0; i < padding; i++) {
    result.push(empty);
  }

  result.push(bottom);

  return result.join('\n');
}

// Horizontal line
export function hline(width?: number, char = '─'): string {
  const w = width ?? process.stdout.columns ?? 80;
  return `${COLORS.dim}${char.repeat(w)}${COLORS.reset}`;
}

// Status indicators
export function checkmark(): string {
  return `${COLORS.green}✓${COLORS.reset}`;
}

export function cross(): string {
  return `${COLORS.red}✗${COLORS.reset}`;
}

export function bullet(): string {
  return `${COLORS.green}●${COLORS.reset}`;
}

export function arrow(): string {
  return `${COLORS.cyan}→${COLORS.reset}`;
}

export function spinner(frame: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return `${COLORS.dim}${frames[frame % frames.length]}${COLORS.reset}`;
}

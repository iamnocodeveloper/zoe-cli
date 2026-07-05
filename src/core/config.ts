import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import os from 'os';

export interface DisplayConfig {
  toolDisplay: 'emoji' | 'grouped' | 'minimal' | 'hidden';
  reasoning: boolean;
  inputStyle: 'block' | 'bordered' | 'plain';
  loader: LoaderConfig;
}

export interface LoaderConfig {
  text: string;
  style: 'gradient' | 'spinner' | 'minimal';
}

export interface SessionConfig {
  user?: string;
  email?: string;
  projectId?: string;
  token?: string;
  apiKey?: string;
  lastLogin?: string;
}

export interface ZoeConfig {
  session: SessionConfig;
  model: string;
  maxSteps: number;
  maxCost: number;
  autoScan: boolean;
  display: DisplayConfig;
  sessionDir: string;
}

const CONFIG_DIR = '.zoe';
const CONFIG_FILE = 'config.json';

const DEFAULTS: ZoeConfig = {
  session: {},
  model: 'deepseek/deepseek-v4-flash',
  maxSteps: 100,
  maxCost: 10,
  autoScan: true,
  sessionDir: '.zoe/sessions',
  display: {
    toolDisplay: 'grouped',
    reasoning: false,
    inputStyle: 'block',
    loader: { text: 'Thinking', style: 'spinner' },
  },
};

function getConfigPath(): string {
  const globalPath = resolve(os.homedir(), '.zoe', CONFIG_FILE);
  const localPath = resolve(CONFIG_DIR, CONFIG_FILE);

  // Prefer global, fallback to local for backwards compat
  if (existsSync(globalPath)) return globalPath;
  if (existsSync(localPath)) return localPath;

  // Default: global (session persists across directories)
  return globalPath;
}

export function loadConfig(overrides: Partial<ZoeConfig> = {}): ZoeConfig {
  let config = { ...DEFAULTS };

  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const file = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (file.display) {
        config.display = { ...config.display, ...file.display };
      }
      config = { ...config, ...file, display: config.display };
    } catch {
      // Ignore invalid config file
    }
  }

  // Apply runtime overrides
  if (overrides.display) {
    config.display = { ...config.display, ...overrides.display };
  }
  config = { ...config, ...overrides, display: config.display };

  return config;
}

export function saveConfig(updates: Partial<ZoeConfig>): void {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config = loadConfig();
  if (updates.display) {
    config.display = { ...config.display, ...updates.display };
  }
  if (updates.session) {
    config.session = { ...config.session, ...updates.session };
  }
  config = { ...config, ...updates, display: config.display, session: config.session };

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function getModel(): string {
  return loadConfig().model;
}

export function saveModel(model: string): void {
  saveConfig({ model });
}

export function getSession(): SessionConfig {
  return loadConfig().session || {};
}

export function saveSession(session: Partial<SessionConfig>): void {
  const currentSession = getSession();
  saveConfig({
    session: {
      ...currentSession,
      ...session,
      lastLogin: new Date().toISOString(),
    },
  });
}

export function clearSession(): void {
  saveConfig({ session: {} });
}

export function getConfigSummary(config: ZoeConfig): string {
  return [
    `Model: ${config.model}`,
    `Max Steps: ${config.maxSteps}`,
    `Max Cost: $${config.maxCost}`,
    `Auto Scan: ${config.autoScan ? 'enabled' : 'disabled'}`,
    `Input Style: ${config.display.inputStyle}`,
    `Tool Display: ${config.display.toolDisplay}`,
  ].join('\n');
}

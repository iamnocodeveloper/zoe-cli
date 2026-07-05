import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { resolve, join, relative, extname } from 'path';

export interface FileInfo {
  path: string;
  size: number;
  type: 'file' | 'directory';
  extension?: string;
}

export interface DependencyMap {
  production: Record<string, string>;
  dev: Record<string, string>;
  peer: Record<string, string>;
}

export interface LanguageStats {
  [language: string]: {
    files: number;
    lines: number;
  };
}

export interface ProjectIntelligence {
  name: string;
  description: string;
  version: string;
  structure: FileInfo[];
  dependencies: DependencyMap;
  languages: LanguageStats;
  totalFiles: number;
  totalLines: number;
  lastScanned: string;
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.zoe',
  'dist',
  'build',
  '.next',
  'coverage',
]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.html': 'HTML',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ Header',
};

export async function scanProject(): Promise<ProjectIntelligence> {
  const cwd = process.cwd();
  const structure: FileInfo[] = [];
  const languages: LanguageStats = {};
  let totalFiles = 0;
  let totalLines = 0;

  // Walk directory tree
  function walkDir(dir: string, relativePath: string = '') {
    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry)) continue;

        const fullPath = join(dir, entry);
        const relPath = relativePath ? `${relativePath}/${entry}` : entry;
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          structure.push({
            path: relPath,
            size: 0,
            type: 'directory',
          });
          walkDir(fullPath, relPath);
        } else {
          const ext = extname(entry).toLowerCase();
          structure.push({
            path: relPath,
            size: stat.size,
            type: 'file',
            extension: ext,
          });

          totalFiles++;

          // Count lines for text files
          if (isTextFile(ext)) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n').length;
              totalLines += lines;

              const lang = EXTENSION_LANGUAGE_MAP[ext] || 'Other';
              if (!languages[lang]) {
                languages[lang] = { files: 0, lines: 0 };
              }
              languages[lang].files++;
              languages[lang].lines += lines;
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  walkDir(cwd);

  // Read package.json for dependencies
  const dependencies = readPackageJson(cwd);

  // Read project name from package.json
  let name = 'Unknown Project';
  let description = '';
  let version = '1.0.0';

  const packageJsonPath = join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      name = packageJson.name || name;
      description = packageJson.description || description;
      version = packageJson.version || version;
    } catch {
      // Ignore parse errors
    }
  }

  const intelligence: ProjectIntelligence = {
    name,
    description,
    version,
    structure,
    dependencies,
    languages,
    totalFiles,
    totalLines,
    lastScanned: new Date().toISOString(),
  };

  // Save to .zoe/project-intelligence.json
  saveIntelligence(intelligence);

  return intelligence;
}

function readPackageJson(cwd: string): DependencyMap {
  const packageJsonPath = join(cwd, 'package.json');
  const dependencies: DependencyMap = {
    production: {},
    dev: {},
    peer: {},
  };

  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      dependencies.production = packageJson.dependencies || {};
      dependencies.dev = packageJson.devDependencies || {};
      dependencies.peer = packageJson.peerDependencies || {};
    } catch {
      // Ignore parse errors
    }
  }

  return dependencies;
}

function isTextFile(ext: string): boolean {
  const textExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss',
    '.html', '.py', '.rs', '.go', '.java', '.rb', '.php', '.swift',
    '.kt', '.c', '.cpp', '.h', '.txt', '.yaml', '.yml', '.toml',
    '.xml', '.svg', '.env', '.gitignore', '.eslintrc', '.prettierrc',
  ]);
  return textExtensions.has(ext);
}

function saveIntelligence(intelligence: ProjectIntelligence): void {
  const dir = resolve('.zoe');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = join(dir, 'project-intelligence.json');
  writeFileSync(filePath, JSON.stringify(intelligence, null, 2), 'utf-8');
}

export function loadIntelligence(): ProjectIntelligence | null {
  const filePath = resolve('.zoe', 'project-intelligence.json');
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function getProjectStats() {
  const files = countProjectFiles(process.cwd());
  const lines = countProjectLines(process.cwd());
  return { files, lines };
}

function countProjectFiles(dir: string): number {
  let count = 0;
  try {
    const items = readdirSync(dir);
    for (const item of items) {
      if (IGNORED_DIRS.has(item)) continue;
      const fullPath = join(dir, item);
      if (statSync(fullPath).isDirectory()) {
        count += countProjectFiles(fullPath);
      } else {
        const ext = extname(item).toLowerCase();
        if (!isTextFile(ext)) continue;
        count++;
      }
    }
  } catch {
    // Ignore errors
  }
  return count;
}

function countProjectLines(dir: string): number {
  let total = 0;
  try {
    const items = readdirSync(dir);
    for (const item of items) {
      if (IGNORED_DIRS.has(item)) continue;
      const fullPath = join(dir, item);
      if (statSync(fullPath).isDirectory()) {
        total += countProjectLines(fullPath);
      } else {
        const ext = extname(item).toLowerCase();
        if (!isTextFile(ext)) continue;
        try {
          const content = readFileSync(fullPath, 'utf-8');
          total += content.split('\n').length;
        } catch {
          // Ignore files that can't be read
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return total;
}

export function getProjectSummary(intel: ProjectIntelligence): string {
  const lines: string[] = [];

  lines.push(`📦 ${intel.name} v${intel.version}`);
  if (intel.description) {
    lines.push(`   ${intel.description}`);
  }
  lines.push('');

  lines.push('📊 Statistics:');
  lines.push(`   Files: ${intel.totalFiles}`);
  lines.push(`   Lines: ${intel.totalLines.toLocaleString()}`);
  lines.push('');

  lines.push('💻 Languages:');
  const sortedLanguages = Object.entries(intel.languages)
    .sort((a, b) => b[1].lines - a[1].lines)
    .slice(0, 5);

  for (const [lang, stats] of sortedLanguages) {
    lines.push(`   ${lang}: ${stats.files} files, ${stats.lines.toLocaleString()} lines`);
  }
  lines.push('');

  lines.push('📦 Dependencies:');
  const prodDeps = Object.keys(intel.dependencies.production).length;
  const devDeps = Object.keys(intel.dependencies.dev).length;
  lines.push(`   Production: ${prodDeps}`);
  lines.push(`   Dev: ${devDeps}`);

  return lines.join('\n');
}

export function getDependencyMap(intel: ProjectIntelligence): string {
  const lines: string[] = [];

  lines.push('📦 Production Dependencies:');
  for (const [name, version] of Object.entries(intel.dependencies.production)) {
    lines.push(`   ${name}: ${version}`);
  }
  lines.push('');

  lines.push('🔧 Dev Dependencies:');
  for (const [name, version] of Object.entries(intel.dependencies.dev)) {
    lines.push(`   ${name}: ${version}`);
  }

  return lines.join('\n');
}

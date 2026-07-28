import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspectGitRepository, type GitRepositoryContext } from './git-awareness.js';

export type WorkspaceLanguage = 'TypeScript' | 'JavaScript' | 'Python' | 'Go' | 'Rust' | 'PHP' | 'Java' | 'C#' | 'Dart';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | null;

export interface WorkspaceFile {
  relativePath: string; extension: string; language: WorkspaceLanguage | null;
  size: number; hash: string; lastModified: number; ignored: boolean; important: boolean;
}
export interface WorkspaceStatistics { files: number; sourceFiles: number; configFiles: number; totalBytes: number; }
export interface WorkspaceSummary {
  projectType: string; languages: readonly WorkspaceLanguage[]; frameworks: readonly string[];
  entryPoints: readonly string[]; dependencyManagers: readonly string[]; estimatedSize: number;
  numberOfFiles: number; numberOfSourceFiles: number; numberOfConfigFiles: number;
}
export interface WorkspaceContext {
  workspaceRoot: string; projectName: string; framework: string | null; language: WorkspaceLanguage | null;
  packageName: string | null; packageVersion: string | null; availableScripts: Readonly<Record<string, string>>;
  packageBin: Readonly<Record<string, string>>; runtime: string | null;
  packageManager: PackageManager; detectedFrameworks: readonly string[]; detectedLanguages: readonly WorkspaceLanguage[];
  gitRepository: boolean; mainDirectories: readonly string[]; ignoredDirectories: readonly string[];
  ignoredFiles: readonly string[]; dependencyFiles: readonly string[]; configFiles: readonly string[];
  importantFiles: readonly string[]; entryPoints: readonly string[]; projectStatistics: Readonly<WorkspaceStatistics>;
  directoryStructure: readonly string[]; files: readonly WorkspaceFile[]; summary: Readonly<WorkspaceSummary>;
  gitContext: GitRepositoryContext; contextVersion: number; generatedAt: number;
}

const DEFAULT_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', 'target', 'vendor', '.zoe']);
const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'requirements.txt', 'cargo.toml', 'go.mod', 'pubspec.yaml', 'dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.env.example', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs', 'next.config.ts', 'angular.json', 'artisan', 'manage.py', 'supabase/config.toml', 'insforge.json', 'insforge.config.json']);
const DEPENDENCY_NAMES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'requirements.txt', 'poetry.lock', 'pipfile', 'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum', 'composer.json', 'composer.lock', 'pubspec.yaml', 'pubspec.lock', 'pom.xml', 'build.gradle', 'build.gradle.kts', '*.csproj']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|mp3|mp4|mov|avi|pdf|zip|gz|7z|woff2?|ttf|eot|exe|dll|so|dylib)$/i;
const TEMPORARY = /(^|\/)(\.DS_Store|Thumbs\.db|.*~|.*\.tmp|.*\.swp)$/i;
const GENERATED = /(^|\/)(generated|__generated__)\/|\.(min\.js|map|generated\.[^/]+)$/i;
const LANGUAGE_BY_EXTENSION: Record<string, WorkspaceLanguage> = { '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.php': 'PHP', '.java': 'Java', '.cs': 'C#', '.dart': 'Dart' };

function slash(value: string): string { return value.replace(/\\/g, '/'); }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; }
function readJson(file: string): Record<string, any> { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
function isImportant(relativePath: string): boolean { const lower = relativePath.toLowerCase(); return CONFIG_NAMES.has(lower) || /^readme(?:\.|$)/i.test(path.basename(relativePath)) || /(^|\/)(?:main|index|app)\.(?:tsx?|jsx?|py|go|rs|php|java|cs|dart)$/i.test(relativePath); }
function isDependencyFile(relativePath: string): boolean { const lower = relativePath.toLowerCase(); return DEPENDENCY_NAMES.has(lower) || /\.csproj$/i.test(lower); }

function gitIgnoreRules(root: string): string[] {
  try { return fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !line.startsWith('!')); } catch { return []; }
}
function matchesGitIgnore(relativePath: string, rules: readonly string[]): boolean {
  const normalized = slash(relativePath); const name = path.posix.basename(normalized);
  return rules.some((raw) => { const rule = raw.replace(/^\//, '').replace(/\/$/, ''); if (!rule) return false; if (!/[?*]/.test(rule)) return normalized === rule || normalized.startsWith(`${rule}/`) || name === rule; const escaped = rule.split('*').map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*'); return new RegExp(`(^|/)${escaped}($|/)`).test(normalized); });
}
function ignored(relativePath: string, isDirectory: boolean, rules: readonly string[], size = 0): boolean {
  const first = slash(relativePath).split('/')[0];
  return DEFAULT_IGNORED_DIRECTORIES.has(first) || matchesGitIgnore(relativePath, rules) || (!isDirectory && (BINARY.test(relativePath) || TEMPORARY.test(relativePath) || GENERATED.test(relativePath) || size > 10 * 1024 * 1024));
}

export function detectWorkspaceFrameworks(files: readonly WorkspaceFile[], pkg: Record<string, any>): string[] {
  const names = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]); const has = (name: string) => names.has(name);
  const paths = new Set(files.map((file) => file.relativePath.toLowerCase())); const found: string[] = [];
  const add = (name: string, condition: boolean) => { if (condition) found.push(name); };
  add('Node', has('typescript') || has('express') || has('next') || has('react') || paths.has('package.json'));
  add('React', has('react') || has('react-dom')); add('Next.js', has('next') || [...paths].some((p) => p.startsWith('next.config.')));
  add('Vue', has('vue')); add('Angular', has('@angular/core') || paths.has('angular.json')); add('Express', has('express'));
  add('FastAPI', has('fastapi'));
  add('Laravel', paths.has('artisan') || has('laravel/framework')); add('Django', has('django') || paths.has('manage.py'));
  add('Flutter', paths.has('pubspec.yaml') && files.some((f) => f.relativePath.endsWith('.dart'))); add('Supabase', [...paths].some((p) => p.startsWith('supabase/')) || has('@supabase/supabase-js'));
  add('InsForge', has('@insforge/sdk') || paths.has('insforge.json') || paths.has('insforge.config.json')); add('Docker', paths.has('dockerfile') || paths.has('docker-compose.yml') || paths.has('docker-compose.yaml'));
  return found;
}

export class WorkspaceIntelligence {
  private context?: WorkspaceContext; private scanCount = 0;
  constructor(private readonly root = process.cwd(), private readonly clock: () => number = Date.now, private readonly gitInspect: (root: string) => GitRepositoryContext = inspectGitRepository) {}
  get scans(): number { return this.scanCount; }
  getContext(): WorkspaceContext { return this.context || this.scan(); }
  refresh(changedPaths: readonly string[] = []): WorkspaceContext {
    if (!this.context) return this.scan();
    if (changedPaths.length === 0) return this.scan();
    // Directory, ignore-rule, or manifest changes can affect discovery globally.
    if (changedPaths.some((value) => ['.gitignore', 'package.json', 'tsconfig.json'].includes(slash(value)) || !fs.existsSync(path.resolve(this.root, value)))) return this.scan();
    const existing = new Map(this.context.files.map((file) => [file.relativePath, file]));
    if (changedPaths.some((value) => !existing.has(slash(value)))) return this.scan();
    const changed = new Set(changedPaths.map(slash));
    const files = this.context.files.map((file) => {
      if (!changed.has(file.relativePath)) return file;
      const absolute = path.join(this.root, file.relativePath); const stat = fs.statSync(absolute);
      return { ...file, size: stat.size, hash: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), lastModified: stat.mtimeMs };
    });
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const projectStatistics = { ...this.context.projectStatistics, totalBytes };
    const summary = { ...this.context.summary, estimatedSize: totalBytes };
    const gitContext = this.gitInspect(this.root);
    this.context = deepFreeze({ ...this.context, files, projectStatistics, summary, gitRepository: gitContext.repositoryDetected, gitContext, contextVersion: this.context.contextVersion + 1, generatedAt: this.clock() });
    if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe workspace] git=attached state=${gitContext.workingTreeState}`);
    return this.context;
  }
  private scan(changedPaths: readonly string[] = []): WorkspaceContext {
    this.scanCount++; const rules = gitIgnoreRules(this.root); const previous = new Map(this.context?.files.map((f) => [f.relativePath, f]));
    const files: WorkspaceFile[] = []; const directories = new Set<string>(); const ignoredDirectories = new Set<string>(); const ignoredFiles: string[] = [];
    const visit = (directory: string): void => {
      let entries: fs.Dirent[]; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name); const relativePath = slash(path.relative(this.root, absolute)); const isDirectory = entry.isDirectory();
        if (ignored(relativePath, isDirectory, rules)) { if (isDirectory) ignoredDirectories.add(relativePath); else ignoredFiles.push(relativePath); continue; }
        if (isDirectory) { directories.add(relativePath.split('/')[0]); visit(absolute); continue; }
        if (!entry.isFile()) continue;
        let stat: fs.Stats; try { stat = fs.statSync(absolute); } catch { continue; }
        const old = previous.get(relativePath); const unchanged = old && old.size === stat.size && old.lastModified === stat.mtimeMs && !changedPaths.includes(relativePath);
        files.push({ relativePath, extension: path.extname(relativePath).toLowerCase(), language: LANGUAGE_BY_EXTENSION[path.extname(relativePath).toLowerCase()] || null, size: stat.size, hash: unchanged ? old.hash : createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), lastModified: stat.mtimeMs, ignored: false, important: isImportant(relativePath) });
      }
    }; visit(this.root);
    const pkg = readJson(path.join(this.root, 'package.json')); const languages = [...new Set(files.map((f) => f.language).filter((v): v is WorkspaceLanguage => v !== null))];
    const frameworks = detectWorkspaceFrameworks(files, pkg);
    const requirements = (() => { try { return fs.readFileSync(path.join(this.root, 'requirements.txt'), 'utf8'); } catch { return ''; } })();
    if (/^fastapi(?:[<=>\[]|$)/im.test(requirements) && !frameworks.includes('FastAPI')) frameworks.push('FastAPI');
    if (/^django(?:[<=>\[]|$)/im.test(requirements) && !frameworks.includes('Django')) frameworks.push('Django');
    const importantFiles = files.filter((f) => f.important).map((f) => f.relativePath); const configFiles = files.filter((f) => CONFIG_NAMES.has(f.relativePath.toLowerCase()) || /(^|\/)(?:.*\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?)$/i.test(f.relativePath)).map((f) => f.relativePath);
    const dependencyFiles = files.filter((f) => isDependencyFile(f.relativePath)).map((f) => f.relativePath); const entryPoints = files.filter((f) => /(^|\/)(?:main|index|app)\.(?:tsx?|jsx?|py|go|rs|php|java|cs|dart)$/i.test(f.relativePath)).map((f) => f.relativePath);
    const packageManager: PackageManager = files.some((f) => f.relativePath === 'pnpm-lock.yaml') ? 'pnpm' : files.some((f) => f.relativePath === 'yarn.lock') ? 'yarn' : files.some((f) => /^bun\.lock/.test(f.relativePath)) ? 'bun' : files.some((f) => f.relativePath === 'package.json') ? 'npm' : null;
    const statistics = { files: files.length, sourceFiles: files.filter((f) => f.language).length, configFiles: configFiles.length, totalBytes: files.reduce((sum, f) => sum + f.size, 0) };
    const summary = { projectType: frameworks[0] || languages[0] || 'Unknown', languages, frameworks, entryPoints, dependencyManagers: packageManager ? [packageManager] : [], estimatedSize: statistics.totalBytes, numberOfFiles: statistics.files, numberOfSourceFiles: statistics.sourceFiles, numberOfConfigFiles: statistics.configFiles };
    const gitContext = this.gitInspect(this.root);
    const availableScripts = Object.fromEntries(Object.entries(pkg.scripts || {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const packageBin = typeof pkg.bin === 'string'
      ? { [typeof pkg.name === 'string' ? pkg.name : 'cli']: pkg.bin }
      : Object.fromEntries(Object.entries(pkg.bin || {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const runtime = files.some((file) => file.relativePath === 'package.json') ? 'Node.js' : languages.includes('Python') ? 'Python' : languages.includes('Go') ? 'Go' : languages.includes('Rust') ? 'Rust' : null;
    this.context = deepFreeze({ workspaceRoot: this.root, projectName: pkg.name || path.basename(this.root), packageName: typeof pkg.name === 'string' ? pkg.name : null, packageVersion: typeof pkg.version === 'string' ? pkg.version : null, availableScripts, packageBin, runtime, framework: frameworks.includes('Next.js') ? 'next' : frameworks.includes('React') ? 'react-vite' : null, language: languages[0] || null, packageManager, detectedFrameworks: frameworks, detectedLanguages: languages, gitRepository: gitContext.repositoryDetected, gitContext, mainDirectories: [...directories].sort(), ignoredDirectories: [...ignoredDirectories].sort(), ignoredFiles: ignoredFiles.sort(), dependencyFiles, configFiles, importantFiles, entryPoints, projectStatistics: statistics, directoryStructure: [...directories].sort(), files, summary, contextVersion: (this.context?.contextVersion || 0) + 1, generatedAt: this.clock() });
    if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe workspace] git=attached state=${gitContext.workingTreeState}`);
    return this.context;
  }
}

const services = new Map<string, WorkspaceIntelligence>();
export function getWorkspaceIntelligence(root = process.cwd()): WorkspaceIntelligence { const resolved = path.resolve(root); let service = services.get(resolved); if (!service) { service = new WorkspaceIntelligence(resolved); services.set(resolved, service); } return service; }
export function getWorkspaceContext(root = process.cwd()): WorkspaceContext { return getWorkspaceIntelligence(root).getContext(); }

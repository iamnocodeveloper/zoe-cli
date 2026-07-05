import fs from 'fs';
import path from 'path';

export function getProjectDescription(): string {
  const cwd = process.cwd();
  const lines: string[] = [];

  lines.push(`Project path: ${cwd}`);
  lines.push(`Project name: ${path.basename(cwd)}`);
  lines.push('');

  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      lines.push(`Package: ${pkg.name || 'unnamed'}`);
      if (pkg.description) lines.push(`Description: ${pkg.description}`);
      if (pkg.version) lines.push(`Version: ${pkg.version}`);
      lines.push('');

      if (pkg.dependencies) {
        const deps = Object.keys(pkg.dependencies);
        lines.push(`Dependencies (${deps.length}): ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? '...' : ''}`);
      }
      if (pkg.devDependencies) {
        const devDeps = Object.keys(pkg.devDependencies);
        lines.push(`Dev Dependencies (${devDeps.length}): ${devDeps.slice(0, 10).join(', ')}${devDeps.length > 10 ? '...' : ''}`);
      }
      if (pkg.scripts) {
        lines.push(`Available scripts: ${Object.keys(pkg.scripts).join(', ')}`);
      }
      lines.push('');
    } catch {
      lines.push('(package.json parse error)');
    }
  }

  lines.push('Project structure (top level):');
  try {
    const items = fs.readdirSync(cwd);
    const ignored = new Set(['node_modules', '.git', '.zoe', 'dist']);
    for (const item of items.slice(0, 30)) {
      if (ignored.has(item)) continue;
      const fullPath = path.join(cwd, item);
      const isDir = fs.statSync(fullPath).isDirectory();
      lines.push(`  ${isDir ? '📁' : '📄'} ${item}`);
    }
    if (items.length > 30) lines.push('  ... and more');
  } catch {
    lines.push('  (error reading directory)');
  }

  return lines.join('\n');
}

export function getProjectTechStack(): string {
  const cwd = process.cwd();
  const techs: string[] = [];
  const pkgPath = path.join(cwd, 'package.json');

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depNames = Object.keys(allDeps);

      const frameworkPatterns: Record<string, string[]> = {
        'React': ['react', 'react-dom', 'create-react-app'],
        'Next.js': ['next', 'create-next-app'],
        'Vue': ['vue', 'vue-router', 'nuxt'],
        'Angular': ['@angular/core', '@angular/cli'],
        'Svelte': ['svelte', 'sveltekit'],
        'Express': ['express'],
        'NestJS': ['@nestjs/core'],
        'Fastify': ['fastify'],
        'TypeScript': ['typescript'],
        'JavaScript': ['webpack', 'parcel', 'vite'],
        'Vite': ['vite', 'vite-plugin'],
        'Tailwind CSS': ['tailwindcss', 'tailwind'],
        'Bootstrap': ['bootstrap', 'react-bootstrap'],
        'Prisma': ['prisma', '@prisma/client'],
        'Drizzle': ['drizzle-orm', 'drizzle-kit'],
        'Sequelize': ['sequelize'],
        'Jest': ['jest', '@jest'],
        'Vitest': ['vitest'],
        'ESLint': ['eslint'],
        'Prettier': ['prettier'],
        'Python': ['flask', 'django', 'fastapi'],
        'Rust': ['cargo'],
      };

      for (const [tech, patterns] of Object.entries(frameworkPatterns)) {
        if (patterns.some(p => depNames.some(d => d === p || d.startsWith(p + '/') || d.startsWith('@' + p)))) {
          techs.push(tech);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  if (!techs.includes('TypeScript') && fs.existsSync(tsconfigPath)) {
    techs.push('TypeScript');
  }

  if (techs.length === 0) {
    return 'Unknown (no package.json detected)';
  }

  return techs.join(', ');
}

export function getProjectFilesSummary(): string {
  const cwd = process.cwd();
  const files: string[] = [];

  function walkDir(dir: string, relativePath: string = '') {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git' || entry === '.zoe' || entry === 'dist') continue;
        const fullPath = path.join(dir, entry);
        const relPath = relativePath ? `${relativePath}/${entry}` : entry;
        if (fs.statSync(fullPath).isDirectory()) {
          walkDir(fullPath, relPath);
        } else {
          files.push(relPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walkDir(cwd);

  const extensions: Record<string, number> = {};
  for (const file of files) {
    const ext = path.extname(file) || 'no-extension';
    if (extensions[ext] === undefined) {
      extensions[ext] = 0;
    }
    extensions[ext]++;
  }

  const sorted = Object.entries(extensions).sort((a, b) => b[1] - a[1]);
  let summary = `Total files: ${files.length}\n`;
  summary += `File types: ${sorted.slice(0, 5).map(([ext, count]) => `${ext} (${count})`).join(', ')}`;

  const keyFiles = ['package.json', 'tsconfig.json', 'requirements.txt', 'go.mod', 'Cargo.toml', 'index.html', 'main.py', 'app.js', 'docker-compose.yml', 'Dockerfile'];
  const foundKeyFiles = keyFiles.filter(f => files.includes(f));
  if (foundKeyFiles.length > 0) {
    summary += `\nKey files: ${foundKeyFiles.join(', ')}`;
  }

  return summary;
}

export function detectDestructivePaths(): string[] {
  const cwd = process.cwd();
  const criticalPaths: string[] = [
    'package.json',
    'tsconfig.json',
    '.env',
    '.gitignore',
    'docker-compose.yml',
    'Dockerfile',
    'next.config.js',
    'next.config.mjs',
    'vite.config.ts',
    'vite.config.js',
  ];

  return criticalPaths.filter(p => fs.existsSync(path.join(cwd, p)));
}

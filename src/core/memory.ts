import fs from 'fs';
import path from 'path';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  projectPath: string;
  messages: Message[];
  created: string;
  updated: string;
}

let currentSession: Session | null = null;

function getSessionPath(): string {
  const zoeDir = path.join(process.cwd(), '.zoe');
  if (!fs.existsSync(zoeDir)) {
    fs.mkdirSync(zoeDir, { recursive: true });
  }
  return path.join(zoeDir, 'session.json');
}

export function loadSession(): Session {
  const sessionPath = getSessionPath();

  if (fs.existsSync(sessionPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      if (data.projectPath === process.cwd()) {
        currentSession = data;
        return data;
      }
    } catch {
      // Corrupt file, create new
    }
  }

  currentSession = {
    id: Date.now().toString(),
    projectPath: process.cwd(),
    messages: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  saveSession();
  return currentSession;
}

export function saveSession(): void {
  if (!currentSession) return;
  currentSession.updated = new Date().toISOString();
  fs.writeFileSync(getSessionPath(), JSON.stringify(currentSession, null, 2));
}

export function addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
  if (!currentSession) {
    loadSession();
  }

  currentSession!.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });

  if (currentSession!.messages.length > 30) {
    currentSession!.messages = currentSession!.messages.slice(-30);
  }

  saveSession();
}

export function getConversationHistory(): Message[] {
  if (!currentSession) {
    loadSession();
  }
  return currentSession?.messages || [];
}

export function getConversationContext(): string {
  const history = getConversationHistory();
  if (history.length === 0) {
    return 'No previous conversation.';
  }

  let context = '';
  const recent = history.slice(-8);
  for (const msg of recent) {
    const prefix = msg.role === 'user' ? 'User' : 'Zoe';
    const content = msg.content.length > 300
      ? msg.content.slice(0, 300) + '...'
      : msg.content;
    context += `${prefix}: ${content}\n\n`;
  }

  return context;
}

export function clearMemorySession(): void {
  currentSession = null;
  const sessionPath = getSessionPath();
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

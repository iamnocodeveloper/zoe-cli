export type TaskMode = 'CHAT_MODE' | 'TASK_MODE';

const taskSignals = [
  /\b(create|add|build|make|implement|fix|change|edit|modify|update|delete|remove|write|generate|install|run|execute)\b/i,
  /\b(crea|agrega|construye|implementa|corrige|cambia|edita|modifica|actualiza|elimina|escribe|genera|instala|ejecuta)\b/i,
  /(?:npm|pnpm|yarn|bun|git|node)\s+(?:run|install|add|test|build|start|exec|init|commit|status|diff)/i,
  /\b(src\/|src\\|\.tsx?\b|\.jsx?\b|\.css\b|package\.json)/i,
];

const chatOnly = /^(?:hola|hello|hi|hey|gracias|thanks|adios|bye|qué tal|que tal)\s*[!.?]*$/i;

export function classifyTask(input: string): TaskMode {
  const value = input.trim();
  if (!value || chatOnly.test(value)) return 'CHAT_MODE';
  return taskSignals.some((signal) => signal.test(value)) ? 'TASK_MODE' : 'CHAT_MODE';
}

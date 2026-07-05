const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

const ZOE_LOGO = `
${CYAN}${BOLD}███████╗ ██████╗ ███████╗
╚══██╔╝██╔═══██╗██╔════╝
   ██║ ██║   ██║█████╗  
   ██║ ██║   ██║██╔══╝  
   ██║ ╚██████╔╝███████╗
   ╚═╝  ╚═════╝ ╚══════╝${RESET}`;

export function printBanner(model: string, user?: string): void {
  console.log(ZOE_LOGO);
  console.log(`  ${DIM}v1.0.0${RESET}`);
  console.log();
  console.log(`  ${DIM}model${RESET}  ${CYAN}${model}${RESET}`);
  if (user) {
    console.log(`  ${DIM}user${RESET}   ${GREEN}${user}${RESET}`);
  }
  console.log(`  ${DIM}/help for commands${RESET}`);
  console.log();
}

export function printMiniBanner(model: string): void {
  const width = Math.min(process.stdout.columns || 60, 60);
  const line = DIM + '─'.repeat(width) + RESET;
  console.log();
  console.log(line);
  console.log(`  ${BOLD}Zoe${RESET}  ${DIM}model${RESET}  ${CYAN}${model}${RESET}`);
  console.log(line);
  console.log(`  ${DIM}Type a message to start. "exit" to quit.${RESET}`);
  console.log();
}

export function printWelcome(model: string, user?: string): void {
  console.log();
  console.log(`  ${GREEN}✓${RESET} ${DIM}Welcome to Zoe!${RESET}`);
  console.log();
  console.log(`  ${DIM}Model:${RESET} ${CYAN}${model}${RESET}`);
  if (user) {
    console.log(`  ${DIM}User:${RESET}  ${GREEN}${user}${RESET}`);
  }
  console.log();
  console.log(`  ${DIM}Type your message to start coding with AI assistance.${RESET}`);
  console.log(`  ${DIM}Use /help to see available commands.${RESET}`);
  console.log();
}

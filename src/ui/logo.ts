import chalk from 'chalk';

const LOGO_LINES = [
  '        ZZZZZZZZ   OOOOOOO   EEEEEEEE',
  '              ZZ  OO     OO  EE',
  '            ZZ    OO     OO  EEEEEE',
  '          ZZ      OO     OO  EE',
  '        ZZZZZZZZ    OOOOO    EEEEEEEE',
  '',
  '        "Zoe understands your project before AI does"',
];

export const ZOE_LOGO = LOGO_LINES.join('\n');

export function renderZoeLogo(): string {
  return LOGO_LINES.map((line, index) => {
    const color = index === 0 || index === 4 ? chalk.magentaBright : chalk.hex('#9b5cff');
    return color(line);
  }).join('\n');
}

export const ZOE_DIVIDER = '  ' + '─'.repeat(60);

export const ZOE_FOOTER = `
  ${chalk.gray('[Ctrl+C] Exit')}  │  ${chalk.magenta('/model')} Change model  │  ${chalk.gray('/help')} Help  │  ${chalk.gray('/scan')} Rescan
`;

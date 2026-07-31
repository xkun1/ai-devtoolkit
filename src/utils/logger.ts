import ora from 'ora';

type LogLevel = 'silent' | 'error' | 'info' | 'debug';

let currentLevel: LogLevel = 'info';
let spinner: any = null;

export function setVerbose(verbose: boolean) {
  currentLevel = verbose ? 'debug' : 'info';
}

export function startSpinner(text: string) {
  stopSpinner();
  spinner = ora(text).start();
  return spinner;
}

export function stopSpinner() {
  if (spinner) {
    spinner.stop();
    spinner = null;
  }
}

export function succeedSpinner(text?: string) {
  if (spinner) {
    spinner.succeed(text);
    spinner = null;
  }
}

export function failSpinner(text?: string) {
  if (spinner) {
    spinner.fail(text);
    spinner = null;
  }
}

export function info(msg: string) {
  if (currentLevel !== 'silent') {
    console.log(msg);
  }
}

export function debug(msg: string) {
  if (currentLevel === 'debug') {
    console.log(`  \x1b[90m${msg}\x1b[0m`);
  }
}

export function error(msg: string) {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
}

export function success(msg: string) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

export function warn(msg: string) {
  console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

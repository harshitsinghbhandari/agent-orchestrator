import chalk from "chalk";

export function fail(err: unknown): never {
  console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
}

import { validateManifestCmd } from "./commands/validateManifest";
import { measureCmd } from "./commands/measure";
import { calibrateCmd } from "./commands/calibrate";
import { renderCmd } from "./commands/render";
import { diffCmd } from "./commands/diff";
import { proofCmd } from "./commands/proof";
import { validate04Cmd } from "./commands/validate04";
import { composeCmd } from "./commands/compose";
import { validatePhase2Cmd } from "./commands/validatePhase2";

type Cmd = (args: any) => Promise<any>;

const COMMANDS: Record<string, Cmd> = {
  "validate-manifest": validateManifestCmd,
  measure: measureCmd,
  calibrate: calibrateCmd,
  render: renderCmd,
  diff: diffCmd,
  proof: proofCmd,
  validate04: validate04Cmd,
  compose: composeCmd,
  "validate-phase2": validatePhase2Cmd,
};

function parseArgs(argv: string[]): any {
  const args: any = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const fn = cmd ? COMMANDS[cmd] : undefined;
  if (!fn) {
    console.error(`Usage: studio <command> [--template 04] [...]`);
    console.error(`Commands: ${Object.keys(COMMANDS).join(", ")}`);
    process.exit(2);
  }
  try {
    await fn(parseArgs(rest));
  } catch (e: any) {
    // Fail-closed: any error -> explicit message + non-zero exit. Never a silent pass.
    console.error(`ERROR [${cmd}]: ${e?.message || e}`);
    if (process.env.STUDIO_DEBUG) console.error(e?.stack);
    process.exit(1);
  }
}

main();

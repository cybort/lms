import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "@commander-js/extra-typings";
import { addLogLevelOptions, createLogger, type LogLevelArgs } from "../../logLevel.js";
import { UserInputError } from "../../types/UserInputError.js";

/**
 * Register a PrismML (or other custom) llama.cpp build as an LM Studio backend.
 *
 * Shells out to the sibling `lmstudio-prism` installer (config with local_path or url).
 * Does not modify the closed-source desktop app; it only writes under
 * ~/.lmstudio/extensions/backends/.
 */

function resolvePrismRoot(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }
  if (process.env.LMSTUDIO_PRISM_ROOT) {
    return resolve(process.env.LMSTUDIO_PRISM_ROOT);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "..", "lmstudio-prism"),
    resolve(process.cwd(), "lmstudio-prism"),
    // dist/subcommands/runtime -> monorepo root is ../../../../.. ; sibling lmstudio-prism
    resolve(here, "..", "..", "..", "..", "..", "lmstudio-prism"),
    join(homedir(), "project", "lmstudio-prism"),
    "K:\\project\\lmstudio-prism",
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "install.py")) || existsSync(join(c, "install.ps1"))) {
      return c;
    }
  }
  throw new UserInputError(
    "lmstudio-prism not found. Set --prism-root or LMSTUDIO_PRISM_ROOT to the install folder.",
  );
}

function runInstaller(args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", code => resolvePromise(code ?? 1));
  });
}

const registerCustom = new Command()
  .name("register-custom")
  .description(
    "Install a custom llama.cpp (e.g. PrismML) into ~/.lmstudio/extensions/backends via lmstudio-prism",
  )
  .option("--config <path>", "Path to lmstudio-prism config.json")
  .option("--path <dir>", "Local Prism/cuda folder (sets mode=local)")
  .option("--url <url>", "Download URL for a Prism zip (sets mode=url)")
  .option("--prism-root <dir>", "Path to the lmstudio-prism project")
  .addOption(new Option("--force", "Rebuild the backend folder").default(false))
  .action(async function () {
    const opts = this.optsWithGlobals() as LogLevelArgs & {
      config?: string;
      path?: string;
      url?: string;
      prismRoot?: string;
      force?: boolean;
    };
    const logger = createLogger(opts);

    if (!opts.config && !opts.path && !opts.url) {
      throw new UserInputError("Provide at least one of --config, --path, or --url");
    }

    const prismRoot = resolvePrismRoot(opts.prismRoot);
    logger.info(`Using lmstudio-prism at ${prismRoot}`);

    const py = join(prismRoot, "install.py");
    const ps1 = join(prismRoot, "install.ps1");

    let code: number;
    if (existsSync(py)) {
      const cmd = ["python", py];
      if (opts.config) {
        cmd.push("--config", resolve(opts.config));
      }
      if (opts.path) {
        cmd.push("--path", resolve(opts.path));
      }
      if (opts.url) {
        cmd.push("--url", opts.url);
      }
      if (opts.force) {
        cmd.push("--force");
      }
      code = await runInstaller(cmd, prismRoot);
    } else if (process.platform === "win32" && existsSync(ps1)) {
      const cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1,
      ];
      if (opts.config) {
        cmd.push("-ConfigPath", resolve(opts.config));
      }
      if (opts.force) {
        cmd.push("-Force");
      }
      code = await runInstaller(cmd, prismRoot);
    } else {
      throw new UserInputError(`No install.py / install.ps1 under ${prismRoot}`);
    }

    if (code !== 0) {
      process.exit(code);
    }

    logger.info("Custom backend registered. Select it with Ctrl+Shift+R or:");
    logger.info("  lms runtime ls");
    logger.info("  lms runtime select <name>@<version>");
  });

addLogLevelOptions(registerCustom);

export const registerCustomCommand = registerCustom;

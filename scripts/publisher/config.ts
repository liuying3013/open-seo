import { readFileSync } from "node:fs";
import path from "node:path";

export type Config = {
  openseoUrl: string;
  openseoApiKey: string;
  // Coolify is only needed when something has to be deployed.
  coolifyUrl: string | null;
  coolifyToken: string | null;
  sitesDir: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}

function readSecret(fileVar: string): string {
  const secret = readFileSync(required(fileVar), "utf8").trim();
  if (!secret) throw new Error(`${fileVar} points to an empty file.`);
  return secret;
}

export function loadConfig(): Config {
  const coolifyUrl = process.env.COOLIFY_URL?.trim() || null;
  return {
    openseoUrl: required("OPENSEO_URL").replace(/\/+$/, ""),
    openseoApiKey: readSecret("OPENSEO_API_KEY_FILE"),
    coolifyUrl: coolifyUrl?.replace(/\/+$/, "") ?? null,
    coolifyToken: coolifyUrl ? readSecret("COOLIFY_TOKEN_FILE") : null,
    sitesDir: path.resolve(required("SITES_DIR")),
  };
}

/** `owner/name`, `name`, or a git URL -> `name`. Null when it is not a plain name. */
export function repoNameOf(githubRepo: string): string | null {
  const name = githubRepo
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .pop();
  return name && /^[\w.-]+$/.test(name) && name !== "." && name !== ".."
    ? name
    : null;
}

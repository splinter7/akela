const PLACEHOLDER_RE =
  /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const ANY_PLACEHOLDER_RE = /\$\{([^}]*)\}/g;

/**
 * Replace `${name}` and `${name:-default}` placeholders in journey text using
 * the provided vars map. Explicit vars always win over inline defaults.
 * Fails if any required `${…}` placeholders remain unresolved after substitution.
 */
export function substituteVars(
  text: string,
  vars: Record<string, string>,
): string {
  const replaced = text.replace(
    PLACEHOLDER_RE,
    (_match, name: string, defaultValue: string | undefined) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        return vars[name]!;
      }
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      return _match;
    },
  );

  const missing = new Set<string>();
  for (const m of replaced.matchAll(ANY_PLACEHOLDER_RE)) {
    const inner = m[1] ?? "";
    missing.add(inner || "(empty)");
  }

  if (missing.size > 0) {
    const list = [...missing].sort().join(", ");
    throw new Error(
      `Unresolved journey variables: ${list}. Pass --var name=value for each.`,
    );
  }

  return replaced;
}

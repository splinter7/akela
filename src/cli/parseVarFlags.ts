export function takeFlagValue(
  args: string[],
  i: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = args[i]!;
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (!value) throw new Error(`${flag} requires a value`);
    return { value, nextIndex: i };
  }
  const next = args[i + 1];
  if (!next || next.startsWith("-")) throw new Error(`${flag} requires a value`);
  return { value: next, nextIndex: i + 1 };
}

export function parseVarAssignment(raw: string): { name: string; value: string } {
  const eq = raw.indexOf("=");
  if (eq <= 0) {
    throw new Error(`--var requires name=value (got: ${raw})`);
  }
  const name = raw.slice(0, eq);
  const value = raw.slice(eq + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid variable name: ${name}`);
  }
  if (value === "") {
    throw new Error(`--var ${name}= requires a non-empty value`);
  }
  return { name, value };
}

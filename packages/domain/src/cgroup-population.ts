export function parseCgroupPopulation(bytes: string): "empty" | "populated" | "unknown" {
  let populated: string | undefined;
  const seen = new Set<string>();
  for (const line of bytes.split("\n")) {
    if (!line) continue;
    const match = /^([a-z_]+) ([0-9]+)$/.exec(line);
    if (!match || seen.has(match[1]!)) return "unknown";
    seen.add(match[1]!);
    if (match[1] === "populated") populated = match[2];
  }
  return populated === "0" ? "empty" : populated === "1" ? "populated" : "unknown";
}


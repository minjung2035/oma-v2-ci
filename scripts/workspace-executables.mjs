/** Reviewed native build recipes. Manifests select only their own executable;
 * source assets, package URL checks and compilation use this same ownership. */
const recipes = [
  { owner: "@oma/platform-mac", source: "seatbelt/main.c", output: "seatbelt/oma-seatbelt", libraries: ["sandbox"] },
  { owner: "@oma/native", source: "xattr/main.c", output: "xattr/oma-list-xattr", libraries: [] },
];
export function darwinExecutables(manifest) {
  const declared = manifest.oma?.darwinExecutables ?? [];
  if (!Array.isArray(declared) || new Set(declared).size !== declared.length)
    throw new Error("invalid Darwin executable declarations");
  return declared.map(output => {
    const recipe = recipes.find(row => row.owner === manifest.name && row.output === output);
    if (!recipe || !(manifest.oma?.assets ?? []).includes(recipe.source))
      throw new Error(`unreviewed Darwin executable: ${manifest.name}/${String(output)}`);
    return recipe;
  });
}

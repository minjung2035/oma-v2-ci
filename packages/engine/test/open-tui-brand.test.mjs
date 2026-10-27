import test from "node:test";
import assert from "node:assert/strict";
import { OMA_LOGO, brandFooter, brandHeader, swapText } from "@oma/engine/open-tui-brand";
import { visibleWidth as cellWidth } from "@earendil-works/pi-tui";
const accent = (text) => `\x1b[35m${text}\x1b[39m`;
const dim = (text) => `\x1b[2m${text}\x1b[22m`;
const pad = (text, width) => text + " ".repeat(Math.max(0, width - cellWidth(text)));
const center = (text, width) => {
    const left = Math.floor((width - cellWidth(text)) / 2);
    return pad(" ".repeat(left) + text, width);
};
// The shape Open TUI's header renders: a titled top border, a centered left
// column (seven logo rows, tagline, model, path) and a tips column.
const WIDTH = 72;
const row = (left, right) => `${accent("│")}${pad(left, 44)} ${accent("│")} ${pad(right, 23)}${accent("│")}`;
const logo = (cells) => center(accent(cells), 44);
const header = [
    `${accent("╭")}${accent("─── ")}${accent("Pi")} v1.0.1${accent(" ─────")}${accent("─".repeat(WIDTH - 21))}${accent("╮")}`,
    row(logo(""), ""),
    row(logo(""), accent("Welcome")),
    row(logo("█████████"), "Ask Pi anything"),
    row(logo("███   ███"), accent("──────────")),
    row(logo("██████   ███"), accent("Commands")),
    row(logo("███      ███"), "/open-tui"),
    row(logo(""), "/copy"),
    row(center("Let's build something great", 44), "/hotkeys"),
    row(center("fake/scripted · off", 44), "/clone"),
    row(center(dim("~"), 44), ""),
    `${accent("╰")}${accent("─".repeat(WIDTH - 2))}${accent("╯")}`,
];
const brand = { title: "oma", version: "0.1.0", engineVersion: "1.0.1", project: "~/work/demo", tip: "Ctrl+X oma settings",
    society: "demo-9017360114-2" };
const plainOf = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
test("Open TUI brand: oma's title, logo, society, project and Ctrl+X tip, every line at upstream's width", () => {
    const branded = brandHeader(header, brand, accent);
    assert.deepEqual(branded.map(cellWidth), header.map(cellWidth));
    const plain = branded.map(plainOf);
    assert.match(plain[0], /─── oma v0\.1\.0 ─────/);
    // oma's own mark replaces upstream's, rows 1-7 of the left column.
    const left = plain.slice(1, 8).map(line => line.split("│")[1].trim());
    assert.deepEqual(left.filter(Boolean), [...OMA_LOGO].map(mark => mark.trim()));
    assert.equal(plain.some(line => line.includes("█████████")), false, "upstream's logo is gone");
    assert.equal(plain[8].split("│")[1].trim(), "Your ideas, in motion");
    assert.match(plain[2], /│ Society\s/);
    assert.match(plain[3], /│ demo-9017360114-2 /);
    assert.equal(plain.some(line => /Ask Pi anything/.test(line)), false);
    assert.match(plain[10], /~\/work\/demo/);
    assert.equal(plain[10].includes(" ~ "), false);
    assert.match(plain[9], /│ Ctrl\+X oma settings/);
    assert.match(plain[6], /│ \/open-tui/, "the other tips are upstream's");
    // A longer title takes from the border's fill, never past the corner.
    const long = brandHeader(header, { ...brand, version: "10.20.30" });
    assert.equal(cellWidth(long[0]), cellWidth(header[0]));
    // A path or society wider than its column is shortened, not allowed to push the box.
    const wide = brandHeader(header, { ...brand, project: `~/${"x".repeat(80)}`, society: `s${"x".repeat(40)}` });
    assert.deepEqual(wide.map(cellWidth), header.map(cellWidth));
    assert.match(plainOf(wide[10]), /…/);
    assert.match(plainOf(wide[3]), /…/);
    // A column too narrow for the mark shows the name instead.
    const narrowRow = (left, right) => `${accent("│")}${pad(left, 28)} ${accent("│")} ${pad(right, 23)}${accent("│")}`;
    const narrow = brandHeader([header[0], ...header.slice(1, 8).map(() => narrowRow("", "")),
        narrowRow(center("Let's build something great", 28), ""), header.at(-1)], brand, accent);
    assert.ok(narrow.map(plainOf).some(line => line.split("│")[1]?.trim() === "oma"));
    assert.deepEqual(brandHeader([], brand), []);
});
test("Open TUI brand: a crowded tips cell truncates on grapheme boundaries, never mid-emoji", () => {
    // NB-11's swapText fix held for the last tip cell too: a UTF-16 code-unit
    // cut stops inside a surrogate pair (visibleWidth reads a lone surrogate as
    // 0, so the old loop halted with half a cluster written).
    const clustersOf = (text) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(entry => entry.segment);
    const isGraphemePrefix = (full, part) => {
        const prefixes = new Set([""]);
        let acc = "";
        for (const cluster of clustersOf(full)) {
            acc += cluster;
            prefixes.add(acc);
        }
        return prefixes.has(part);
    };
    const tipsCell = (branded) => plainOf(branded[9]).split("│")[2].trim();
    // Rockets: a surrogate-pair cluster must appear whole or not at all.
    const tip = "🚀".repeat(12); // one cluster over the tips column's width
    const branded = brandHeader(header, { ...brand, tip });
    assert.deepEqual(branded.map(cellWidth), header.map(cellWidth), "truncation changed the box");
    const shown = tipsCell(branded);
    assert.match(shown, /…$/);
    assert.ok(isGraphemePrefix(tip, shown.slice(0, -1)), `not a grapheme prefix: ${JSON.stringify(shown)}`);
    // Flag + rockets: a flag is two regional indicators; half of one is a stray letter.
    const flagged = brandHeader(header, { ...brand, tip: `🇫🇷${"🚀".repeat(12)}` });
    assert.deepEqual(flagged.map(cellWidth), header.map(cellWidth));
    const flagShown = tipsCell(flagged);
    assert.match(flagShown, /…$/);
    assert.ok(isGraphemePrefix(`🇫🇷${"🚀".repeat(12)}`, flagShown.slice(0, -1)), `a flag was split: ${JSON.stringify(flagShown)}`);
    assert.doesNotMatch(plainOf(flagged[9]), /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "a lone surrogate reached the screen");
    // ASCII truncation is unchanged: a long ASCII tip still ends in the ellipsis.
    const ascii = brandHeader(header, { ...brand, tip: "x".repeat(40) });
    assert.deepEqual(ascii.map(cellWidth), header.map(cellWidth));
    assert.match(tipsCell(ascii), /^x+…$/);
    // And a tip that fits is left alone.
    assert.equal(tipsCell(brandHeader(header, brand)), "Ctrl+X oma settings");
});
test("Open TUI brand: the footer names the project from its own gap, or leaves the line alone", () => {
    const footer = [`${accent("")} ${accent("~")}${" ".repeat(40)}${accent("[░░░] 0.0%")}`, "second"];
    const branded = brandFooter(footer, brand);
    assert.equal(cellWidth(branded[0]), cellWidth(footer[0]));
    assert.match(branded[0], /~\/work\/demo/);
    assert.equal(branded[1], "second");
    const tight = [`${accent("")} ${accent("~")}  ${accent("x")}`];
    assert.equal(cellWidth(brandFooter(tight, brand)[0]), cellWidth(tight[0]));
    assert.equal(swapText("abc", "zzz", "q"), "abc");
});

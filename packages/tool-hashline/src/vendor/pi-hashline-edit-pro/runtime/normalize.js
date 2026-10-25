export function detectEnding(content) {
    const crIdx = content.indexOf("\r");
    const lfIdx = content.indexOf("\n");
    if (crIdx === -1 && lfIdx === -1)
        return "\n";
    if (crIdx === -1)
        return "\n";
    if (lfIdx === -1)
        return "\r";
    if (crIdx < lfIdx)
        return content[crIdx + 1] === "\n" ? "\r\n" : "\r";
    return "\n";
}
export function toLF(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
export function restoreEndings(text, ending) {
    if (ending === "\r\n")
        return text.replace(/\n/g, "\r\n");
    if (ending === "\r")
        return text.replace(/\n/g, "\r");
    return text;
}
export function stripBOM(content) {
    return content.startsWith("\uFEFF")
        ? { bom: "\uFEFF", text: content.slice(1) }
        : { bom: "", text: content };
}

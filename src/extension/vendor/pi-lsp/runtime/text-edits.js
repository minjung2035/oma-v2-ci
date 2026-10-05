export function positionAt(text, offset) {
    const boundedOffset = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < boundedOffset; index += 1) {
        if (text[index] === "\n") {
            line += 1;
            lineStart = index + 1;
        }
    }
    return { line, character: boundedOffset - lineStart };
}
function offsetAt(text, position) {
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < text.length && line < position.line; index += 1) {
        if (text[index] === "\n") {
            line += 1;
            lineStart = index + 1;
        }
    }
    if (line < position.line)
        return text.length;
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0)
        lineEnd = text.length;
    return Math.min(lineStart + position.character, lineEnd);
}
export function applyTextEdits(text, edits) {
    let output = text;
    const sortedEdits = positionTextEdits(text, edits).sort((left, right) => {
        if (left.start !== right.start)
            return right.start - left.start;
        if (left.end !== right.end)
            return right.end - left.end;
        return right.index - left.index;
    });
    for (const { edit, start, end } of sortedEdits) {
        output = `${output.slice(0, start)}${edit.newText}${output.slice(end)}`;
    }
    return output;
}
export function hasOverlappingTextEdits(text, edits) {
    const positionedEdits = positionTextEdits(text, edits);
    for (let leftIndex = 0; leftIndex < positionedEdits.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < positionedEdits.length; rightIndex += 1) {
            if (textEditRangesConflict(positionedEdits[leftIndex], positionedEdits[rightIndex])) {
                return true;
            }
        }
    }
    return false;
}
function positionTextEdits(text, edits) {
    return edits.map((edit, index) => ({
        edit,
        index,
        start: offsetAt(text, edit.range.start),
        end: offsetAt(text, edit.range.end),
    }));
}
function textEditRangesConflict(left, right) {
    if (left.start === left.end && right.start === right.end)
        return false;
    if (left.start === left.end || right.start === right.end) {
        const insert = left.start === left.end ? left : right;
        const replacement = left.start === left.end ? right : left;
        return replacement.start < insert.start && insert.start < replacement.end;
    }
    return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}
export function collectWorkspaceEdits(edit, uri) {
    if (!edit)
        return [];
    if (edit.documentChanges) {
        return edit.documentChanges.flatMap((change) => (change.textDocument?.uri === uri ? (change.edits ?? []) : []));
    }
    return edit.changes?.[uri] ?? [];
}

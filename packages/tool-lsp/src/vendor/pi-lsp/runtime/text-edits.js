// OMA divergences (applied by scripts/vendor-pi-lsp.mjs; recorded under
// generated.divergences in manifest.json). Resolved workspace edits are
// bounded in count and replacement bytes; overlap checking is a sorted
// sweep, not a quadratic scan; application is a single ordered pass.
export const OMA_MAX_WORKSPACE_EDITS = 2048;
export const OMA_MAX_WORKSPACE_EDIT_BYTES = 4 * 1024 * 1024;
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
    // OMA divergence: one pass over the edits ordered by position instead
    // of splicing the whole string once per edit. The output is identical
    // for non-overlapping edits (overlap is refused upstream of this);
    // same-position inserts keep list order -- the reverse-sorted
    // application landed earlier-indexed text first and so does this.
    const orderedEdits = positionTextEdits(text, edits).sort((left, right) => {
        if (left.start !== right.start)
            return left.start - right.start;
        if (left.end !== right.end)
            return left.end - right.end;
        return left.index - right.index;
    });
    let output = "";
    let cursor = 0;
    for (const { edit, start, end } of orderedEdits) {
        output += text.slice(cursor, start) + edit.newText;
        cursor = end;
    }
    return output + text.slice(cursor);
}
export function hasOverlappingTextEdits(text, edits) {
    // OMA divergence: a sorted sweep replaces the quadratic pair scan --
    // synchronous O(n^2) CPU on a hostile edit list could not be
    // interrupted by the request timeout or AbortSignal. Edits are
    // grouped by start offset; a non-empty range conflicts with an
    // earlier-starting range still open at its start or with a sibling
    // starting at the same offset, and an insert conflicts only strictly
    // inside an earlier range -- exactly the pair scan's verdicts.
    const positionedEdits = positionTextEdits(text, edits).sort((left, right) => left.start - right.start);
    let index = 0;
    let openEnd = -1;
    while (index < positionedEdits.length) {
        const start = positionedEdits[index].start;
        let siblingHasRange = false;
        let siblingEnd = -1;
        while (index < positionedEdits.length && positionedEdits[index].start === start) {
            const positioned = positionedEdits[index];
            if (positioned.start === positioned.end) {
                if (openEnd > start)
                    return true;
            }
            else {
                if (openEnd > start || siblingHasRange)
                    return true;
                siblingHasRange = true;
                if (positioned.end > siblingEnd)
                    siblingEnd = positioned.end;
            }
            index += 1;
        }
        if (siblingEnd > openEnd)
            openEnd = siblingEnd;
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
    // OMA divergence: the collected list is bounded while it builds -- an
    // over-bound documentChanges array is refused mid-collection, not
    // after a flatMap materialized every element.
    if (!edit)
        return [];
    const collected = [];
    let bytes = 0;
    const take = (list) => {
        for (const entry of list ?? []) {
            collected.push(entry);
            if (collected.length > OMA_MAX_WORKSPACE_EDITS)
                throw new Error(`workspace edits exceeded OMA's ${OMA_MAX_WORKSPACE_EDITS}-edit bound`);
            bytes += typeof entry?.newText === "string" ? entry.newText.length : 0;
            if (bytes > OMA_MAX_WORKSPACE_EDIT_BYTES)
                throw new Error(`workspace edits exceeded OMA's ${OMA_MAX_WORKSPACE_EDIT_BYTES}-byte bound`);
        }
    };
    if (edit.documentChanges) {
        for (const change of edit.documentChanges)
            if (change.textDocument?.uri === uri)
                take(change.edits);
        return collected;
    }
    take(edit.changes?.[uri]);
    return collected;
}

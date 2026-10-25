export function countNewlines(content) {
    let count = 0;
    for (let index = 0; index < content.length; index++) {
        if (content.charCodeAt(index) === 10)
            count += 1;
    }
    return count;
}
export function splitSeparators(raw) {
    const separators = [];
    for (let index = 0; index < raw.length; index++) {
        const char = raw[index];
        if (char === "\r") {
            if (raw[index + 1] === "\n") {
                separators.push("\r\n");
                index += 1;
            }
            else {
                separators.push("\r");
            }
        }
        else if (char === "\n") {
            separators.push("\n");
        }
    }
    return separators;
}
export function joinSeparators(content, separators) {
    let out = "";
    let separatorIndex = 0;
    for (const char of content) {
        if (char === "\n") {
            out += separators[separatorIndex] ?? "\n";
            separatorIndex += 1;
        }
        else {
            out += char;
        }
    }
    return out;
}
function sourceLineMap(baseLineCount, spans) {
    const sorted = [...spans].sort((left, right) => left.start - right.start);
    const map = [];
    let baseLine = 0;
    for (const span of sorted) {
        while (baseLine < span.start && baseLine < baseLineCount) {
            map.push(baseLine);
            baseLine += 1;
        }
        const spanLength = span.end >= span.start ? span.end - span.start + 1 : 0;
        for (let offset = 0; offset < span.replacementCount; offset++) {
            if (offset < spanLength)
                map.push(span.start + offset);
            else
                map.push(spanLength > 0 ? span.end : span.start - 1);
        }
        baseLine = span.end >= span.start ? span.end + 1 : span.start;
    }
    while (baseLine < baseLineCount) {
        map.push(baseLine);
        baseLine += 1;
    }
    return map;
}
export function separatorsForSpans(baseSeparators, baseLineCount, spans, resultContent, fallback) {
    const mapped = sourceLineMap(baseLineCount, spans).map((source) => source >= 0 && source < baseSeparators.length ? baseSeparators[source] : "");
    const needed = countNewlines(resultContent);
    const result = [];
    for (let index = 0; index < needed; index++) {
        const candidate = mapped[index];
        if (candidate !== undefined && candidate !== "")
            result.push(candidate);
        else
            result.push(result[index - 1] ?? fallback);
    }
    return result;
}
export function endingsForRange(separators, startLine, endLine) {
    const endings = [];
    for (let line = startLine; line <= endLine; line += 1) {
        endings.push(separators[line - 1]);
    }
    return endings;
}
export function splitWithEndings(text) {
    const lines = [];
    const endings = [];
    let current = "";
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === "\r") {
            const crlf = text[index + 1] === "\n";
            endings.push(crlf ? "\r\n" : "\r");
            lines.push(current);
            current = "";
            if (crlf)
                index += 1;
            continue;
        }
        if (char === "\n") {
            endings.push("\n");
            lines.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    lines.push(current);
    endings.push(undefined);
    return { lines, endings };
}
export function applyEndingOverrides(separators, spanStart, endings) {
    if (endings === undefined)
        return;
    for (let index = 0; index < endings.length; index += 1) {
        const ending = endings[index];
        if (ending === undefined)
            continue;
        const target = spanStart + index;
        if (target >= 0 && target < separators.length)
            separators[target] = ending;
    }
}
export function applySpanEndings(separators, spans) {
    const sorted = [...spans].sort((left, right) => left.start - right.start);
    let offset = 0;
    for (const span of sorted) {
        if (span.endings !== undefined) {
            for (let index = 0; index < span.endings.length; index += 1) {
                const ending = span.endings[index];
                if (ending === undefined)
                    continue;
                const target = span.start + offset + index;
                if (target >= 0 && target < separators.length)
                    separators[target] = ending;
            }
        }
        offset += span.replacementCount - (span.end - span.start + 1);
    }
}

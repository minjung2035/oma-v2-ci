import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { checkGhAvailable, showGhHint } from "./github-api.js";
import { fetchRemoteUrl, loadFetchContentDomainPolicy, loadSsrfConfig } from "./ssrf-protection.js";
import { getWebSearchConfigPath } from "./utils.js";
const CONFIG_PATH = getWebSearchConfigPath();
const GH_TIMEOUT_MS = 10_000;
const GH_TOTAL_TIMEOUT_MS = 20_000;
const MAX_DOC_CHARS = 150_000;
const BODY_INLINE_CHARS = 4_000;
const COMMENT_INLINE_CHARS = 700;
const MAX_INLINE_COMMENTS = 15;
const MAX_INLINE_REVIEWS = 10;
const MAX_INLINE_CHECKS = 15;
const MAX_INLINE_FILES = 50;
const MAX_INLINE_COMMITS = 20;
const MAX_INLINE_REVIEW_THREADS = 30;
const REST_HEADERS = { "Accept": "application/vnd.github+json", "User-Agent": "pi-web-access" };
const PR_SUBPATHS = new Set(["files", "commits", "checks", "conversation"]);
const PR_FIELDS = [
    "title", "number", "state", "isDraft", "author", "baseRefName", "headRefName", "headRepositoryOwner",
    "createdAt", "mergedAt", "closedAt", "labels", "milestone", "additions", "deletions", "changedFiles",
    "files", "commits", "reviews", "statusCheckRollup", "comments", "body", "closingIssuesReferences", "url",
];
const PR_CORE_FIELDS = [
    "title", "number", "state", "isDraft", "author", "baseRefName", "headRefName", "headRepositoryOwner",
    "createdAt", "mergedAt", "closedAt", "labels", "milestone", "additions", "deletions", "changedFiles",
    "files", "commits", "reviews", "comments", "body", "url",
];
const ISSUE_FIELDS = [
    "title", "number", "state", "stateReason", "author", "createdAt", "closedAt", "labels", "assignees", "milestone",
    "comments", "body", "closedByPullRequestsReferences", "url",
];
const ISSUE_CORE_FIELDS = ["title", "number", "state", "author", "createdAt", "closedAt", "labels", "assignees", "milestone", "comments", "body", "url"];
let cachedConfig = null;
function loadConfig() {
    if (cachedConfig)
        return cachedConfig;
    const defaults = { enabled: true };
    if (!existsSync(CONFIG_PATH)) {
        cachedConfig = defaults;
        return cachedConfig;
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
    }
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const value = root.githubPrIssue;
    if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
        throw new Error(`githubPrIssue in ${CONFIG_PATH} must be an object`);
    }
    const enabled = typeof value?.enabled === "boolean"
        ? value.enabled
        : true;
    cachedConfig = { enabled };
    return cachedConfig;
}
function validOwner(owner) {
    return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) && !owner.includes("--");
}
function validRepo(repo) {
    return /^[A-Za-z0-9._-]{1,100}$/.test(repo) && repo !== "." && repo !== "..";
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function isAbortError(err) {
    return errorMessage(err).toLowerCase().includes("abort");
}
export function parseGitHubIssuePrUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com")
        return null;
    const segments = [];
    for (const segment of parsed.pathname.split("/").filter(Boolean)) {
        try {
            segments.push(decodeURIComponent(segment));
        }
        catch {
            return null;
        }
    }
    if (segments.length < 4)
        return null;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/, "");
    if (!validOwner(owner) || !validRepo(repo))
        return null;
    const route = segments[2].toLowerCase();
    if (route !== "pull" && route !== "issues")
        return null;
    if (!/^\d+$/.test(segments[3]))
        return null;
    const subpath = segments[4]?.toLowerCase();
    if (route === "pull" && subpath && !PR_SUBPATHS.has(subpath))
        return null;
    if (route === "issues" && subpath)
        return null;
    const number = Number.parseInt(segments[3], 10);
    if (!Number.isSafeInteger(number) || number <= 0)
        return null;
    const fragment = parsed.hash.slice(1);
    const anchorPattern = route === "pull" ? /^(?:issuecomment-\d+|discussion_r\d+)$/i : /^issuecomment-\d+$/i;
    const anchor = anchorPattern.test(fragment) ? fragment : undefined;
    return { owner, repo, kind: route === "pull" ? "pull" : "issue", number, ...(anchor ? { anchor } : {}) };
}
function runGh(args, timeoutMs = GH_TIMEOUT_MS, signal) {
    return new Promise((resolve) => {
        execFile("gh", args, {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            ...(signal ? { signal } : {}),
            env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
        }, (err, stdout, stderr) => {
            const nodeErr = err;
            resolve({
                ok: !err,
                stdout,
                stderr,
                code: typeof nodeErr?.code === "number" ? nodeErr.code : null,
                ...(err ? { error: nodeErr?.message ?? String(err) } : {}),
            });
        });
    });
}
function remainingGhTimeout(deadlineMs) {
    return Math.max(1, Math.min(GH_TIMEOUT_MS, deadlineMs - Date.now()));
}
function unknownJsonField(result) {
    return /unknown (?:json )?field|UnknownField|Unknown JSON field/i.test(`${result.stderr}\n${result.error ?? ""}`);
}
async function ghView(info, deadlineMs, signal) {
    const repoArg = `${info.owner}/${info.repo}`;
    const command = info.kind === "pull" ? "pr" : "issue";
    const fields = info.kind === "pull" ? PR_FIELDS : ISSUE_FIELDS;
    const coreFields = info.kind === "pull" ? PR_CORE_FIELDS : ISSUE_CORE_FIELDS;
    let result = await runGh([command, "view", String(info.number), "--repo", repoArg, "--json", fields.join(",")], remainingGhTimeout(deadlineMs), signal);
    const notes = [];
    let linkedReferencesUnavailable = false;
    if (!result.ok && unknownJsonField(result)) {
        result = await runGh([command, "view", String(info.number), "--repo", repoArg, "--json", coreFields.join(",")], remainingGhTimeout(deadlineMs), signal);
        notes.push("Some GitHub fields were unavailable from this gh version; retried with the core field set.");
        linkedReferencesUnavailable = true;
    }
    if (!result.ok)
        return null;
    try {
        const parsed = JSON.parse(result.stdout);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return null;
        const view = parsed;
        if (linkedReferencesUnavailable)
            view.linkedReferencesUnavailable = true;
        return { view, notes };
    }
    catch {
        return null;
    }
}
async function ghReviewThreads(info, deadlineMs, signal) {
    if (info.kind !== "pull")
        return { comments: [] };
    const comments = [];
    let bounded = false;
    let pageFailed = false;
    for (let page = 1; page <= 3; page++) {
        const result = await runGh(["api", `repos/${info.owner}/${info.repo}/pulls/${info.number}/comments?per_page=100&page=${page}`], remainingGhTimeout(deadlineMs), signal);
        if (!result.ok) {
            pageFailed = true;
            break;
        }
        let pageItems;
        try {
            pageItems = JSON.parse(result.stdout);
        }
        catch {
            pageFailed = true;
            break;
        }
        if (!Array.isArray(pageItems) || pageItems.length === 0)
            break;
        comments.push(...pageItems.filter((item) => !!item && typeof item === "object" && !Array.isArray(item)));
        if (pageItems.length < 100)
            break;
        if (page === 3)
            bounded = true;
    }
    const discussionId = anchorId(info.anchor, "discussion_r");
    if (discussionId && !hasCommentId(comments, discussionId)) {
        const result = await runGh(["api", `repos/${info.owner}/${info.repo}/pulls/comments/${discussionId}`], remainingGhTimeout(deadlineMs), signal);
        if (result.ok) {
            try {
                const comment = JSON.parse(result.stdout);
                if (comment && typeof comment === "object" && !Array.isArray(comment) && belongsToPull(comment, discussionId, info))
                    comments.push(comment);
                else
                    return { comments, bounded: bounded || (pageFailed && comments.length > 0), unavailable: pageFailed && comments.length === 0, anchorUnavailable: true };
            }
            catch {
                return { comments, bounded: bounded || (pageFailed && comments.length > 0), unavailable: pageFailed && comments.length === 0, note: "Anchored review thread comment unavailable from gh." };
            }
        }
        else {
            return { comments, bounded: bounded || (pageFailed && comments.length > 0), unavailable: pageFailed && comments.length === 0, anchorUnavailable: true };
        }
    }
    return { comments, bounded: bounded || (pageFailed && comments.length > 0), unavailable: pageFailed && comments.length === 0 };
}
function isRateLimited(response) {
    return response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
}
function anchorId(anchor, prefix) {
    const match = anchor?.match(prefix === "issuecomment" ? /^issuecomment-(\d+)$/i : /^discussion_r(\d+)$/i);
    return match?.[1] ?? null;
}
function hasCommentId(comments, id) {
    return comments.some(comment => commentId(comment) === id);
}
function belongsToIssue(comment, id, info) {
    return commentId(comment) === id && associationMatches(comment.issue_url, info, "issues");
}
function belongsToPull(comment, id, info) {
    return commentId(comment) === id && associationMatches(comment.pull_request_url, info, "pulls");
}
function associationMatches(value, info, route) {
    if (typeof value !== "string")
        return false;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "api.github.com")
            return false;
        return parsed.pathname.toLowerCase() === `/repos/${info.owner}/${info.repo}/${route}/${info.number}`.toLowerCase();
    }
    catch {
        return false;
    }
}
function rateLimitResult(url, info, response) {
    const reset = response.headers.get("x-ratelimit-reset");
    const resetNote = reset ? ` Rate limit resets at Unix time ${reset}.` : "";
    return {
        url,
        title: `${info.owner}/${info.repo}#${info.number}`,
        content: `GitHub API rate limit reached for ${info.owner}/${info.repo} ${info.kind} #${info.number}.${resetNote}\n\nAuthenticate the gh CLI and retry:\n\n\`gh auth login\`\n\nThen fetch this URL again.`,
        error: "GitHub API rate limit reached; authenticate gh to fetch this PR or issue.",
        status: response.status,
    };
}
async function restJson(url, options, signal) {
    const ssrf = loadSsrfConfig();
    const domainPolicy = loadFetchContentDomainPolicy();
    const response = await fetchRemoteUrl(url, { headers: REST_HEADERS, ...(signal ? { signal } : {}) }, {
        allowRanges: ssrf.allowRanges,
        trustEnvProxy: ssrf.trustEnvProxy,
        domainPolicy,
        ...(options?.lookup ? { lookup: options.lookup } : {}),
    });
    if (!response.ok)
        return { value: null, response };
    return { value: await response.json(), response };
}
async function restFallback(url, info, options, signal) {
    try {
        const base = `https://api.github.com/repos/${info.owner}/${info.repo}`;
        const mainPath = info.kind === "pull" ? `${base}/pulls/${info.number}` : `${base}/issues/${info.number}`;
        const main = await restJson(mainPath, options, signal);
        if (!main)
            return null;
        if (isRateLimited(main.response))
            return rateLimitResult(url, info, main.response);
        if (!main.response.ok)
            return null;
        const view = mapRestView(info, main.value);
        view.linkedReferencesUnavailable = true;
        const comments = await restJson(`${base}/issues/${info.number}/comments?per_page=50`, options, signal);
        if (comments && isRateLimited(comments.response))
            return rateLimitResult(url, info, comments.response);
        const conversationComments = comments?.response.ok && Array.isArray(comments.value)
            ? comments.value.filter((item) => !!item && typeof item === "object" && !Array.isArray(item))
            : [];
        const issueCommentId = anchorId(info.anchor, "issuecomment");
        if (issueCommentId && !hasCommentId(conversationComments, issueCommentId)) {
            const anchoredComment = await restJson(`${base}/issues/comments/${issueCommentId}`, options, signal);
            if (anchoredComment && isRateLimited(anchoredComment.response))
                return rateLimitResult(url, info, anchoredComment.response);
            if (anchoredComment?.response.ok && anchoredComment.value && typeof anchoredComment.value === "object" && !Array.isArray(anchoredComment.value)) {
                const comment = anchoredComment.value;
                if (belongsToIssue(comment, issueCommentId, info))
                    conversationComments.push(comment);
                else
                    view.anchorUnavailable = true;
            }
            else {
                view.anchorUnavailable = true;
            }
        }
        view.comments = conversationComments;
        const reviewThreads = [];
        const notes = [info.kind === "pull" ? "Checks unavailable in REST fallback; install or authenticate gh for check status." : "REST fallback used; gh fields unavailable."];
        if (info.kind === "pull") {
            view.reviewsUnavailable = true;
            view.commitsUnavailable = true;
            const files = await restJson(`${base}/pulls/${info.number}/files?per_page=50`, options, signal);
            if (files && isRateLimited(files.response))
                return rateLimitResult(url, info, files.response);
            if (files?.response.ok && Array.isArray(files.value))
                view.files = files.value;
            const threads = await restJson(`${base}/pulls/${info.number}/comments?per_page=50`, options, signal);
            if (threads && isRateLimited(threads.response))
                return rateLimitResult(url, info, threads.response);
            if (threads?.response.ok && Array.isArray(threads.value)) {
                reviewThreads.push(...threads.value.filter((item) => !!item && typeof item === "object" && !Array.isArray(item)));
            }
            const discussionId = anchorId(info.anchor, "discussion_r");
            if (discussionId && !hasCommentId(reviewThreads, discussionId)) {
                const anchoredThread = await restJson(`${base}/pulls/comments/${discussionId}`, options, signal);
                if (anchoredThread && isRateLimited(anchoredThread.response))
                    return rateLimitResult(url, info, anchoredThread.response);
                if (anchoredThread?.response.ok && anchoredThread.value && typeof anchoredThread.value === "object" && !Array.isArray(anchoredThread.value)) {
                    const comment = anchoredThread.value;
                    if (belongsToPull(comment, discussionId, info))
                        reviewThreads.push(comment);
                    else
                        view.anchorUnavailable = true;
                }
                else {
                    view.anchorUnavailable = true;
                }
            }
        }
        return { data: { url, owner: info.owner, repo: info.repo, kind: info.kind, number: info.number, anchor: info.anchor, view, reviewThreads, fallbackNotes: notes } };
    }
    catch (err) {
        if (signal?.aborted || isAbortError(err))
            return { url, title: "", content: "", error: "Aborted" };
        const message = errorMessage(err);
        return { url, title: `${info.owner}/${info.repo}#${info.number}`, content: message, error: `GitHub REST fallback failed: ${message}` };
    }
}
function mapRestView(info, value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const user = source.user && typeof source.user === "object" ? source.user : undefined;
    const base = source.base && typeof source.base === "object" ? source.base : undefined;
    const head = source.head && typeof source.head === "object" ? source.head : undefined;
    return {
        title: stringValue(source.title),
        number: numberValue(source.number) ?? info.number,
        state: stringValue(source.state),
        stateReason: stringValue(source.state_reason),
        isDraft: Boolean(source.draft),
        author: { login: user ? stringValue(user.login) : "" },
        baseRefName: base ? stringValue(base.ref) : "",
        headRefName: head ? stringValue(head.ref) : "",
        headRepositoryOwner: { login: head && typeof head.repo === "object" && head.repo && typeof head.repo.owner === "object" ? stringValue(head.repo.owner.login) : "" },
        createdAt: stringValue(source.created_at),
        mergedAt: stringValue(source.merged_at),
        closedAt: stringValue(source.closed_at),
        labels: source.labels,
        assignees: source.assignees,
        milestone: source.milestone,
        additions: source.additions,
        deletions: source.deletions,
        changedFiles: source.changed_files,
        body: stringValue(source.body),
        url: stringValue(source.html_url),
        commentsCount: source.comments,
        reviewCommentsCount: source.review_comments,
    };
}
function stringValue(value) {
    return typeof value === "string" ? value : "";
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function authorLogin(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return "unknown";
    const login = value.login;
    return typeof login === "string" && login ? login : "unknown";
}
function listNames(value) {
    if (!Array.isArray(value) || value.length === 0)
        return "none";
    const names = value.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
            return "";
        const record = item;
        return stringValue(record.name) || stringValue(record.login) || stringValue(record.title);
    }).filter(Boolean);
    return names.length > 0 ? names.join(", ") : "none";
}
function milestoneTitle(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return "none";
    return stringValue(value.title) || "none";
}
function truncateText(text, limit, label, appendix) {
    if (text.length <= limit)
        return text;
    appendix.push(`## Full ${label}\n\n${text}`);
    return `${text.slice(0, limit)}\n\n[${label} truncated; use get_search_content findText or offset for the full text]`;
}
function appendLimitedSection(lines, title, items, max, marker) {
    lines.push(`## ${title}`);
    if (items.length === 0) {
        lines.push("none", "");
        return;
    }
    lines.push(...items.slice(0, max));
    if (items.length > max)
        lines.push(`[${max} of ${items.length} ${marker} shown; use get_search_content offset or the gh command below for more]`);
    lines.push("");
}
function objectArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => !!item && typeof item === "object" && !Array.isArray(item));
}
function commentId(comment) {
    return String(comment.id ?? comment.databaseId ?? "");
}
function anchorMatches(anchor, comment) {
    if (!anchor)
        return false;
    const id = commentId(comment);
    return anchor === `issuecomment-${id}` || anchor === `discussion_r${id}`;
}
function renderComments(comments, anchor, appendix) {
    const forced = anchor ? comments.find(comment => anchorMatches(anchor, comment)) : undefined;
    const selected = comments.slice(0, MAX_INLINE_COMMENTS);
    if (forced && !selected.includes(forced))
        selected.push(forced);
    const lines = selected.map((comment) => {
        const body = stringValue(comment.body);
        const label = `comment ${commentId(comment) || selected.indexOf(comment) + 1}`;
        return `- ${authorLogin(comment.author ?? comment.user)} at ${stringValue(comment.createdAt) || stringValue(comment.created_at)}${forced === comment ? " [anchored]" : ""}:\n  ${truncateText(body, COMMENT_INLINE_CHARS, label, appendix).replace(/\n/g, "\n  ")}`;
    });
    return lines;
}
function renderCommentMarker(comments, renderedCount, total) {
    const knownTotal = numberValue(total);
    if (knownTotal !== null && knownTotal > comments.length) {
        return `[${renderedCount} comments shown from at least ${knownTotal}; use get_search_content findText or offset, or gh issue view -c]`;
    }
    if (comments.length > renderedCount)
        return `[${renderedCount} of ${comments.length} comments shown; use get_search_content findText or offset, or gh issue view -c]`;
    return null;
}
function commentCountText(view) {
    const comments = objectArray(view.comments).length;
    const total = numberValue(view.commentsCount);
    if (total !== null && total > comments)
        return `at least ${total}`;
    return String(comments || total || 0);
}
function reviewThreadCountText(comments, total, bounded, unavailable) {
    if (unavailable)
        return "unavailable";
    const knownTotal = numberValue(total);
    if (bounded)
        return `at least ${comments.length}`;
    if (knownTotal !== null && knownTotal > comments.length)
        return `at least ${knownTotal}`;
    return String(comments.length || knownTotal || 0);
}
function renderChecks(value) {
    const checks = objectArray(value);
    if (checks.length === 0)
        return ["No check rollup data available."];
    const rows = checks.map((check) => {
        const name = stringValue(check.name) || stringValue(check.context) || stringValue(check.workflowName) || "check";
        const state = stringValue(check.conclusion) || stringValue(check.status) || stringValue(check.state) || "unknown";
        return `- ${name}: ${state}`;
    });
    const failing = rows.filter(row => !/(success|neutral|skipped|completed)$/i.test(row));
    return [`Rollup: ${failing.length === 0 ? "no failing checks in shown data" : `${failing.length} non-passing checks in shown data`}`, ...rows.slice(0, MAX_INLINE_CHECKS), ...(rows.length > MAX_INLINE_CHECKS ? [`[${MAX_INLINE_CHECKS} of ${rows.length} checks shown]`] : [])];
}
function renderReviewVerdicts(value, appendix) {
    const latest = new Map();
    for (const review of objectArray(value))
        latest.set(authorLogin(review.author ?? review.user), review);
    return [...latest.entries()].map(([author, review]) => {
        const state = stringValue(review.state) || "COMMENTED";
        const body = truncateText(stringValue(review.body), 300, `review by ${author}`, appendix);
        return `- ${author}: ${state}${body ? ` — ${body.replace(/\n/g, " ")}` : ""}`;
    });
}
function renderReviewVerdictsOrUnavailable(view, appendix) {
    const rendered = renderReviewVerdicts(view.reviews, appendix);
    if (rendered.length > 0)
        return rendered;
    return view.reviewsUnavailable === true ? ["Unavailable in this GitHub fetch path; use gh for review verdicts."] : [];
}
function renderFiles(value) {
    return objectArray(value).map((file) => {
        const path = stringValue(file.path) || stringValue(file.filename) || "file";
        const additions = numberValue(file.additions) ?? 0;
        const deletions = numberValue(file.deletions) ?? 0;
        return `- ${path} (+${additions}/−${deletions})`;
    });
}
function appendFilesSection(lines, view) {
    lines.push("## Files");
    const files = renderFiles(view.files);
    if (files.length === 0) {
        const total = numberValue(view.changedFiles);
        if (total !== null && total > 0) {
            lines.push(`[0 files shown from at least ${total}; use get_search_content offset or the gh command below for more]`, "");
            return;
        }
        lines.push("none", "");
        return;
    }
    lines.push(...files.slice(0, MAX_INLINE_FILES));
    const total = numberValue(view.changedFiles);
    if (total !== null && total > files.length) {
        lines.push(`[${Math.min(files.length, MAX_INLINE_FILES)} files shown from at least ${total}; use get_search_content offset or the gh command below for more]`);
    }
    else if (files.length > MAX_INLINE_FILES) {
        lines.push(`[${MAX_INLINE_FILES} of ${files.length} files shown; use get_search_content offset or the gh command below for more]`);
    }
    lines.push("");
}
function renderCommits(value) {
    return objectArray(value).map((commit) => {
        const oid = stringValue(commit.oid) || stringValue(commit.sha);
        const message = stringValue(commit.messageHeadline) || (commit.commit && typeof commit.commit === "object" ? stringValue(commit.commit.message).split("\n")[0] : "");
        return `- ${oid.slice(0, 7)} ${message}`.trim();
    });
}
function renderCommitsOrUnavailable(view) {
    const rendered = renderCommits(view.commits);
    if (rendered.length > 0)
        return rendered;
    return view.commitsUnavailable === true ? ["Unavailable in this GitHub fetch path; use gh for commits."] : [];
}
function renderLinked(value, kind) {
    return objectArray(value).map((item) => `- #${numberValue(item.number) ?? "?"} ${stringValue(item.title)}${kind === "closedBy" ? ` (${stringValue(item.url)})` : ""}`);
}
function renderLinkedOrUnavailable(view, field, kind) {
    const linked = renderLinked(view[field], kind);
    if (linked.length > 0)
        return linked;
    return view.linkedReferencesUnavailable === true ? ["Unavailable in this GitHub fetch path; use gh for linked references."] : [];
}
function renderReviewThreads(comments, anchor, appendix, total, bounded, unavailable) {
    if (unavailable)
        return ["Unavailable in this GitHub fetch path; use gh for review thread comments."];
    const forced = anchor ? comments.find(comment => anchorMatches(anchor, comment)) : undefined;
    const selected = comments.slice(0, MAX_INLINE_REVIEW_THREADS);
    if (forced && !selected.includes(forced))
        selected.push(forced);
    const lines = selected.map((comment) => {
        const path = stringValue(comment.path) || "unknown path";
        const line = numberValue(comment.line) ?? numberValue(comment.original_line) ?? numberValue(comment.position) ?? "?";
        const body = truncateText(stringValue(comment.body), COMMENT_INLINE_CHARS, `review thread comment ${commentId(comment) || selected.indexOf(comment) + 1}`, appendix);
        return `- ${path}:${line} — ${authorLogin(comment.user ?? comment.author)}${forced === comment ? " [anchored]" : ""} (resolution state unknown):\n  ${body.replace(/\n/g, "\n  ")}`;
    });
    const knownTotal = numberValue(total);
    if (bounded) {
        lines.push(`[${selected.length} review thread comments shown from at least ${comments.length}; use get_search_content offset, or gh api repos/<owner>/<repo>/pulls/<number>/comments]`);
    }
    else if (knownTotal !== null && knownTotal > comments.length) {
        lines.push(`[${selected.length} review thread comments shown from at least ${knownTotal}; use get_search_content offset, or gh api repos/<owner>/<repo>/pulls/<number>/comments]`);
    }
    else if (comments.length > selected.length) {
        lines.push(`[${selected.length} of ${comments.length} review thread comments shown; use get_search_content offset, or gh api repos/<owner>/<repo>/pulls/<number>/comments]`);
    }
    return lines;
}
export function renderGitHubPrIssue(data) {
    const { view } = data;
    const appendix = [];
    const title = stringValue(view.title) || `${data.owner}/${data.repo}#${data.number}`;
    const number = numberValue(view.number) ?? data.number;
    const stateParts = [stringValue(view.state) || "unknown"];
    if (view.isDraft === true)
        stateParts.push("draft");
    const lines = [`#${number} ${title}`, ""];
    lines.push(`- type: ${data.kind}`);
    lines.push(`- state: ${stateParts.join(" ")}${stringValue(view.stateReason) ? ` (${stringValue(view.stateReason)})` : ""}`);
    lines.push(`- author: ${authorLogin(view.author)}`);
    if (data.kind === "pull") {
        const headOwner = authorLogin(view.headRepositoryOwner);
        const headRef = stringValue(view.headRefName);
        const head = headOwner !== "unknown" && headOwner !== data.owner ? `${headOwner}:${headRef}` : headRef;
        lines.push(`- branch: ${stringValue(view.baseRefName)} ← ${head}`);
        const commitSummary = view.commitsUnavailable === true ? "commits unavailable" : `${objectArray(view.commits).length} commits`;
        lines.push(`- changes: +${numberValue(view.additions) ?? 0} −${numberValue(view.deletions) ?? 0}, ${numberValue(view.changedFiles) ?? objectArray(view.files).length} files, ${commitSummary}`);
    }
    else {
        lines.push(`- assignees: ${listNames(view.assignees)}`);
    }
    lines.push(`- created: ${stringValue(view.createdAt) || "unknown"}`);
    if (stringValue(view.mergedAt))
        lines.push(`- merged: ${stringValue(view.mergedAt)}`);
    if (stringValue(view.closedAt))
        lines.push(`- closed: ${stringValue(view.closedAt)}`);
    lines.push(`- labels: ${listNames(view.labels)}`);
    lines.push(`- milestone: ${milestoneTitle(view.milestone)}`);
    lines.push(`- comments: ${commentCountText(view)}; review threads: ${reviewThreadCountText(data.reviewThreads, view.reviewCommentsCount, data.reviewThreadsBounded, data.reviewThreadsUnavailable)}`);
    if (data.anchor)
        lines.push(`- requested anchor: #${data.anchor}`);
    lines.push("");
    lines.push("## Body");
    lines.push(truncateText(stringValue(view.body) || "(empty)", BODY_INLINE_CHARS, "body", appendix), "");
    if (data.kind === "pull") {
        lines.push("## Checks");
        lines.push(...renderChecks(view.statusCheckRollup), "");
        appendLimitedSection(lines, "Review verdicts", renderReviewVerdictsOrUnavailable(view, appendix), MAX_INLINE_REVIEWS, "review verdicts");
        appendLimitedSection(lines, "Linked references", renderLinkedOrUnavailable(view, "closingIssuesReferences", "closing"), 20, "linked references");
        appendFilesSection(lines, view);
        appendLimitedSection(lines, "Commits", renderCommitsOrUnavailable(view), MAX_INLINE_COMMITS, "commits");
    }
    else {
        appendLimitedSection(lines, "Closed by pull requests", renderLinkedOrUnavailable(view, "closedByPullRequestsReferences", "closedBy"), 20, "pull requests");
    }
    lines.push("## Conversation comments");
    const commentLines = renderComments(objectArray(view.comments), data.anchor, appendix);
    const commentMarker = renderCommentMarker(objectArray(view.comments), commentLines.length, view.commentsCount);
    if (commentMarker)
        commentLines.push(commentMarker);
    if (view.anchorUnavailable === true && data.anchor?.startsWith("issuecomment-"))
        commentLines.push("[anchored comment unavailable for this issue or pull request]");
    lines.push(...(commentLines.length > 0 ? commentLines : ["none"]), "");
    if (data.kind === "pull") {
        lines.push("## Review thread comments");
        const threadLines = renderReviewThreads(data.reviewThreads, data.anchor, appendix, view.reviewCommentsCount, data.reviewThreadsBounded, data.reviewThreadsUnavailable);
        if (view.anchorUnavailable === true && data.anchor?.startsWith("discussion_r"))
            threadLines.push("[anchored review thread comment unavailable for this pull request]");
        lines.push(...(threadLines.length > 0 ? threadLines : ["none"]), "");
    }
    if (data.fallbackNotes.length > 0) {
        lines.push("## Availability notes", ...data.fallbackNotes.map(note => `- ${note}`), "");
    }
    if (appendix.length > 0)
        lines.push("## Appendix", ...appendix, "");
    const viewCommand = data.kind === "pull" ? `gh pr view ${data.number} --repo ${data.owner}/${data.repo}` : `gh issue view ${data.number} --repo ${data.owner}/${data.repo} -c`;
    lines.push("## Escalation commands");
    lines.push(`- Full view: \`${viewCommand}\``);
    if (data.kind === "pull")
        lines.push(`- Complete diff: \`gh pr diff ${data.number} --repo ${data.owner}/${data.repo}\``);
    lines.push("- Stored full document: use `get_search_content` with `offset` or `findText`.");
    const content = lines.join("\n");
    return {
        url: data.url,
        title: `${data.owner}/${data.repo} ${data.kind} #${data.number}: ${title}`,
        content: content.length > MAX_DOC_CHARS ? `${content.slice(0, MAX_DOC_CHARS)}\n\n[GitHub document truncated at ${MAX_DOC_CHARS} chars; use the gh escalation commands for complete data]` : content,
        error: null,
    };
}
export async function extractGitHubIssuePr(url, signal, options) {
    const info = parseGitHubIssuePrUrl(url);
    if (!info)
        return null;
    if (!loadConfig().enabled)
        return null;
    if (signal?.aborted)
        return { url, title: "", content: "", error: "Aborted" };
    const ghAvailable = await checkGhAvailable(signal);
    if (signal?.aborted)
        return { url, title: "", content: "", error: "Aborted" };
    if (ghAvailable) {
        const ghDeadlineMs = Date.now() + GH_TOTAL_TIMEOUT_MS;
        const viewed = await ghView(info, ghDeadlineMs, signal);
        if (signal?.aborted)
            return { url, title: "", content: "", error: "Aborted" };
        if (viewed) {
            const threads = await ghReviewThreads(info, ghDeadlineMs, signal);
            if (signal?.aborted)
                return { url, title: "", content: "", error: "Aborted" };
            if (threads.anchorUnavailable)
                viewed.view.anchorUnavailable = true;
            const notes = [...viewed.notes, ...(threads.note ? [threads.note] : [])];
            return renderGitHubPrIssue({ url, owner: info.owner, repo: info.repo, kind: info.kind, number: info.number, anchor: info.anchor, view: viewed.view, reviewThreads: threads.comments, reviewThreadsBounded: threads.bounded, reviewThreadsUnavailable: threads.unavailable, fallbackNotes: notes });
        }
    }
    else {
        showGhHint();
    }
    const fallback = await restFallback(url, info, options, signal);
    if (!fallback)
        return null;
    if ("data" in fallback)
        return renderGitHubPrIssue(fallback.data);
    return fallback;
}

export function formatSearchResultsAsAnswer(results) {
    return results.map((result) => result.snippet
        ? `${result.snippet}\nSource: ${result.title} (${result.url})`
        : `Source: ${result.title} (${result.url})`).join("\n\n");
}

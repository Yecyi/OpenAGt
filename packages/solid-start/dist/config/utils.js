export function parseIdQuery(id) {
    if (!id.includes("?"))
        return { filename: id, query: new URLSearchParams() };
    const [filename, rawQuery] = id.split(`?`, 2);
    return { filename, query: new URLSearchParams(rawQuery) };
}

export const katexOptions = {
  macros: {
    "\\lVert": String.raw`\mathopen{\vert\!\vert}`,
    "\\rVert": String.raw`\mathclose{\vert\!\vert}`,
  },
};

function normalizeInlineMath(line: string) {
  let result = "";
  let codeDelimiterLength = 0;

  for (let index = 0; index < line.length; ) {
    if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end += 1;
      const length = end - index;
      if (codeDelimiterLength === 0) codeDelimiterLength = length;
      else if (codeDelimiterLength === length) codeDelimiterLength = 0;
      result += line.slice(index, end);
      index = end;
      continue;
    }

    if (codeDelimiterLength === 0 && line.startsWith("\\(", index)) {
      result += "$";
      index += 2;
      continue;
    }
    if (codeDelimiterLength === 0 && line.startsWith("\\)", index)) {
      result += "$";
      index += 2;
      continue;
    }

    result += line[index];
    index += 1;
  }

  return result;
}

export function normalizeMath(markdown: string) {
  let fence: "`" | "~" | null = null;
  const normalized = markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^[\t ]*(`{3,}|~{3,})/)?.[1];
      if (marker) {
        const kind = marker[0] as "`" | "~";
        if (fence === null) fence = kind;
        else if (fence === kind) fence = null;
        return line;
      }
      if (fence !== null) return line;
      if (/^[\t ]*\\\[[\t ]*$/.test(line) || /^[\t ]*\\\][\t ]*$/.test(line)) {
        return "$$";
      }
      return normalizeInlineMath(line);
    })
    .join("\n");

  return normalized.replace(
    /^[\t ]*\$\$([^\n]+?)\$\$[\t ]*$/gm,
    (_line, formula: string) => `$$\n${formula.trim()}\n$$`,
  );
}

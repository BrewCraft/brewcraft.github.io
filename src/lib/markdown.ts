export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "bold_italic"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; label: string; href: string };

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: "paragraph"; lines: InlineNode[][] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "blockquote"; lines: InlineNode[][] }
  | { type: "code"; lang?: string; content: string }
  | { type: "table"; headers: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "hr" };

const SAFE_URL_RE = /^(https?:\/\/|\/|#)/i;

export function isSafeMarkdownUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return SAFE_URL_RE.test(trimmed);
}

function unescapeNonCodeSegment(segment: string): string {
  return segment
    .replace(/(^|\n)([ \t]*)\\(#{1,6})(?=\s|$)/g, "$1$2$3")
    .replace(/\\(\*{1,3}|_{2})/g, "$1")
    .replace(/(^|\s)\\_([^_\n]+?)\\_(?=\s|$|[.,;:!?])/g, "$1_$2_")
    .replace(/(^|\n)([ \t]*)\\([-*+])(?=\s)/g, "$1$2$3")
    .replace(/(^|\n)([ \t]*)\\(\d+\.)(?=\s)/g, "$1$2$3")
    .replace(/(^|\n)([ \t]*\d+)\\\.(?=\s)/g, "$1$2.");
}

function normalizeInlineEscapes(line: string): string {
  const parts = line.split(/(`[^`\n]*`)/g);
  return parts
    .map((part, idx) => (idx % 2 === 1 ? part : unescapeNonCodeSegment(part)))
    .join("");
}

/**
 * Normalizes LLM outputs that accidentally escape Markdown tokens (e.g. `\###`, `\*\*`, `\-`)
 * while preserving fenced code blocks and inline code spans untouched.
 */
export function normalizeMarkdownEscapes(raw: string): string {
  if (!raw) return "";
  const normalizedNewlines = raw.replace(/\r\n?/g, "\n");
  const segments = normalizedNewlines.split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment, idx) => {
      if (idx % 2 === 1) return segment;
      return segment
        .split("\n")
        .map((line) => normalizeInlineEscapes(line))
        .join("\n");
    })
    .join("");
}

export function parseInlineMarkdown(input: string): InlineNode[] {
  const text = input;
  const nodes: InlineNode[] = [];
  let i = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const prev = nodes[nodes.length - 1];
    if (prev && prev.type === "text") {
      prev.text += value;
    } else {
      nodes.push({ type: "text", text: value });
    }
  };

  while (i < text.length) {
    // Inline code: `...`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        nodes.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Link: [label](url)
    if (text[i] === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket > i + 1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const label = text.slice(i + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen).trim();
          if (isSafeMarkdownUrl(href)) {
            nodes.push({ type: "link", label, href });
          } else {
            pushText(label);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold + Italic: ***...***
    if (text.startsWith("***", i)) {
      const end = text.indexOf("***", i + 3);
      if (end > i + 3) {
        nodes.push({ type: "bold_italic", children: parseInlineMarkdown(text.slice(i + 3, end)) });
        i = end + 3;
        continue;
      }
    }

    // Bold: **...** or __...__
    if (text.startsWith("**", i) || text.startsWith("__", i)) {
      const marker = text.slice(i, i + 2);
      const end = text.indexOf(marker, i + 2);
      if (end > i + 2 && text.slice(i + 2, end).trim().length > 0) {
        nodes.push({ type: "bold", children: parseInlineMarkdown(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Italic: *...*
    if (text[i] === "*" && text[i + 1] !== "*" && text[i + 1] !== " ") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1 && text[end - 1] !== " ") {
        nodes.push({ type: "italic", children: parseInlineMarkdown(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    // Italic: _..._ (avoid snake_case words)
    const prevChar = i > 0 ? text[i - 1] : " ";
    if (text[i] === "_" && text[i + 1] !== "_" && text[i + 1] !== " " && !/[a-zA-Z0-9]/.test(prevChar)) {
      const end = text.indexOf("_", i + 1);
      const afterChar = end >= 0 && end + 1 < text.length ? text[end + 1] : " ";
      if (end > i + 1 && text[end - 1] !== " " && !/[a-zA-Z0-9]/.test(afterChar)) {
        nodes.push({ type: "italic", children: parseInlineMarkdown(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    pushText(text[i]);
    i += 1;
  }

  return nodes;
}

const isTableSeparatorRow = (line: string) =>
  /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);

const splitTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
};

export function parseMarkdown(raw: string): MarkdownBlock[] {
  const normalized = normalizeMarkdownEscapes(raw);
  if (!normalized.trim()) return [];

  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    const fenceMatch = trimmed.match(/^```([\w+-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", lang, content: codeLines.join("\n") });
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: "heading",
        level,
        children: parseInlineMarkdown(headingMatch[2].trim()),
      });
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // Table
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      const headers = splitTableRow(trimmed).map(parseInlineMarkdown);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]).map(parseInlineMarkdown));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: InlineNode[][] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(parseInlineMarkdown(lines[i].replace(/^\s*>\s?/, "")));
        i += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(parseInlineMarkdown(lines[i].replace(/^\s*[-*+]\s+/, "")));
        i += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(parseInlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, "")));
        i += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // Paragraph (collect consecutive plain lines)
    const paraLines: InlineNode[][] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1]))
    ) {
      paraLines.push(parseInlineMarkdown(lines[i]));
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paraLines });
    }
  }

  return blocks;
}

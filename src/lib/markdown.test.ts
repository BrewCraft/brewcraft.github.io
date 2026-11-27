/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { isSafeMarkdownUrl, normalizeMarkdownEscapes, parseMarkdown } from "./markdown";

describe("markdown do chat IA", () => {
  test("normaliza marcadores escapados pelo modelo fora de blocos de código", () => {
    const input = "\\### Análise da sua Receita\n\n\\*\\*OG e ABV:\\*\\*\n\\- Item 1\n`\\*literal\\*`";
    const normalized = normalizeMarkdownEscapes(input);
    assert.ok(normalized.startsWith("### Análise da sua Receita"));
    assert.ok(normalized.includes("**OG e ABV:**"));
    assert.ok(normalized.includes("- Item 1"));
    assert.ok(normalized.includes("`\\*literal\\*`"));
  });

  test("preserva barras invertidas dentro de blocos de código cercados", () => {
    const input = "```ts\nconst x = '\\### não mexer';\n```";
    const normalized = normalizeMarkdownEscapes(input);
    assert.equal(normalized, input);
  });

  test("interpreta títulos, negrito, listas, tabelas e código", () => {
    const input = [
      "\\### Análise da sua Receita",
      "",
      "\\*\\*OG e ABV:\\*\\* dentro do estilo.",
      "",
      "- Malte Pale Ale: *base*",
      "- Lúpulo Cascade",
      "",
      "1. Mostura a 66 °C",
      "2. Fervura 60 min",
      "",
      "| Métrica | Valor |",
      "|---|---|",
      "| OG | 1.050 |",
    ].join("\n");

    const blocks = parseMarkdown(input);
    assert.equal(blocks[0].type, "heading");
    if (blocks[0].type === "heading") {
      assert.equal(blocks[0].level, 3);
      assert.deepEqual(blocks[0].children, [{ type: "text", text: "Análise da sua Receita" }]);
    }

    assert.equal(blocks[1].type, "paragraph");
    if (blocks[1].type === "paragraph") {
      assert.equal(blocks[1].lines[0][0].type, "bold");
    }

    assert.equal(blocks[2].type, "list");
    if (blocks[2].type === "list") {
      assert.equal(blocks[2].ordered, false);
      assert.equal(blocks[2].items.length, 2);
    }

    assert.equal(blocks[3].type, "list");
    if (blocks[3].type === "list") {
      assert.equal(blocks[3].ordered, true);
      assert.equal(blocks[3].items.length, 2);
    }

    assert.equal(blocks[4].type, "table");
    if (blocks[4].type === "table") {
      assert.equal(blocks[4].headers.length, 2);
      assert.equal(blocks[4].rows.length, 1);
    }
  });

  test("bloqueia URLs inseguras e mantém HTML bruto como texto seguro", () => {
    assert.equal(isSafeMarkdownUrl("https://bjcp.org"), true);
    assert.equal(isSafeMarkdownUrl("javascript:alert(1)"), false);
    assert.equal(isSafeMarkdownUrl("data:text/html,<script>alert(1)</script>"), false);

    const blocks = parseMarkdown('<script>alert(1)</script> [clique](javascript:alert(1)) [seguro](https://example.com)');
    assert.equal(blocks.length, 1);
    if (blocks[0].type === "paragraph") {
      const nodes = blocks[0].lines[0];
      assert.ok(nodes.some((n) => n.type === "text" && n.text.includes("<script>alert(1)</script>")));
      assert.ok(nodes.some((n) => n.type === "text" && n.text.includes("clique")));
      assert.ok(nodes.some((n) => n.type === "link" && n.href === "https://example.com"));
      assert.equal(nodes.some((n) => n.type === "link" && n.href.startsWith("javascript:")), false);
    }
  });
});

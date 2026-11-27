import React from "react";
import { parseMarkdown, type InlineNode } from "@/lib/markdown";

function renderInlines(nodes: InlineNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return <React.Fragment key={key}>{node.text}</React.Fragment>;
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {renderInlines(node.children, key)}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic">
            {renderInlines(node.children, key)}
          </em>
        );
      case "bold_italic":
        return (
          <strong key={key} className="font-semibold italic">
            {renderInlines(node.children, key)}
          </strong>
        );
      case "code":
        return (
          <code key={key} className="rounded bg-slate-100 dark:bg-slate-700/80 px-1.5 py-0.5 text-xs font-mono">
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:opacity-80"
          >
            {node.label}
          </a>
        );
    }
  });
}

export const MarkdownContent: React.FC<{ content: string; className?: string }> = ({ content, className = "" }) => {
  const blocks = parseMarkdown(content);

  if (blocks.length === 0) {
    return <p className={`text-sm whitespace-pre-wrap leading-relaxed ${className}`}>{content}</p>;
  }

  return (
    <div className={`text-sm leading-relaxed space-y-2.5 break-words ${className}`}>
      {blocks.map((block, index) => {
        const key = `md-${index}`;
        switch (block.type) {
          case "heading": {
            const headingClasses: Record<number, string> = {
              1: "text-base font-bold mt-2 first:mt-0",
              2: "text-base font-semibold mt-2 first:mt-0",
              3: "text-sm font-semibold mt-2 first:mt-0",
              4: "text-sm font-semibold mt-1.5 first:mt-0",
              5: "text-xs font-semibold uppercase tracking-wide mt-1.5 first:mt-0",
              6: "text-xs font-semibold uppercase tracking-wide mt-1.5 first:mt-0",
            };
            const Tag = (`h${Math.min(block.level, 6)}`) as keyof JSX.IntrinsicElements;
            return (
              <Tag key={key} className={headingClasses[block.level]}>
                {renderInlines(block.children, key)}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={key} className="leading-relaxed">
                {block.lines.map((line, lineIdx) => (
                  <React.Fragment key={`${key}-l-${lineIdx}`}>
                    {lineIdx > 0 && <br />}
                    {renderInlines(line, `${key}-l-${lineIdx}`)}
                  </React.Fragment>
                ))}
              </p>
            );
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag
                key={key}
                className={`${block.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}
              >
                {block.items.map((item, itemIdx) => (
                  <li key={`${key}-i-${itemIdx}`}>{renderInlines(item, `${key}-i-${itemIdx}`)}</li>
                ))}
              </ListTag>
            );
          }
          case "blockquote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-primary/50 pl-3 italic text-slate-600 dark:text-slate-300 space-y-1"
              >
                {block.lines.map((line, lineIdx) => (
                  <p key={`${key}-q-${lineIdx}`}>{renderInlines(line, `${key}-q-${lineIdx}`)}</p>
                ))}
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg bg-slate-900 text-slate-100 p-3 text-xs font-mono"
              >
                <code>{block.content}</code>
              </pre>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      {block.headers.map((header, hIdx) => (
                        <th key={`${key}-h-${hIdx}`} className="text-left font-semibold px-2.5 py-1.5 border-b border-border">
                          {renderInlines(header, `${key}-h-${hIdx}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rIdx) => (
                      <tr key={`${key}-r-${rIdx}`} className="border-t border-border/70">
                        {row.map((cell, cIdx) => (
                          <td key={`${key}-r-${rIdx}-c-${cIdx}`} className="px-2.5 py-1.5 align-top">
                            {renderInlines(cell, `${key}-r-${rIdx}-c-${cIdx}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={key} className="border-border my-2" />;
        }
      })}
    </div>
  );
};

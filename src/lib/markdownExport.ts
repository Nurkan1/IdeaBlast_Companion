import type { ChatMessage } from "../hooks/useChat";

export function conversationToMarkdown(
  title: string,
  model: string,
  messages: ChatMessage[]
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`*Model: ${model || "unknown"} — Exported ${new Date().toLocaleString()}*`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const m of messages) {
    const who = m.role === "user" ? "🧑 You" : m.role === "assistant" ? "🤖 Assistant" : "⚙️ System";
    lines.push(`## ${who}`);
    lines.push("");
    if (m.mcpTool?.statusMessage) {
      lines.push(`> ⚡ MCP: ${m.mcpTool.statusMessage}`);
      lines.push("");
    }
    lines.push(m.content || "");
    lines.push("");
  }
  return lines.join("\n");
}

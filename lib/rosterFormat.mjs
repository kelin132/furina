export function formatAidoruRoster(title, sections = []) {
  const lines = [
    "┏━〔 AIDORU 〕",
    `┣━〔 ${String(title || "LIST").trim().toUpperCase()} 〕`,
    "┃",
  ];

  for (const section of sections) {
    if (section.title) lines.push(`┃ ♢ ${String(section.title).trim().toUpperCase()}`);
    const rows = Array.isArray(section.rows) ? section.rows : [];
    if (rows.length) {
      for (const row of rows) lines.push(`┃ ◈ ${row}`);
    } else {
      lines.push("┃ ◈ None listed");
    }
    lines.push("┃");
  }

  lines.push("┗━━━━━━━━━━━━━━━━");
  return lines.join("\n");
}

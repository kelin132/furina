import { bankLimitForUser, formatRyu } from "./currency.js";

function money(value) {
  return formatRyu(value);
}

function number(value) {
  return Number(value ?? 0).toLocaleString();
}

function inline(value) {
  return `\`${value}\``;
}

export function formatFullMoney(value) {
  return formatRyu(value);
}

export function formatCompactMoney(value) {
  return formatRyu(value);
}

function row(icon, label, value) {
  return `${icon} ${label}: ${inline(value)}`;
}

export function formatAccountBalance({
  wallet = 0,
  bank = 0,
  crystals = 0,
  orbs,
  bankLimit,
  netWorth = Number(wallet ?? 0) + Number(bank ?? 0),
  extraRows = [],
  footerLines = [],
}) {
  const rows = [
    row("$", "Wallet", money(wallet)),
    row("🏦", "Bank", `${money(bank)} / ${money(bankLimit ?? bankLimitForUser({}))}`),
    row("💎", "Genesis Crystals", number(crystals)),
  ];

  if (orbs !== undefined) rows.push(row("🔮", "Orbs", number(orbs)));
  rows.push(row("🌌", "Net worth", money(netWorth)));

  if (extraRows.length) {
    rows.push("", ...extraRows);
  }

  if (footerLines.length) {
    rows.push("", ...footerLines.map((line) => `💡 ${line}`));
  }

  return [
    "💳 Account Balance",
    "",
    "🌸 Balance",
    ...rows,
  ].join("\n");
}

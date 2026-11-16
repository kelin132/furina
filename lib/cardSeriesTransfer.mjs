function normalizeSeries(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function selectSeriesCards(cards, query) {
  const availableCards = Array.isArray(cards) ? cards : [];
  const normalizedQuery = normalizeSeries(query);
  if (!normalizedQuery) return { status: "missing", series: null, eligible: [], blocked: [] };

  const seriesNames = [...new Set(
    availableCards
      .map((card) => String(card?.series || "").trim())
      .filter(Boolean),
  )];
  const exact = seriesNames.find((name) => normalizeSeries(name) === normalizedQuery);
  const matches = exact
    ? [exact]
    : seriesNames.filter((name) => normalizeSeries(name).includes(normalizedQuery));

  if (!matches.length) {
    return { status: "missing", series: null, eligible: [], blocked: [] };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", series: null, matches, eligible: [], blocked: [] };
  }

  const series = matches[0];
  const owned = availableCards.filter(
    (card) => normalizeSeries(card?.series) === normalizeSeries(series),
  );
  const eligible = owned.filter((card) => !card?.locked && !card?.inAuction);
  const blocked = owned.filter((card) => card?.locked || card?.inAuction);

  return { status: "ok", series, eligible, blocked };
}

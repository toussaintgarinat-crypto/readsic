// Comparaison de deux analyses (ex. mots-clés vs LLM) sur le même texte. Fonctions pures.
//   lexAt(i)/llmAt(i) -> { tension, valence, movement, place } ; llmAt peut renvoyer null (pas encore analysé).

export function pearson(a, b) {
  const n = a.length; if (n < 2) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db); // null = non défini (courbe constante)
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function compareAnalyses(n, lexAt, llmAt) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = lexAt(i), b = llmAt(i);
    if (!a || !b) continue;
    const lp = a.place ?? null, bp = b.place ?? null;
    const dT = b.tension - a.tension, dM = b.movement - a.movement;
    const valSame = a.valence === b.valence, placeSame = lp === bp;
    rows.push({ i, lex: { ...a, place: lp }, llm: { ...b, place: bp }, dT, dM, valSame, placeSame,
      gap: Math.abs(dT) + 0.5 * Math.abs(dM) + (valSame ? 0 : 0.5) + (placeSame ? 0 : 0.3) });
  }
  const T = (k) => rows.map((r) => r[k].tension);
  const summary = {
    n, covered: rows.length,
    tensionMAE: mean(rows.map((r) => Math.abs(r.dT))),
    tensionCorr: pearson(T('lex'), T('llm')),
    movementMAE: mean(rows.map((r) => Math.abs(r.dM))),
    valenceAgree: rows.length ? rows.filter((r) => r.valSame).length / rows.length : null,
    placeAgree: rows.length ? rows.filter((r) => r.placeSame).length / rows.length : null,
    lexNeutral: rows.length ? rows.filter((r) => r.lex.valence === 'neutre').length / rows.length : null,
    llmNeutral: rows.length ? rows.filter((r) => r.llm.valence === 'neutre').length / rows.length : null,
  };
  return { rows, summary };
}

// Jugements humains : prefs[i] ∈ 'lex' | 'llm' | 'tie'.
export function tally(prefs) {
  const t = { lex: 0, llm: 0, tie: 0, total: 0 };
  for (const v of Object.values(prefs)) if (v in t) { t[v]++; t.total++; }
  return t;
}

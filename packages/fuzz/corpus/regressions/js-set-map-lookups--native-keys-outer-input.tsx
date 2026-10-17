// rule: js-set-map-lookups
// weakness: iteration-provenance
// source: independently authored native key lifetime control

export const selectMatchingRows = (rows: Record<string, unknown>[]) =>
  rows.every((row) => ["primary", "secondary"].every((query) => Object.keys(row).includes(query)));

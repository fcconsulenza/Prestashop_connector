// GTIN checksum; keep leading zeroes. UPC-A is equivalent to an EAN-13 with a leading 0.
export function normalizeBarcode(value) {
  if (typeof value !== 'string') throw new Error('Inserisci il codice come testo.');
  const code = value.trim();
  if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(code)) throw new Error('Usa un codice EAN-8, UPC-A (12 cifre) o EAN-13.');
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(code[i]) * weight;
  if ((10 - sum % 10) % 10 !== Number(code.at(-1))) throw new Error('Il codice non supera il controllo: verifica tutte le cifre.');
  return code.length === 12 ? '0' + code : code;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, currency = 'BRL'): string {
  let f = currencyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency });
    currencyFormatters.set(currency, f);
  }
  return f.format(cents / 100);
}

/** Cents as "1234,56" for form inputs. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Parses Brazilian-style amounts: "150", "150,5", "1.234,56", "R$ 1.234", "1234.56".
 * Returns cents, or null when the input is not a positive amount.
 */
export function parseMoney(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  let s = input.replace(/R\$|\s/gi, '');
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 && cents < 1e12 ? cents : null;
}

export function formatPhone(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

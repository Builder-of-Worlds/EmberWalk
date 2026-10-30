const PLAIN = /^\+?[\d\s().-]+$/;

export const phoneE164 = (raw: string): string | null => {
  const text = raw.trim();
  if (!PLAIN.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  if (text.startsWith("+") && national === digits) return null;
  return `+1${national}`;
};

export const normalize = (s) => String(s ?? '').trim().toLowerCase();
export const isCorrect = (a, b) => normalize(a) === normalize(b);

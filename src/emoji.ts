// Auto emoji for captions: Indonesian (and gamer) words → one fitting emoji. Plain dictionary, works offline.
import type { CaptionLine } from './render';

const GROUPS: [string, string[]][] = [
  ['😂', ['wkwk', 'wkwkwk', 'wkwkwkwk', 'haha', 'hahaha', 'ngakak', 'lucu', 'kocak', 'anjay', 'anjir', 'anjrit', 'lol', 'lmao', 'ketawa', 'ngekek']],
  ['🏆', ['menang', 'juara', 'win', 'winner', 'victory', 'champion', 'chicken', 'maniac', 'savage']],
  ['💀', ['mati', 'kalah', 'lose', 'dead', 'wasted', 'tewas', 'modar', 'koid', 'game over']],
  ['🔥', ['api', 'panas', 'gas', 'gaskeun', 'gass', 'fire', 'hot', 'membara', 'pedas', 'pedes']],
  ['😱', ['takut', 'serem', 'seram', 'horor', 'hantu', 'setan', 'jumpscare', 'merinding', 'ngeri']],
  ['😳', ['kaget', 'wow', 'hah', 'loh', 'lho', 'astaga', 'buset', 'busett', 'gila', 'gokil', 'parah']],
  ['😭', ['sedih', 'nangis', 'menangis', 'kasihan', 'kasian', 'galau', 'patah']],
  ['😡', ['marah', 'kesel', 'kesal', 'emosi', 'ngamuk', 'sebel', 'bete']],
  ['😎', ['mantap', 'mantep', 'keren', 'gg', 'ez', 'easy', 'santai', 'pro', 'jago', 'sultan']],
  ['🤔', ['bingung', 'mikir', 'kenapa', 'gimana', 'kok', 'hmm', 'hmmm', 'masa', 'serius']],
  ['❤️', ['cinta', 'sayang', 'love', 'suka', 'pacar', 'ayang', 'kangen']],
  ['💰', ['uang', 'duit', 'cuan', 'kaya', 'mahal', 'gaji', 'saweran', 'donasi', 'donate', 'saweria']],
  ['🍜', ['makan', 'lapar', 'laper', 'mie', 'nasi', 'bakso', 'enak', 'kenyang']],
  ['😴', ['tidur', 'ngantuk', 'capek', 'cape', 'lelah', 'begadang']],
  ['🎮', ['game', 'main', 'mabar', 'push', 'rank', 'ranked', 'level', 'stage', 'gameplay']],
  ['👑', ['bos', 'boss', 'raja', 'king', 'queen', 'ratu']],
  ['💥', ['bom', 'meledak', 'ledakan', 'boom', 'tembak', 'headshot', 'hs', 'kill']],
  ['⚡', ['cepat', 'cepet', 'ngebut', 'kilat', 'speed', 'buru']],
  ['👋', ['halo', 'hai', 'hallo', 'hello', 'assalamualaikum', 'dadah', 'bye']],
  ['🙏', ['makasih', 'terima', 'thanks', 'thank', 'tolong', 'mohon', 'maaf', 'sorry']],
  ['👍', ['oke', 'ok', 'okey', 'sip', 'siap', 'bagus', 'mantul', 'setuju', 'betul', 'bener']],
  ['🤡', ['bodoh', 'bego', 'goblok', 'noob', 'nub', 'cupu', 'badut', 'blunder']],
  ['🥶', ['dingin', 'beku', 'freeze', 'merinding']],
  ['🎉', ['selamat', 'ulang', 'pesta', 'rayakan', 'yey', 'yeay', 'hore', 'horee']],
  ['🤯', ['plot', 'twist', 'kepala', 'pusing', 'mindblown']],
  ['👀', ['lihat', 'liat', 'intip', 'awas', 'perhatikan']],
  ['🚗', ['mobil', 'motor', 'nyetir', 'balapan', 'balap']],
  ['🧠', ['pintar', 'pinter', 'otak', 'strategi', 'taktik']],
];
const DICT = new Map<string, string>();
for (const [e, words] of GROUPS) for (const w of words) if (!DICT.has(w)) DICT.set(w, e);

/** The emoji for a word, or '' (case and punctuation ignored, "wkwkwkwk" and "gasss" still match). */
export function emojiFor(word: string): string {
  const w = word.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
  if (!w) return '';
  if (DICT.has(w)) return DICT.get(w)!;
  if (/^(wk)+w?$/.test(w) || /^(ha){2,}h?$/.test(w)) return '😂';
  const squeezed = w.replace(/(.)\1+/g, '$1');   // "gasss" → "gas", "anjirrr" → "anjir"
  return DICT.get(squeezed) ?? '';
}

/**
 * Puts at most `perLine` emojis on each line, on the words that carry one, spreading them out
 * (no two in a row). Returns how many were added. Words keep their text; the emoji sits after it.
 */
export function autoEmoji(lines: CaptionLine[], perLine = 1): number {
  let n = 0;
  for (const l of lines) {
    let added = l.words.filter((w) => w.emoji).length;
    let last = -2;
    l.words.forEach((w, i) => {
      if (added >= perLine || w.emoji || i - last < 2) return;
      const e = emojiFor(w.text);
      if (!e) return;
      w.emoji = e; added++; n++; last = i;
    });
  }
  return n;
}
export function clearEmoji(lines: CaptionLine[]): number {
  let n = 0;
  for (const l of lines) for (const w of l.words) if (w.emoji) { delete w.emoji; n++; }
  return n;
}

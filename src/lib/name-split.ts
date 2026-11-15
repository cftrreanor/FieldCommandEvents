// Where a name typed in one box splits into first and last (visitor registration). The database splits older and
// imported names with the same rules (split_person_name in 20270206000000_visitor_adults.sql): a particle after the
// first word starts the last name ("Luis Von Berg": Luis / Von Berg), otherwise the last word is the last name. A
// Host checks the names that could be wrong, choosing from the likely splits this offers, the app's guess first.

/** Words that start a last name when they come after the first word: "de la Cruz", "Von Berg", "St. John". */
export const NAME_PARTICLES = ["van", "von", "der", "den", "de", "del", "della", "le", "la", "du", "da", "di", "dos", "das", "ter", "ten", "st.", "st", "saint"];

export type NameSplit = { first: string; last: string };

const words = (typed: string) => typed.trim().split(/\s+/).filter(Boolean);

/** The app's guess, as the database makes it. */
export function guessSplit(typed: string): NameSplit {
  const w = words(typed);
  if (w.length < 2) return { first: w[0] ?? "", last: "" };
  let cut = w.length - 1;
  for (let i = 1; i < w.length - 1; i++) {
    if (NAME_PARTICLES.includes(w[i].toLowerCase())) {
      cut = i;
      break;
    }
  }
  return { first: w.slice(0, cut).join(" "), last: w.slice(cut).join(" ") };
}

/**
 * The likely splits of a typed name, the app's guess first, then the others from the shortest first name. Every
 * split for names up to five words (at most four choices); for longer ones, the guess, after the first word, and
 * before the last word.
 */
export function likelySplits(typed: string): NameSplit[] {
  const w = words(typed);
  if (w.length < 2) return [];
  const guess = guessSplit(typed);
  const at = (cut: number): NameSplit => ({ first: w.slice(0, cut).join(" "), last: w.slice(cut).join(" ") });
  const cuts = w.length <= 5 ? Array.from({ length: w.length - 1 }, (_, i) => i + 1) : [1, w.length - 1];
  const all = [guess, ...cuts.map(at)];
  return all.filter((s, i) => all.findIndex((t) => t.first === s.first && t.last === s.last) === i);
}

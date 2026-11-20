// A step's Next button words: the arrow never wraps onto a line of its own (it stays with the last word), and phones
// get a shorter version ("Next up: Add the new date in Litter pickup" is "Next: Litter pickup" on a phone).

/** The phone version of a Next label. */
export function shortNext(label: string): string {
  const rest = label.replace(/^Next up:\s*/, "");
  const job = /^Add the new date in (.+)$/.exec(rest);
  return `Next: ${job ? job[1] : rest}`;
}

/** "Next up: Litter pickup →", with the arrow kept on the last word, and the short version on phones. */
export function NextLabel({ label }: { label: string }) {
  return (
    <>
      <span className="max-sm:hidden">{label}&nbsp;→</span>
      <span className="sm:hidden">{shortNext(label)}&nbsp;→</span>
    </>
  );
}

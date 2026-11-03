// Prose lint for tour text: known LLM-writing tells, ported from Sprout's
// detector (github.com/2018kguo/sprout, src/style.ts; sources there: Wikipedia
// "Signs of AI writing" and tropes.fyi), plus review-specific ones.
// Code spans are stripped first, so `a -> b` or `notably` inside backticks pass.

const S = (s) => `(?<=^|[.!?]["')\\]]?\\s+)${s}`; // at a sentence start
export const TELLS = [
  ['em dash', /—|\s–\s|\w\s?--\s?\w/g, 'use a period, comma or parentheses'],
  ['negative parallelism', new RegExp([
    `\\b(?:it|this|that)(?:'s| is) not (?:just |only |about )?[^.;:!?]{1,60}[,;:.] (?:it|this|that)(?:'s| is)\\b`,
    `\\b(?:isn't|is not|wasn't|was not|aren't|are not) (?:just|only|merely|simply) [^.;!?]{1,60}[,;:.] (?:it|they|this|that)\\b`,
    `\\bnot (?:just|only|merely) [^.;!?]{1,60},? but(?: also)?\\b`,
  ].join('|'), 'gi'), 'state the point directly'],
  ['question, instant answer', new RegExp(S(`(?:\\S+ ){0,4}\\S+\\? (?:\\S+ ){0,4}\\S+[.!]`), 'g'), 'say the answer as a statement'],
  ['false suspense', /\bhere(?:'s| is) (?:the|a) (?:thing|kicker|catch|twist|truth|deal|problem)\b|\bthe truth is\b/gi, 'make the point without announcing it'],
  ['signposting', /\b(?:in conclusion|in summary|to sum up|ultimately|at the end of the day|at its core|all in all|in short|where to spend (?:your )?(?:review )?time|the key (?:thing|takeaway|insight) is|what this means is)\b/gi, "don't announce; say the thing"],
  ['empty transition', new RegExp(`\\b(?:it(?:'s| is) worth noting|it(?:'s| is) important to note|importantly|notably|interestingly)\\b|${S('(?:Additionally|Moreover|Furthermore)\\b')}`, 'gi'), 'cut it and say the next thing'],
  ['significance tail', /, (?:highlighting|underscoring|emphasizing|showcasing|reflecting|ensuring|contributing to|cementing|fostering|paving the way|marking)\b[^.!?]*[.!?]/gi, "drop the trailing '-ing' clause"],
  ["'serves as' for 'is'", /\b(?:serves|stands|acts|functions) as (?:a|an|the)\b|\bboasts\b/gi, "use 'is' or 'has'"],
  ['teacher voice', /\blet(?:'s) (?:break (?:this|it) down|unpack|dive|delve|explore)\b|\bthink of it (?:as|like)\b/gi, 'talk to the reader as a peer'],
  ['magic adverb', /\b(?:quietly|deeply|remarkably|truly|genuinely|fundamentally|incredibly|profoundly|seamlessly)\b/gi, 'cut the adverb'],
  ['AI vocabulary', /\b(?:delv\w*|tapestry|testament|landscape|realm|multifaceted|pivotal|crucial|vibrant|intricate\w*|interplay|meticulous\w*|underscor\w*|showcas\w*|garner\w*|bolster\w*|leverag\w*|foster\w*|unlock\w*|elevat\w*|seamless\w*|game-?changer|holistic|synergy|paradigm|robust|streamlin\w*|empower\w*)\b/gi, 'use a plainer word'],
  ['decorative arrow', /[→⟶⇒]|\s->\s/g, 'write it in words, or put code in backticks'],
  ['bold for emphasis', /\*\*[^*]+\*\*/g, 'no bold; the sentence should carry the weight'],
];

export const stripCode = (t) => String(t ?? '').replace(/`[^`]*`/g, 'x');

export function lint(text) {
  const t = stripCode(text);
  return TELLS.flatMap(([name, re, fix]) => [...t.matchAll(re)].filter((m) => m[0].trim()).map((m) => `${name}: "${m[0].trim()}" (${fix})`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  assert.deepEqual(lint('Plain sentence about `a -> b` and `notably`.'), []);
  assert.equal(lint('This is not a cache, it is a log.').length, 1);
  assert.equal(lint('The result? Chaos.').length, 1);
  assert.equal(lint('Where to spend review time: the guard.').length, 1);
  assert.equal(lint('It adds a guard, ensuring safety.').length, 1);
  assert.equal(lint('Retire **effective** documents').length, 1);
  console.log('style.mjs ok');
}

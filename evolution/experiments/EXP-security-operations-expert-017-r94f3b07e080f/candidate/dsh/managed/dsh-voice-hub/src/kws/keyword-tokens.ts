import { pinyin } from 'pinyin-pro';
import type { KeywordSpec } from './types.ts';
import { MODEL_TOKENS } from './model-tokens.ts';

// The model writes ü as u after j/q/x/y (pypinyin's non-strict finals); pinyin-pro keeps the umlaut.
const PLAIN_U: Readonly<Record<string, string>> = { ü: 'u', ǖ: 'ū', ǘ: 'ú', ǚ: 'ǔ', ǜ: 'ù' };
const UMLAUT_DROPPING_INITIALS: ReadonlySet<string> = new Set(['j', 'q', 'x', 'y']);
const HINT = 'pass { text, tokens } with explicit tokens if the automatic pinyin is wrong (polyphones)';
/**
 * 一 and 不 change tone depending on what follows (一起 yì, 一定 yí, 第一 yì, 不对 bú, 不客气 bú…), and
 * the rules the official sherpa-onnx text2token tool applies are not the ones pinyin-pro applies:
 * they disagree on 4 of the 10 phrases in golden-tokens-sandhi.json. Both spellings are valid model
 * units, so a wrong guess passes validation and then silently never fires. Refuse to guess instead.
 */
const TONE_SANDHI_CHARACTERS = /[一不]/;

function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function assertKnown(phrase: string, tokens: readonly string[]): void {
  const unknown = tokens.find((t) => !MODEL_TOKENS.has(t));
  if (unknown !== undefined) {
    throw new Error(`wake keyword "${phrase}" needs the unit "${unknown}", which the KWS model does not know; ${HINT}`);
  }
}

/** Chinese text -> the model's units: per syllable, initial then tone-marked final (e.g. 小云 -> x iǎo y ún). */
export function textToTokens(text: string): string[] {
  const phrase = compact(text);
  if (!phrase) throw new Error('wake keyword is empty');
  const initials = pinyin(phrase, { pattern: 'initial', type: 'array' });
  const finals = pinyin(phrase, { pattern: 'final', toneType: 'symbol', type: 'array' });
  const characters = Array.from(phrase);
  const tokens: string[] = [];
  initials.forEach((initial, i) => {
    let final = finals[i] ?? '';
    // pinyin-pro silently returns nothing for digits, latin letters, punctuation…: refuse instead of dropping them
    if (!initial && !final) {
      throw new Error(`wake keyword "${phrase}" contains "${characters[i] ?? '?'}", which has no pinyin; use Chinese characters only`);
    }
    if (UMLAUT_DROPPING_INITIALS.has(initial)) final = final.replace(/[üǖǘǚǜ]/g, (c) => PLAIN_U[c] ?? c);
    if (initial) tokens.push(initial);
    if (final) tokens.push(final);
  });
  if (TONE_SANDHI_CHARACTERS.test(phrase)) {
    throw new Error(
      `wake keyword "${phrase}" contains 一 or 不, whose tone changes with the word that follows. ` +
      `The automatic conversion guesses "${tokens.join(' ')}", which the official sherpa-onnx ` +
      'text2token tool often spells differently — and because both spellings are valid model units, ' +
      'a wrong guess is accepted and then never matches anything. Pass { text, tokens } with the ' +
      'tokens that tool prints (see tools/kws-wasm/README.md, "polyphones and 一/不").',
    );
  }
  assertKnown(phrase, tokens);
  return tokens;
}

/** The `keywords` string sherpa-onnx expects: one "<tokens> @<display name>" line per wake phrase. */
export function buildKeywordsConfig(specs: readonly KeywordSpec[]): string {
  if (specs.length === 0) throw new Error('wake.keywords needs at least one keyword');
  const seen = new Set<string>();
  return specs
    .map((spec) => {
      const phrase = compact(typeof spec === 'string' ? spec : spec.text);
      if (!phrase) throw new Error('wake keyword is empty');
      if (seen.has(phrase)) throw new Error(`duplicate wake keyword "${phrase}"`);
      seen.add(phrase);
      let tokens: string[];
      if (typeof spec === 'string') {
        tokens = textToTokens(phrase);
      } else {
        tokens = spec.tokens.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) throw new Error(`wake keyword "${phrase}" has empty tokens`);
        assertKnown(phrase, tokens);
      }
      return `${tokens.join(' ')} @${phrase}`;
    })
    .join('\n');
}

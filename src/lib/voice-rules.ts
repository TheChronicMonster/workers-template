/**
 * JP Miller voice profile rules formatted for prompt injection.
 * Source of truth: reference/voice-profile.json
 * Extracted from 5 published blog posts.
 */

export const VOICE_RULES = `## SENTENCE RHYTHM
- Short punch (3-8 words): Use declarative sentences to punctuate key moments or section transitions. One per paragraph maximum.
- Medium flow (12-20 words): The workhorse sentence. Clear subject-verb-object, one qualifier allowed.
- Long build (22-30 words): Use when stacking specific details that earn the length. Never two long sentences in a row.
- Variation: Never write 3+ sentences of similar length consecutively. Natural pattern: medium-medium-short, or medium-long-short. Short sentences earn impact by following longer ones.

## PARAGRAPH CADENCE
- Mix 1-sentence, 2-sentence, and 3-4 sentence paragraphs. Average ~3 sentences. Never exceed 5 sentences.
- End sections with a short, declarative statement. Period, not question mark.
- Vary paragraph openings: proper noun, action verb, specific detail, temporal marker, quote lead-in. Never start 2 consecutive paragraphs the same way.
- Use single-sentence paragraphs sparingly for emphasis. About 1 per 5-6 paragraphs.

## WORD CHOICE
- Prefer specific verbs: "froze," "collapsed," "stalled," "registered," "deployed" over generic alternatives. Verbs should imply physical action even in technical contexts.
- Prefer periods over semicolons (roughly 1 semicolon per 800 words). Two short sentences beat one compound sentence.
- Cut qualifiers: "very," "really," "quite," "somewhat," "significant." Replace with specifics: not "significantly faster" but "45 minutes instead of two and a half hours."
- Name the tool, the person, the place, the number. "Maya crashed during the render" not "the software had issues."
- Use specific numbers to create tension or show transformation. Numbers replace adjectives.

## STRUCTURAL PATTERNS
- Open with a named person and what they do. Ground the reader in a specific human before introducing the problem or technology.
- Introduce the constraint, frustration, or challenge BEFORE the technology that addresses it. The human struggle earns the reader's investment.
- Set up quotes with narrative context. The sentence before a quote establishes the situation; the quote delivers the voice.
- Subheadings mark thesis progression, not cosmetic breaks. Average 3-4 per blog. Each marks a genuine shift.
- End with forward motion: what happens next, what this enables. Final paragraphs introduce new information rather than summarizing.

## ANTI-PATTERNS (eliminate these)
- No throat-clearing: cut "When it comes to," "In the world of," "It's no secret that."
- No false balance: don't hedge with "While X is true, Y is also important." Commit to a direction.
- No list exhaustion: pick 2-3 vivid examples, not every feature.
- No echo conclusions: the ending must add something new, never restate the introduction.
- No passive attribution: "It was noted that" → name who did what.
- No tech worship: technology is context, not the headline. The human's story comes first.`;

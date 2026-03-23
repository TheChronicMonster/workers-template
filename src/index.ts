import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { callClaude } from "./lib/claude.js";
import {
	RESEARCHER_SYSTEM,
	WRITER_SIMPLE_SYSTEM,
	MECHANICAL_EDITOR_SYSTEM,
	VOICE_RHYTHM_EDITOR_SYSTEM,
	FINAL_EDITOR_SYSTEM,
	REVISION_EDITOR_SYSTEM,
	SESSION_EDITOR_SYSTEM,
	SESSION_WRITER_SYSTEM,
} from "./prompts/personas.js";
import { SOCIAL_POSTS_SYSTEM } from "./prompts/social-personas.js";
import { WRITING_RULES } from "./lib/writing-rules.js";

const worker = new Worker();
export default worker;

// ---------------------------------------------------------------------------
// 1. pullTranscript — Fetch transcript from Fireflies via GraphQL API
// ---------------------------------------------------------------------------

worker.tool("pullTranscript", {
	title: "Pull Transcript",
	description:
		"Fetch a meeting transcript from Fireflies.ai by transcript ID or most recent meeting. Returns the full transcript text with speaker labels, summary, and keywords.",
	schema: j.object({
		transcriptId: j
			.string()
			.describe(
				"Fireflies transcript ID. If omitted, fetches the most recent transcript.",
			)
			.nullable(),
	}),
	execute: async ({ transcriptId }) => {
		const apiKey = process.env.FIREFLIES_API_KEY;
		if (!apiKey) {
			return "Error: FIREFLIES_API_KEY not configured. Set it with `ntn workers env set FIREFLIES_API_KEY <key>`.";
		}

		const endpoint = "https://api.fireflies.ai/graphql";
		const headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		};

		if (!transcriptId) {
			const listQuery = {
				query: `query { transcripts(limit: 1) { id title date } }`,
			};
			const listResp = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(listQuery),
			});
			const listData = (await listResp.json()) as {
				data?: { transcripts?: Array<{ id: string; title: string }> };
				errors?: Array<{ message: string }>;
			};

			if (listData.errors) {
				return `Fireflies API error: ${listData.errors.map((e) => e.message).join(", ")}`;
			}
			const transcripts = listData.data?.transcripts;
			if (!transcripts || transcripts.length === 0) {
				return "No transcripts found in your Fireflies account.";
			}
			transcriptId = transcripts[0].id;
		}

		const detailQuery = {
			query: `query Transcript($id: String!) {
				transcript(id: $id) {
					id
					title
					date
					duration
					sentences {
						speaker_name
						text
					}
					summary {
						overview
						keywords
					}
				}
			}`,
			variables: { id: transcriptId },
		};

		const detailResp = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(detailQuery),
		});
		const detailData = (await detailResp.json()) as {
			data?: {
				transcript?: {
					id: string;
					title: string;
					date: string;
					duration: number;
					sentences: Array<{ speaker_name: string; text: string }>;
					summary?: { overview: string; keywords: string[] };
				};
			};
			errors?: Array<{ message: string }>;
		};

		if (detailData.errors) {
			return `Fireflies API error: ${detailData.errors.map((e) => e.message).join(", ")}`;
		}

		const t = detailData.data?.transcript;
		if (!t) {
			return `Transcript ${transcriptId} not found.`;
		}

		const formattedSentences = t.sentences
			.map((s) => `${s.speaker_name}: ${s.text}`)
			.join("\n");

		const durationMin = Math.round((t.duration || 0) / 60);

		return [
			`# ${t.title}`,
			`Date: ${t.date} | Duration: ${durationMin} min | ID: ${t.id}`,
			t.summary
				? `\nSummary: ${t.summary.overview}\nKeywords: ${(t.summary.keywords || []).join(", ")}`
				: "",
			`\n## Transcript\n`,
			formattedSentences,
		].join("\n");
	},
});

// ---------------------------------------------------------------------------
// 2. processTranscript — Researcher analysis of transcript
// ---------------------------------------------------------------------------

worker.tool("processTranscript", {
	title: "Process Transcript",
	description:
		"Analyze a meeting transcript to extract story material, usable quotes (ranked), and 2-3 blog angle pitches with outlines. Output feeds into generateDraft after you select/modify an outline.",
	schema: j.object({
		transcript: j
			.string()
			.describe("The full transcript text to analyze."),
		blogType: j
			.string()
			.describe(
				'Type of blog: "Interview", "Conference Report", or "Technical Guide". Defaults to "Interview".',
			)
			.nullable(),
		subjectName: j
			.string()
			.describe("Name of the primary subject/interviewee.")
			.nullable(),
	}),
	execute: async ({ transcript, blogType, subjectName }) => {
		const userMessage = [
			`BLOG TYPE: ${blogType || "Interview"}`,
			subjectName ? `SUBJECT: ${subjectName}` : "",
			`\n## SOURCE TRANSCRIPT\n\n${transcript}`,
			`\nAnalyze this transcript. Deliver: story material (what happened, key facts, specifics), usable quotes (ranked strongest to weakest with honest assessment), and 2-3 blog angles with outlines. Be direct about what's strong and what's thin.`,
		]
			.filter(Boolean)
			.join("\n");

		return await callClaude(RESEARCHER_SYSTEM, [
			{ role: "user", content: userMessage },
		]);
	},
});

// ---------------------------------------------------------------------------
// 3. generateDraft — 5-stage chained pipeline (THE CORE)
// ---------------------------------------------------------------------------

worker.tool("generateDraft", {
	title: "Generate Blog Draft",
	description:
		"Generate a publication-ready Dell/NVIDIA blog post from a transcript and optional outline. Runs a 5-stage chained pipeline: (1) Researcher extracts story foundation, (2) Writer produces draft, (3) Mechanical Editor enforces rules, (4) Voice & Rhythm Editor applies JP Miller cadence and removes AIisms, (5) Final Editor verifies thesis, quotes, and corporate contamination. Returns the final post with editorial notes.",
	schema: j.object({
		transcript: j
			.string()
			.describe("The full transcript or source material."),
		outline: j
			.string()
			.describe(
				"Optional: A pre-approved outline or thesis direction. If omitted, the system generates one from the transcript.",
			)
			.nullable(),
		subjectName: j
			.string()
			.describe("Name of the primary subject/interviewee.")
			.nullable(),
		blogType: j
			.string()
			.describe(
				'Type of blog: "Interview", "Conference Report", or "Technical Guide". Defaults to "Interview".',
			)
			.nullable(),
		ctaFocus: j
			.string()
			.describe(
				'"dell", "nvidia", or "combined". Determines the CTA direction. Defaults to "combined".',
			)
			.nullable(),
	}),
	execute: async ({ transcript, outline, subjectName, blogType, ctaFocus }) => {
		const type = blogType || "Interview";
		const subject = subjectName || "the subject";
		const cta =
			ctaFocus === "dell"
				? WRITING_RULES.cta.dellFocus
				: ctaFocus === "nvidia"
					? WRITING_RULES.cta.nvidiaFocus
					: WRITING_RULES.cta.combined;

		const stageLog: string[] = [];

		// ── STAGE 1: Researcher — extract story foundation ──
		const researchPrompt = [
			`BLOG TYPE: ${type}`,
			subjectName ? `SUBJECT: ${subject}` : "",
			`\n## SOURCE TRANSCRIPT\n\n${transcript}`,
			outline ? `\n## PRE-APPROVED OUTLINE\n\n${outline}` : "",
			`\nAnalyze this transcript. Deliver: story material (what happened, key facts, specifics), usable quotes (ranked strongest to weakest with honest assessment), and 2-3 blog angles with outlines. Be direct about what's strong and what's thin.`,
			outline
				? `\nNote: An outline has been pre-approved. Your analysis should support it, but flag honestly if the transcript material is thin for any section.`
				: "",
		]
			.filter(Boolean)
			.join("\n");

		const research = await callClaude(RESEARCHER_SYSTEM, [
			{ role: "user", content: researchPrompt },
		]);
		stageLog.push("Stage 1 (Researcher): complete");

		// ── STAGE 2: Writer — produce draft from research ──
		const writePrompt = [
			`Write a Dell blog post about ${subject}.`,
			`Blog type: ${type}.`,
			`\n## RESEARCHER NOTES\n\n${research}`,
			outline ? `\n## APPROVED OUTLINE\n\n${outline}` : "",
			`\n## SOURCE TRANSCRIPT\n\n${transcript}`,
			`\nCTA direction: ${cta}`,
		]
			.filter(Boolean)
			.join("\n");

		const draft = await callClaude(WRITER_SIMPLE_SYSTEM, [
			{ role: "user", content: writePrompt },
		]);
		stageLog.push("Stage 2 (Writer): complete");

		// ── STAGE 3: Mechanical Editor — deterministic rule enforcement ──
		const cleanPrompt = [
			`## DRAFT TO CLEAN\n\n${draft}`,
			`\nPerform your mechanical edit pass. Fix all rule violations: banned language, em dashes, AP Style, quote discipline, title word count, tech specificity, prohibited patterns.`,
			`Output the complete cleaned blog post, then your edit notes.`,
		].join("\n");

		const cleaned = await callClaude(MECHANICAL_EDITOR_SYSTEM, [
			{ role: "user", content: cleanPrompt },
		]);
		stageLog.push("Stage 3 (Mechanical Editor): complete");

		// ── STAGE 4: Voice & Rhythm Editor — cadence, AIism removal ──
		const voicePrompt = [
			`## MECHANICALLY CLEANED DRAFT\n\n${cleaned}`,
			`\nPerform your voice and rhythm pass. Eliminate AIisms, enforce cadence variation, check flow and perspective consistency.`,
			`Preserve all mechanical edit fixes. Do not reintroduce banned words or em dashes.`,
			`Output the complete rhythm-edited blog post, then your voice & rhythm notes.`,
		].join("\n");

		const voiced = await callClaude(VOICE_RHYTHM_EDITOR_SYSTEM, [
			{ role: "user", content: voicePrompt },
		]);
		stageLog.push("Stage 4 (Voice & Rhythm Editor): complete");

		// ── STAGE 5: Final Editor — story integrity, thesis, contamination check ──
		const finalPrompt = [
			`## VOICE-EDITED DRAFT\n\n${voiced}`,
			`\n## SOURCE TRANSCRIPT (for quote verification)\n\n${transcript}`,
			`\nPerform your final editorial pass. Verify thesis progression, quote accuracy against the transcript, corporate contamination, and story flow.`,
			`Output the publication-ready blog post, then your final editorial notes.`,
		].join("\n");

		const finalPost = await callClaude(FINAL_EDITOR_SYSTEM, [
			{ role: "user", content: finalPrompt },
		]);
		stageLog.push("Stage 5 (Final Editor): complete");

		return [
			finalPost,
			`\n\n---\n## Pipeline Log\n${stageLog.join("\n")}`,
		].join("");
	},
});

// ---------------------------------------------------------------------------
// 4. prepWorkfront — Blog page teasers, TL;DR, target audience
// ---------------------------------------------------------------------------

worker.tool("prepWorkfront", {
	title: "Prep for Workfront",
	description:
		"Generate Workfront submission package from a FINAL APPROVED blog post: 2 blog page teasers (~130 chars), TL;DR summary, and target audience definition. Run this AFTER the blog is finalized — not on drafts.",
	schema: j.object({
		blogPost: j
			.string()
			.describe("The final approved blog post content."),
	}),
	execute: async ({ blogPost }) => {
		const systemPrompt = `You are a content strategist preparing a blog submission package for Workfront.

Your job: create the metadata that surrounds the blog on Dell's website. This is NOT social media — these are the teasers that appear on the blog listing page to drive clicks into the full article.

DELIVERABLES:

1. BLOG PAGE TEASERS (exactly 2):
   - Each ~130 characters (hard limit: 140 characters including spaces)
   - These appear on the blog main page as preview text
   - Goal: make someone click through to read the full post
   - Different angles — one emotional/human, one practical/value
   - No hashtags, no @mentions — this is website copy

2. TL;DR SUMMARY:
   - 2-3 sentences capturing the core story and key takeaway
   - Written for an executive who will decide whether to promote this post
   - Specific, not generic — mention the subject, the challenge, the outcome

3. TARGET AUDIENCE:
   - Primary audience: role, industry, seniority level, and WHY this content is relevant to them
   - Secondary audience: same format
   - Be specific: "VP of Engineering at media companies evaluating GPU-accelerated pipelines" not "tech leaders"

OUTPUT FORMAT:
## Blog Page Teasers
1. [teaser] (X chars)
2. [teaser] (X chars)

## TL;DR
[summary]

## Target Audience
**Primary:** [definition + relevance rationale]
**Secondary:** [definition + relevance rationale]`;

		return await callClaude(systemPrompt, [
			{
				role: "user",
				content: `## FINAL BLOG POST\n\n${blogPost}\n\nGenerate the Workfront submission package.`,
			},
		]);
	},
});

// ---------------------------------------------------------------------------
// 5. generateSocialPosts — 4 LinkedIn posts from distinct personas
// ---------------------------------------------------------------------------

worker.tool("generateSocialPosts", {
	title: "Generate Social Posts",
	description:
		"Generate 4 standalone LinkedIn posts from a FINAL APPROVED blog post. Each post comes from a distinct persona: Author (JP Miller), Marketing Support (Dell Comms), Subject Matter Expert, and Interested Third-Party. Run this AFTER the blog is finalized.",
	schema: j.object({
		blogPost: j
			.string()
			.describe("The final approved blog post content."),
		subjectName: j
			.string()
			.describe(
				"Name of the SME/subject featured in the blog. Used for the SME persona voice.",
			)
			.nullable(),
		subjectRole: j
			.string()
			.describe(
				"Role/title of the SME (e.g., 'Senior VFX Supervisor at ILM'). Adds authenticity to SME persona.",
			)
			.nullable(),
	}),
	execute: async ({ blogPost, subjectName, subjectRole }) => {
		const contextLines = [
			`## FINAL BLOG POST\n\n${blogPost}`,
			subjectName ? `\nSME Name: ${subjectName}` : "",
			subjectRole ? `SME Role: ${subjectRole}` : "",
			`\nGenerate all 4 LinkedIn posts. Each must be a standalone post — not a teaser. Each must feel like a different real person wrote it.`,
		]
			.filter(Boolean)
			.join("\n");

		return await callClaude(SOCIAL_POSTS_SYSTEM, [
			{ role: "user", content: contextLines },
		]);
	},
});

// ---------------------------------------------------------------------------
// 6. researchSME — Background briefing on subject matter expert
// ---------------------------------------------------------------------------

worker.tool("researchSME", {
	title: "Research SME",
	description:
		"Generate background research briefing for a subject matter expert to enrich blog writing. Produces a profile based on transcript context and any provided information. Focuses on authentic details over generic credentials.",
	schema: j.object({
		smeName: j.string().describe("Full name of the subject matter expert."),
		smeRole: j
			.string()
			.describe("Their role/title and company.")
			.nullable(),
		transcript: j
			.string()
			.describe(
				"Optional: transcript mentioning the SME, used to extract additional context.",
			)
			.nullable(),
		additionalContext: j
			.string()
			.describe(
				"Optional: any additional context about the SME (bio, LinkedIn summary, etc.).",
			)
			.nullable(),
	}),
	execute: async ({ smeName, smeRole, transcript, additionalContext }) => {
		const systemPrompt = `You are a research analyst preparing a subject matter expert briefing for a blog writer.

Your goal: Create a concise but rich profile that helps a writer craft an authentic, compelling story about this person. Focus on:
1. Professional background and expertise areas
2. Notable achievements or contributions mentioned in available material
3. Communication style and personality cues (from transcript if available)
4. Potential story angles that would resonate with B2B tech audiences
5. Dell/NVIDIA technology connections (if any)

Be factual. Only work with what's provided — do not fabricate or assume. Flag anything that appears coached or manufactured. Highlight authentic, specific details over generic credentials.

If working from a transcript, pay attention to:
- How they describe their own work (passion vs. obligation)
- Technical depth (do they go deep or stay surface-level?)
- Anecdotes they volunteer vs. answers to direct questions
- Moments of genuine excitement or frustration`;

		const userMessage = [
			`## SUBJECT: ${smeName}`,
			smeRole ? `Role: ${smeRole}` : "",
			additionalContext
				? `\n## ADDITIONAL CONTEXT\n${additionalContext}`
				: "",
			transcript
				? `\n## TRANSCRIPT EXCERPT\n${transcript}`
				: "",
			`\nCreate a comprehensive SME briefing for the blog writing team.`,
		]
			.filter(Boolean)
			.join("\n");

		return await callClaude(systemPrompt, [
			{ role: "user", content: userMessage },
		]);
	},
});

// ---------------------------------------------------------------------------
// 7. reviseDraft — Targeted revision based on human feedback
// ---------------------------------------------------------------------------

worker.tool("reviseDraft", {
	title: "Revise Draft",
	description:
		"Revise an existing blog draft based on human editor feedback. Takes the current draft, revision notes, and optionally the original transcript for quote verification. Applies targeted changes while maintaining all editorial standards. Run this after reviewing a draft from generateDraft.",
	schema: j.object({
		draft: j
			.string()
			.describe("The current blog draft to revise."),
		feedback: j
			.string()
			.describe("Human editor's revision notes and feedback — specific changes requested."),
		transcript: j
			.string()
			.describe(
				"Original transcript for quote verification. Include if feedback involves quotes.",
			)
			.nullable(),
	}),
	execute: async ({ draft, feedback, transcript }) => {
		const userMessage = [
			`## CURRENT DRAFT\n\n${draft}`,
			`\n## REVISION NOTES FROM EDITOR\n\n${feedback}`,
			transcript
				? `\n## SOURCE TRANSCRIPT (for quote verification)\n\n${transcript}`
				: "",
			`\nApply the revision notes to the draft. Execute each requested change while maintaining editorial standards. Output the complete revised blog post, then your revision notes.`,
		]
			.filter(Boolean)
			.join("\n");

		return await callClaude(REVISION_EDITOR_SYSTEM, [
			{ role: "user", content: userMessage },
		]);
	},
});

// ---------------------------------------------------------------------------
// 8. mechanicalClean — Fix specific violations flagged by Python validator
// ---------------------------------------------------------------------------

worker.tool("mechanicalClean", {
	title: "Mechanical Clean",
	description:
		"Fix specific rule violations in a blog draft, guided by a deterministic validation report. Takes the draft and a list of violations (from validate-draft.py) and fixes only the flagged items. Skips this tool if the validator reports no violations.",
	schema: j.object({
		draft: j
			.string()
			.describe("The blog draft to clean."),
		violationReport: j
			.string()
			.describe(
				"The validation report from validate-draft.py listing specific violations to fix.",
			),
	}),
	execute: async ({ draft, violationReport }) => {
		const cleanPrompt = [
			`## DRAFT TO CLEAN\n\n${draft}`,
			`\n## VIOLATIONS DETECTED BY AUTOMATED VALIDATOR\n\nThe following violations were found by deterministic Python checks. These are FACTS, not suggestions — each one is a confirmed rule violation that must be fixed.\n\n${violationReport}`,
			`\nFix ONLY the violations listed above. Do not rewrite sections that aren't flagged. For each banned word/phrase, replace with a concrete, specific alternative. For dashes, restructure using periods or commas. For quote issues, integrate quotes more naturally.`,
			`Output the complete cleaned blog post, then "---\\nMechanical Clean Notes:" listing every change made.`,
		].join("\n");

		return await callClaude(MECHANICAL_EDITOR_SYSTEM, [
			{ role: "user", content: cleanPrompt },
		]);
	},
});

// ---------------------------------------------------------------------------
// 9. editorialSession — Writer-Editor conversation loop
// ---------------------------------------------------------------------------

import type { ClaudeMessage } from "./lib/claude.js";

worker.tool("editorialSession", {
	title: "Editorial Session",
	description:
		"Run an iterative writer-editor conversation on a blog draft. The editor gives feedback and asks questions; the writer revises based on that feedback plus the original source material. Runs up to 3 rounds or until the editor approves. Use this after generating an initial draft.",
	schema: j.object({
		draft: j
			.string()
			.describe("The current blog draft to workshop."),
		transcript: j
			.string()
			.describe(
				"Original transcript — the writer references this to answer editor questions and verify quotes.",
			)
			.nullable(),
		research: j
			.string()
			.describe(
				"Research notes from the researcher stage, if available.",
			)
			.nullable(),
		direction: j
			.string()
			.describe(
				"Optional initial direction or focus areas for the editor. E.g., 'Focus on strengthening the opening and checking for marketing drift.'",
			)
			.nullable(),
	}),
	execute: async ({ draft, transcript, research, direction }) => {
		const MAX_ROUNDS = 3;

		// Conversation histories — each agent sees its own thread
		const editorMessages: ClaudeMessage[] = [];
		const writerMessages: ClaudeMessage[] = [];

		// Source material block the writer can reference
		const sourceBlock = [
			transcript ? `## SOURCE TRANSCRIPT\n\n${transcript}` : "",
			research ? `## RESEARCH NOTES\n\n${research}` : "",
		]
			.filter(Boolean)
			.join("\n\n");

		let currentDraft = draft;
		let sessionLog = "# Editorial Session Log\n\n";
		let approved = false;

		for (let round = 1; round <= MAX_ROUNDS; round++) {
			sessionLog += `## Round ${round}\n\n`;

			// --- Editor reads the draft and gives feedback ---
			const editorPrompt =
				round === 1
					? [
							`Here is the draft to review:\n\n${currentDraft}`,
							direction
								? `\nThe human editor has asked you to focus on: ${direction}`
								: "",
							`\nThis is round ${round} of up to ${MAX_ROUNDS}. Give your feedback.`,
						]
							.filter(Boolean)
							.join("\n")
					: [
							`The writer has revised the draft based on your feedback. Here is the new version:\n\n${currentDraft}`,
							`\nThis is round ${round} of up to ${MAX_ROUNDS}. Review the changes and give your feedback. If the piece is ready, say APPROVED in your verdict.`,
						].join("\n");

			editorMessages.push({ role: "user", content: editorPrompt });

			const editorFeedback = await callClaude(
				SESSION_EDITOR_SYSTEM,
				editorMessages,
			);

			editorMessages.push({
				role: "assistant",
				content: editorFeedback,
			});

			sessionLog += `### Editor Feedback\n\n${editorFeedback}\n\n`;

			// Check if editor approved
			if (/\bAPPROVED\b/.test(editorFeedback)) {
				approved = true;
				sessionLog += `*Editor approved the draft in round ${round}.*\n\n`;
				break;
			}

			// --- Writer reads editor feedback and revises ---
			const writerPrompt =
				round === 1
					? [
							`Here is your current draft:\n\n${currentDraft}`,
							sourceBlock
								? `\n${sourceBlock}`
								: "",
							`\n## EDITOR FEEDBACK (Round ${round})\n\n${editorFeedback}`,
							`\nAddress the editor's feedback. Answer their questions from the source material. Revise the draft.`,
						]
							.filter(Boolean)
							.join("\n")
					: [
							`## EDITOR FEEDBACK (Round ${round})\n\n${editorFeedback}`,
							`\nAddress this round's feedback. Your current draft and source material are in the conversation above. Output your response and the complete revised draft.`,
						].join("\n");

			writerMessages.push({ role: "user", content: writerPrompt });

			// On first round, include source material in writer's context
			if (round === 1 && sourceBlock) {
				// Source material is already included in the first prompt
			}

			const writerResponse = await callClaude(
				SESSION_WRITER_SYSTEM,
				writerMessages,
			);

			writerMessages.push({
				role: "assistant",
				content: writerResponse,
			});

			sessionLog += `### Writer Response\n\n${writerResponse}\n\n`;

			// Extract the revised draft from the writer's response
			// The writer outputs discussion first, then "---\nREVISED DRAFT:\n---" then the draft
			const draftMarker = /---\s*\n\s*REVISED DRAFT:\s*\n\s*---\s*\n/i;
			const draftSplit = writerResponse.split(draftMarker);
			if (draftSplit.length >= 2) {
				currentDraft = draftSplit.slice(1).join("\n").trim();
			} else {
				// Fallback: use the whole response as the draft
				currentDraft = writerResponse;
			}
		}

		if (!approved) {
			sessionLog += `*Maximum rounds (${MAX_ROUNDS}) reached. Proceeding with current draft.*\n\n`;
		}

		// Output: draft and session log in machine-parseable sections
		return [
			"<EDITORIAL_SESSION_DRAFT>",
			currentDraft,
			"</EDITORIAL_SESSION_DRAFT>",
			"<EDITORIAL_SESSION_LOG>",
			sessionLog,
			"</EDITORIAL_SESSION_LOG>",
		].join("\n");
	},
});

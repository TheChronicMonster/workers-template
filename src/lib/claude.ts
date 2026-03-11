import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-6";

let client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!client) {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) {
			throw new Error(
				"ANTHROPIC_API_KEY not set. Use `ntn workers env set ANTHROPIC_API_KEY <key>` to configure.",
			);
		}
		client = new Anthropic({ apiKey });
	}
	return client;
}

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: string;
}

export async function callClaude(
	systemPrompt: string,
	messages: ClaudeMessage[],
	options?: { maxTokens?: number; temperature?: number },
): Promise<string> {
	const anthropic = getClient();
	const response = await anthropic.messages.create({
		model: MODEL,
		max_tokens: options?.maxTokens ?? 4096,
		temperature: options?.temperature ?? 0.4,
		system: systemPrompt,
		messages,
	});

	const textBlock = response.content.find((block) => block.type === "text");
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("No text response from Claude");
	}
	return textBlock.text;
}

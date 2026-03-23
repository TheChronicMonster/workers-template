import type { Client } from "@notionhq/client";
import type {
	BlockObjectRequest,
	CreatePageParameters,
} from "@notionhq/client/build/src/api-endpoints.js";

const DATABASE_ID =
	process.env.NOTION_DATABASE_ID || "a820fe92f9bc4ea3bf9b8a350689c057";

// ── Query helpers ────────────────────────────────────────────────────────────

/**
 * Find an existing blog task by Codename (subject name).
 * Returns the first matching page or null.
 */
export async function findBlogTask(
	notion: Client,
	subjectName: string,
): Promise<{ id: string } | null> {
	const response = await notion.databases.query({
		database_id: DATABASE_ID,
		filter: {
			property: "Codename",
			rich_text: { equals: subjectName },
		},
		page_size: 1,
	});
	return response.results.length > 0
		? { id: response.results[0].id }
		: null;
}

/**
 * Create a new blog task in the database with default properties.
 */
export async function createBlogTask(
	notion: Client,
	subjectName: string,
	options?: { firefliesUrl?: string },
): Promise<{ id: string }> {
	const today = new Date().toISOString().split("T")[0];
	const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
		.toISOString()
		.split("T")[0];

	const properties: CreatePageParameters["properties"] = {
		"Blog name": { title: [{ text: { content: subjectName } }] },
		Codename: { rich_text: [{ text: { content: subjectName } }] },
		"Request date": { date: { start: today } },
		Deadline: { date: { start: deadline } },
	};

	// Try to set default assignees by looking up workspace users
	try {
		const users = await notion.users.list({});
		const jp = users.results.find(
			(u) => "name" in u && u.name?.toLowerCase().includes("jp miller"),
		);
		const logan = users.results.find(
			(u) =>
				"name" in u && u.name?.toLowerCase().includes("logan lawler"),
		);
		if (jp) properties["Assignee"] = { people: [{ id: jp.id }] };
		if (logan) properties["Dell Owner"] = { people: [{ id: logan.id }] };
	} catch {
		// User lookup failed — skip default assignees
	}

	if (options?.firefliesUrl) {
		properties["Fireflies meet"] = { url: options.firefliesUrl };
	}

	const page = await notion.pages.create({
		parent: { database_id: DATABASE_ID },
		properties,
	});
	return { id: page.id };
}

/**
 * Find an existing blog task or create a new one.
 */
export async function findOrCreateBlogTask(
	notion: Client,
	subjectName: string,
	options?: { firefliesUrl?: string },
): Promise<{ id: string; created: boolean }> {
	const existing = await findBlogTask(notion, subjectName);
	if (existing) return { id: existing.id, created: false };
	const page = await createBlogTask(notion, subjectName, options);
	return { id: page.id, created: true };
}

// ── Artifact storage ─────────────────────────────────────────────────────────

/**
 * Save an artifact as a sub-page under the blog task.
 * Handles Notion's 100-block-per-request and 2000-char-per-richtext limits.
 */
export async function saveArtifact(
	notion: Client,
	parentPageId: string,
	title: string,
	content: string,
): Promise<{ id: string }> {
	const blocks = contentToBlocks(content);

	// Notion limits children to 100 blocks per request
	const firstBatch = blocks.slice(0, 100);
	const page = await notion.pages.create({
		parent: { page_id: parentPageId },
		properties: {
			title: { title: [{ text: { content: title } }] },
		},
		children: firstBatch,
	});

	// Append remaining blocks in batches of 100
	for (let i = 100; i < blocks.length; i += 100) {
		await notion.blocks.children.append({
			block_id: page.id,
			children: blocks.slice(i, i + 100),
		});
	}

	return { id: page.id };
}

// ── Orchestration wrapper ────────────────────────────────────────────────────

/**
 * After a tool produces its output, optionally save it to Notion.
 * If subjectName is null/empty, returns the content unchanged (backward-compatible).
 * On Notion errors, appends a warning but still returns the content.
 */
export async function withNotionSave(
	notion: Client,
	subjectName: string | null | undefined,
	artifactTitle: string,
	content: string,
	options?: { firefliesUrl?: string },
): Promise<string> {
	if (!subjectName) return content;

	try {
		const { id, created } = await findOrCreateBlogTask(
			notion,
			subjectName,
			options,
		);
		const artifact = await saveArtifact(
			notion,
			id,
			artifactTitle,
			content,
		);
		const status = created
			? `Created new blog task "${subjectName}"`
			: `Found existing blog task "${subjectName}"`;
		return `${content}\n\n---\nNotion: ${status}. Saved "${artifactTitle}" as sub-page (${artifact.id}).`;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return `${content}\n\n---\nNotion save failed: ${msg}`;
	}
}

// ── Block conversion ─────────────────────────────────────────────────────────

function contentToBlocks(content: string): BlockObjectRequest[] {
	const blocks: BlockObjectRequest[] = [];
	const lines = content.split("\n");

	for (const line of lines) {
		if (line.startsWith("### ")) {
			blocks.push({
				heading_3: { rich_text: toRichText(line.slice(4)) },
			});
		} else if (line.startsWith("## ")) {
			blocks.push({
				heading_2: { rich_text: toRichText(line.slice(3)) },
			});
		} else if (line.startsWith("# ")) {
			blocks.push({
				heading_1: { rich_text: toRichText(line.slice(2)) },
			});
		} else if (line.startsWith("- ")) {
			blocks.push({
				bulleted_list_item: { rich_text: toRichText(line.slice(2)) },
			});
		} else if (/^\d+\.\s/.test(line)) {
			blocks.push({
				numbered_list_item: {
					rich_text: toRichText(line.replace(/^\d+\.\s/, "")),
				},
			});
		} else if (line.startsWith("---")) {
			blocks.push({ divider: {} });
		} else if (line.trim()) {
			blocks.push({
				paragraph: { rich_text: toRichText(line) },
			});
		}
	}

	return blocks;
}

/** Split text into 2000-char chunks for Notion's rich_text limit. */
function toRichText(text: string): Array<{ type: "text"; text: { content: string } }> {
	const chunks: Array<{ type: "text"; text: { content: string } }> = [];
	for (let i = 0; i < text.length; i += 2000) {
		chunks.push({
			type: "text",
			text: { content: text.slice(i, i + 2000) },
		});
	}
	return chunks.length > 0
		? chunks
		: [{ type: "text", text: { content: "" } }];
}

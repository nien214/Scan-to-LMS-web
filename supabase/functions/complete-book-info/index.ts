const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

type PartialBook = Record<string, string>;

type CompletionResult = {
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  pages: string;
  language: string;
  type: string;
  dewey: string;
  initial: string;
};

type BookInfo = CompletionResult;

const normalSystemPrompt = `You are a library cataloging expert.
You MUST return a SINGLE JSON object.
You MUST follow the schema exactly.
Do NOT add explanations, comments, markdown, or code fences.

Use your knowledge of books, publishers, and library classification to accurately categorize books.

SCHEMA:
{
  "isbn": string,
  "title": string (CRITICAL: if book is Chinese, you MUST include BOTH Chinese characters AND English translation in this exact format: "中文书名 (English Translation)"),
  "author": string (CRITICAL: if author name is Chinese, you MUST include BOTH Chinese characters AND English name in this exact format: "中文名 (English Name)") - ALWAYS include if provided in context,
  "publisher": string (CRITICAL: if publisher is Chinese, you MUST include BOTH Chinese characters AND English translation in this exact format: "中文名 (English Translation)"),
  "year": string (YYYY or empty),
  "language": one of ["English","Malay","Chinese","Tamil","Others"],
  "type": one of ["F","NF"],
  "dewey": string (see rules below),
  "initial": exactly 3 uppercase A–Z letters (derive from author's surname)
}

IMPORTANT: If author, publisher, or year are provided in the partial data, YOU MUST include them in your response.
For initial: Take the first 3 letters of the author's SURNAME (last name) in uppercase.

CRITICAL CLASSIFICATION RULES:
1. TYPE CLASSIFICATION:
"F" = ONLY imaginative narrative stories: novels, short stories, poetry, plays.
"NF" = EVERYTHING ELSE: textbooks, biographies, history, science, reference, self-help, cookbooks, travel, business, how-to, academic.

2. DEWEY:
If type = "NF", dewey MUST be numeric, e.g. 500, 540, 641.5, 920.
If type = "F", dewey MUST be one of FE, FM, FC, FT, FO.

3. CHINESE CONTENT:
Always include BOTH Chinese characters and English translation in the exact format:
- title: 中文书名 (English Translation)
- author: 中文名 (English Name)
- publisher: 中文名 (English Translation)`;

const strictSystemPrompt = `You are a library cataloging expert.
This is STRICT MODE. DO NOT GUESS OR INVENT.
You MUST return a SINGLE JSON object.
You MUST follow the schema EXACTLY.
If information is uncertain, return empty strings "".
Do NOT add explanations, comments, markdown, or code fences.

SCHEMA:
{
  "isbn": string,
  "title": string,
  "author": string,
  "publisher": string,
  "year": string,
  "language": one of ["English","Malay","Chinese","Tamil","Others"],
  "type": one of ["F","NF"],
  "dewey": string,
  "initial": exactly 3 uppercase A–Z letters
}

RULES:
- Textbooks, biographies, guides, science, history, business, and cookbooks are ALWAYS NF.
- Fiction is ONLY imaginative narrative work.
- NF Dewey must be numeric only.
- Fiction Dewey must be FE, FM, FC, FT, or FO.
- If content is Chinese, include Chinese characters first and English translation in brackets.
- If author, publisher, or year are provided in the partial data, preserve them.`;

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    },
    ...init
  });
}

function normalizeInitial(input: string): string {
  const letters = input.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!letters) {
    return "";
  }
  if (letters.length >= 3) {
    return letters.slice(0, 3);
  }
  return letters.padEnd(3, "X");
}

function deriveInitial(author: string): string {
  const firstAuthor = author
    .split(",")[0]
    ?.split(" and ")[0]
    ?.trim() ?? "";
  const honorifics = new Set(["dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "prof", "prof.", "sir", "dame"]);
  const words = firstAuthor
    .split(/\s+/)
    .map((part) => part.replace(/[.,]/g, "").trim())
    .filter(Boolean)
    .filter((part) => !honorifics.has(part.toLowerCase()));
  const surname = words.at(-1) ?? words[0] ?? "";
  return normalizeInitial(surname);
}

function normalizeLanguage(input: string, title: string): string {
  const value = input.trim().toLowerCase();
  if (value.includes("english")) return "English";
  if (value.includes("malay") || value.includes("bahasa")) return "Malay";
  if (value.includes("chinese") || value.includes("mandarin")) return "Chinese";
  if (value.includes("tamil")) return "Tamil";

  for (const char of title) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) return "Chinese";
    if (code >= 0x0b80 && code <= 0x0bff) return "Tamil";
  }

  const lowerTitle = title.toLowerCase();
  if (
    lowerTitle.includes("dan ") ||
    lowerTitle.includes("yang ") ||
    lowerTitle.includes("untuk ") ||
    lowerTitle.includes("bahasa")
  ) {
    return "Malay";
  }

  return "English";
}

function inferFallback(title: string): Pick<BookInfo, "language" | "type" | "dewey"> {
  const lower = title.toLowerCase();

  for (const char of title) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) {
      return { language: "Chinese", type: "F", dewey: "FC" };
    }
    if (code >= 0x0b80 && code <= 0x0bff) {
      return { language: "Tamil", type: "F", dewey: "FO" };
    }
  }

  if (
    lower.includes("dan ") ||
    lower.includes("yang ") ||
    lower.includes("untuk ") ||
    lower.includes("bahasa")
  ) {
    return { language: "Malay", type: "F", dewey: "FM" };
  }

  if (
    lower.includes("history") ||
    lower.includes("guide") ||
    lower.includes("introduction") ||
    lower.includes("manual")
  ) {
    return { language: "English", type: "NF", dewey: "000" };
  }

  return { language: "English", type: "F", dewey: "FE" };
}

function buildPrompt(isbn: string, context: string): string {
  return `You are a library cataloging expert. Based on the ISBN and book information provided, classify this book correctly.

${context}

Your task:
- Determine the correct book type: F or NF.
- Assign the correct Dewey code.
- Preserve author, publisher, and year from the partial metadata when supplied.
- Return ONLY JSON.`;
}

function extractJSON(text: string): string | null {
  let value = text.trim();
  if (value.startsWith("```")) {
    value = value.replaceAll("```json", "").replaceAll("```", "").trim();
  }
  return value.startsWith("{") ? value : null;
}

function parseModelOutput(
  content: string,
  partial: PartialBook,
  allowModelMetadataWithoutPartial: boolean
): CompletionResult | null {
  const jsonText = extractJSON(content);
  if (!jsonText) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const rawType = String(parsed.type ?? "");
  const validType = rawType === "F" || rawType === "NF" ? rawType : "";
  let dewey = String(parsed.dewey ?? "").trim();

  if (validType === "NF") {
    dewey = dewey.replace(/nf/gi, "").trim();
    const filtered = dewey.replace(/[^\d.]/g, "");
    dewey = /^\d+(\.\d+)?$/.test(dewey) ? dewey : /^\d+(\.\d+)?$/.test(filtered) ? filtered : "";
    const leading = Number((dewey.split(".")[0] ?? "").trim());
    if (dewey && (Number.isNaN(leading) || leading < 0 || leading >= 1000)) {
      dewey = "";
    }
  } else if (validType === "F") {
    const letters = dewey.replace(/[^A-Za-z]/g, "").toUpperCase();
    const validFictionCodes = ["FE", "FM", "FC", "FT", "FO"];
    if (validFictionCodes.includes(letters)) {
      dewey = letters;
    } else {
      const language = String(parsed.language ?? "");
      if (language === "English") dewey = "FE";
      else if (language === "Malay") dewey = "FM";
      else if (language === "Chinese") dewey = "FC";
      else if (language === "Tamil") dewey = "FT";
      else if (language) dewey = "FO";
      else dewey = "";
    }
  } else {
    dewey = "";
  }

  const partialAuthor = partial.author ?? "";
  const partialPublisher = partial.publisher ?? "";
  const partialYear = partial.year ?? "";
  const gptAuthor = String(parsed.author ?? "");
  const gptPublisher = String(parsed.publisher ?? "");
  const gptYear = String(parsed.year ?? "");

  const hasPartial = Object.keys(partial).length > 0;
  const canTrustModelMetadata = hasPartial || allowModelMetadataWithoutPartial;

  const author = partialAuthor || (canTrustModelMetadata ? gptAuthor : "");
  const publisher = partialPublisher || (canTrustModelMetadata ? gptPublisher : "");
  const year = partialYear || (canTrustModelMetadata ? gptYear : "");
  const rawInitial = String(parsed.initial ?? "");

  return {
    isbn: String(parsed.isbn ?? ""),
    title: canTrustModelMetadata ? String(parsed.title ?? "") : "",
    author,
    publisher,
    year,
    pages: "",
    language: normalizeLanguage(String(parsed.language ?? ""), String(parsed.title ?? "")),
    type: validType,
    dewey,
    initial: rawInitial ? normalizeInitial(rawInitial) : author ? deriveInitial(author) : ""
  };
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "scan-to-lms-web/1.0"
    }
  });

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

async function fetchOpenLibrary(isbn: string): Promise<BookInfo | null> {
  const edition = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!edition) {
    return null;
  }

  const title = String(edition.title ?? "");
  const publishers = Array.isArray(edition.publishers) ? edition.publishers : [];
  const publisher = String(publishers[0] ?? "");
  const publishDate = String(edition.publish_date ?? "");
  const year = publishDate.split(/\D+/).filter(Boolean).at(-1) ?? "";
  const pages = typeof edition.number_of_pages === "number" ? String(edition.number_of_pages) : "";

  let author = "";
  const works = Array.isArray(edition.works) ? edition.works : [];
  const workKey = works[0] && typeof works[0] === "object" ? String((works[0] as Record<string, unknown>).key ?? "") : "";

  if (workKey) {
    const work = await fetchJson(`https://openlibrary.org${workKey}.json`);
    if (work && Array.isArray(work.authors)) {
      const authorNames: string[] = [];
      for (const entry of work.authors) {
        if (!entry || typeof entry !== "object") continue;
        const authorKey = String(((entry as Record<string, unknown>).author as Record<string, unknown> | undefined)?.key ?? "");
        if (!authorKey) continue;
        const authorDoc = await fetchJson(`https://openlibrary.org${authorKey}.json`);
        if (authorDoc?.name) {
          authorNames.push(String(authorDoc.name));
        }
      }
      author = authorNames.join(", ");
    }
  }

  if (!author && title) {
    const search = await fetchJson(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&isbn=${encodeURIComponent(isbn)}&limit=1`
    );
    const docs = Array.isArray(search?.docs) ? search?.docs : [];
    const authorNames = Array.isArray(docs[0] && typeof docs[0] === "object" ? (docs[0] as Record<string, unknown>).author_name : [])
      ? ((docs[0] as Record<string, unknown>).author_name as unknown[]).map((value) => String(value))
      : [];
    author = authorNames.join(", ");
  }

  return {
    isbn,
    title,
    author,
    publisher,
    year,
    pages,
    language: "",
    type: "",
    dewey: "",
    initial: deriveInitial(author)
  };
}

async function fetchGoogleBooks(isbn: string): Promise<BookInfo | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}&maxResults=1`;
  const root = await fetchJson(url);
  const items = Array.isArray(root?.items) ? root.items : [];
  const info =
    items[0] && typeof items[0] === "object"
      ? ((items[0] as Record<string, unknown>).volumeInfo as Record<string, unknown> | undefined)
      : undefined;

  if (!info) {
    return null;
  }

  const title = String(info.title ?? "");
  const authors = Array.isArray(info.authors) ? info.authors.map((value) => String(value)).join(", ") : "";
  const publisher = String(info.publisher ?? "");
  const year = String(info.publishedDate ?? "").slice(0, 4);
  const pages = typeof info.pageCount === "number" ? String(info.pageCount) : "";

  return {
    isbn,
    title,
    author: authors,
    publisher,
    year,
    pages,
    language: "",
    type: "",
    dewey: "",
    initial: deriveInitial(authors)
  };
}

function extractXmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
  return match?.[1]?.trim() ?? "";
}

async function fetchWorldCat(isbn: string): Promise<BookInfo | null> {
  const query = encodeURIComponent(`srw.bn=${isbn}`);
  const response = await fetch(
    `https://www.worldcat.org/webservices/catalog/search/sru?query=${query}&wskey=&frbrGrouping=off&recordSchema=info:srw/schema/1/dc`,
    {
      headers: {
        "User-Agent": "scan-to-lms-web/1.0"
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  const xml = await response.text();
  const title = extractXmlValue(xml, "dc:title");
  if (!title) {
    return null;
  }

  const author = extractXmlValue(xml, "dc:creator");
  const publisher = extractXmlValue(xml, "dc:publisher");
  const year = extractXmlValue(xml, "dc:date").slice(0, 4);

  return {
    isbn,
    title,
    author,
    publisher,
    year,
    pages: "",
    language: "",
    type: "",
    dewey: "",
    initial: deriveInitial(author)
  };
}

async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  prompt: string,
  partial: PartialBook,
  allowModelMetadataWithoutPartial: boolean
): Promise<CompletionResult | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat/completions failed with ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return null;
  }

  return parseModelOutput(content, partial, allowModelMetadataWithoutPartial);
}

async function callOpenAIWithWebSearch(
  apiKey: string,
  systemPrompt: string,
  prompt: string,
  partial: PartialBook
): Promise<CompletionResult | null> {
  const toolVariants = ["web_search", "web_search_preview"];

  for (const toolType of toolVariants) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [{ type: "text", text: systemPrompt }]
          },
          {
            role: "user",
            content: [{ type: "text", text: prompt }]
          }
        ],
        tools: [{ type: toolType }],
        temperature: 0.2,
        max_output_tokens: 700
      })
    });

    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    if (typeof data.output_text === "string") {
      const parsed = parseModelOutput(data.output_text, partial, true);
      if (parsed) {
        return parsed;
      }
    }

    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!item || typeof item !== "object" || !Array.isArray(item.content)) {
          continue;
        }
        for (const content of item.content) {
          if (content?.text) {
            const parsed = parseModelOutput(String(content.text), partial, true);
            if (parsed) {
              return parsed;
            }
          }
        }
      }
    }
  }

  return null;
}

async function completeBookInfo(isbn: string): Promise<CompletionResult> {
  const openAIKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAIKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  let collected: BookInfo | null = null;
  const [openLibrary, googleBooks] = await Promise.allSettled([
    fetchOpenLibrary(isbn),
    fetchGoogleBooks(isbn)
  ]);

  const openLib = openLibrary.status === "fulfilled" ? openLibrary.value : null;
  const google = googleBooks.status === "fulfilled" ? googleBooks.value : null;

  if (openLib || google) {
    collected = {
      isbn,
      title: openLib?.title || google?.title || "",
      author: openLib?.author || google?.author || "",
      publisher: google?.publisher || openLib?.publisher || "",
      year: google?.year || openLib?.year || "",
      pages: google?.pages || openLib?.pages || "",
      language: openLib?.language || google?.language || "",
      type: openLib?.type || google?.type || "",
      dewey: openLib?.dewey || google?.dewey || "",
      initial: openLib?.initial || google?.initial || ""
    };
  }

  if (collected && (!collected.title || !collected.author)) {
    const worldcat = await fetchWorldCat(isbn).catch(() => null);
    if (worldcat) {
      collected = {
        isbn,
        title: collected.title || worldcat.title,
        author: collected.author || worldcat.author,
        publisher: collected.publisher || worldcat.publisher,
        year: collected.year || worldcat.year,
        pages: collected.pages || worldcat.pages,
        language: collected.language,
        type: collected.type,
        dewey: collected.dewey,
        initial: collected.initial || worldcat.initial
      };
    }
  } else if (!collected) {
    collected = await fetchWorldCat(isbn).catch(() => null);
  }

  const partial: PartialBook = collected
    ? Object.fromEntries(
        Object.entries({
          title: collected.title,
          author: collected.author,
          publisher: collected.publisher,
          year: collected.year
        }).filter(([, value]) => Boolean(value))
      )
    : {};

  const hasReliablePartial = Object.keys(partial).length > 0;
  const prompt = buildPrompt(
    isbn,
    `ISBN: ${isbn}${
      hasReliablePartial
        ? `\nPartial data:\n${Object.entries(partial)
            .map(([key, value]) => `- ${key}: ${value}`)
            .join("\n")}`
        : ""
    }`
  );

  let gptResult: CompletionResult | null = null;
  if (hasReliablePartial) {
    gptResult = await callOpenAI(openAIKey, normalSystemPrompt, prompt, partial, false).catch(() => null);
  } else {
    gptResult = await callOpenAIWithWebSearch(openAIKey, strictSystemPrompt, prompt, partial).catch(() => null);
  }

  if (!gptResult) {
    gptResult = await callOpenAI(openAIKey, strictSystemPrompt, prompt, partial, false).catch(() => null);
  }

  if (gptResult) {
    const author = collected?.author || gptResult.author;
    return {
      isbn,
      title: collected?.title || gptResult.title,
      author,
      publisher: collected?.publisher || gptResult.publisher,
      year: collected?.year || gptResult.year,
      pages: collected?.pages || gptResult.pages,
      language: collected?.language || gptResult.language,
      type: collected?.type || gptResult.type,
      dewey: collected?.dewey || gptResult.dewey,
      initial: collected?.initial || gptResult.initial || deriveInitial(author)
    };
  }

  if (collected) {
    const fallback = inferFallback(collected.title);
    return {
      isbn,
      title: collected.title,
      author: collected.author,
      publisher: collected.publisher,
      year: collected.year,
      pages: collected.pages,
      language: collected.language || fallback.language,
      type: collected.type || fallback.type,
      dewey: collected.dewey || fallback.dewey,
      initial: collected.initial || deriveInitial(collected.author)
    };
  }

  return {
    isbn,
    title: "",
    author: "",
    publisher: "",
    year: "",
    pages: "",
    language: "Others",
    type: "",
    dewey: "",
    initial: ""
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { isbn } = await request.json();
    if (!isbn || typeof isbn !== "string") {
      return jsonResponse({ error: "ISBN is required" }, { status: 400 });
    }

    const result = await completeBookInfo(isbn.replace(/[^\dXx]/g, "").toUpperCase());
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, { status: 500 });
  }
});

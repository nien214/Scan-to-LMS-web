import type {
  BookDraft,
  BookLanguage,
  BookRecord,
  BooksFilterState,
  ProcessedBookRecord,
} from "../types";

export function normalizeIsbn(value: string): string {
  const digits = value.replace(/[^\dXx]/g, "").toUpperCase();
  return digits.slice(0, 13);
}

export function normalizeInitial(initial: string): string {
  const letters = initial.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!letters) {
    return "";
  }
  if (letters.length >= 3) {
    return letters.slice(0, 3);
  }
  return letters.padEnd(3, "X");
}

export function deriveInitial(authors: string): string {
  const first = authors.split(",")[0]?.trim() ?? "";
  const token = first.split(/\s+/).filter(Boolean).at(-1) ?? "";
  return normalizeInitial(token);
}

export function normalizeDraft(draft: BookDraft, rejected: boolean): BookDraft {
  const normalizedInitial =
    draft.initial && draft.initial !== "XXX"
      ? normalizeInitial(draft.initial)
      : draft.author
        ? deriveInitial(draft.author)
        : "";

  return {
    ...draft,
    isbn: normalizeIsbn(draft.isbn),
    title: draft.title.trim(),
    author: draft.author.trim(),
    publisher: draft.publisher.trim(),
    year: draft.year.trim(),
    pages: draft.pages.trim(),
    price: draft.price.trim(),
    language: draft.language,
    type: draft.type,
    dewey: draft.dewey.trim(),
    initial: normalizedInitial,
    quantity: Math.max(1, Number(draft.quantity) || 1),
    isRejected: rejected,
  };
}

export function isBookIncomplete(
  book: Pick<
    BookDraft,
    | "title"
    | "author"
    | "publisher"
    | "year"
    | "pages"
    | "price"
    | "language"
    | "type"
    | "dewey"
    | "initial"
  >,
): boolean {
  return (
    !book.title ||
    !book.author ||
    !book.publisher ||
    !book.year ||
    !book.pages ||
    !book.price ||
    !book.language ||
    !book.type ||
    !book.dewey ||
    !book.initial
  );
}

export function inferFallback(title: string): {
  language: BookLanguage;
  type: "F" | "NF";
  dewey: string;
} {
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

export function sortBooks(books: BookRecord[]): BookRecord[] {
  return [...books].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function getHeaderTitle(filters: BooksFilterState): string {
  const hiddenCount = Object.entries(filters).filter(
    ([key, value]) => key !== "isShowFlaggedOnlyMode" && value,
  ).length;
  if (hiddenCount === 0) {
    return "All Books";
  }

  const shown: string[] = [];
  if (!filters.hideAcceptedBooks) {
    shown.push("Accepted");
  }
  if (!filters.hideIncompleteBooks) {
    shown.push("Need Review");
  }
  if (!filters.hideRejectedBooks) {
    shown.push("Rejected");
  }
  if (!filters.hideFlaggedBooks) {
    shown.push("Flagged");
  }

  if (shown.length === 0) {
    return "No Books (All Hidden)";
  }

  if (shown.length === 1) {
    return `${shown[0]} Books`;
  }

  return shown.join(", ");
}

export function shouldHideBook(
  book: BookRecord,
  filters: BooksFilterState,
): boolean {
  const incomplete = isBookIncomplete(book);
  const accepted = !book.isRejected && !incomplete;

  if (filters.isShowFlaggedOnlyMode) {
    return !book.isFlagged;
  }

  const hideForRejected = book.isRejected && filters.hideRejectedBooks;
  const hideForAccepted = accepted && filters.hideAcceptedBooks;
  const hideForIncomplete =
    incomplete && !book.isRejected && filters.hideIncompleteBooks;
  const hideForFlagged = book.isFlagged && filters.hideFlaggedBooks;

  return (
    hideForRejected || hideForAccepted || hideForIncomplete || hideForFlagged
  );
}

export function toCsv(books: BookRecord[]): string {
  const headers = [
    "ISBN",
    "Title",
    "Author",
    "Publisher",
    "Year",
    "Pages",
    "Price",
    "Language",
    "Type",
    "Dewey",
    "Initial",
    "Quantity",
  ];

  const rows = books.map((book) =>
    [
      book.isbn,
      book.title,
      book.author,
      book.publisher,
      book.year,
      book.pages,
      book.price,
      book.language,
      book.type,
      book.dewey,
      book.initial,
      String(book.quantity),
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

export async function shareOrDownloadCsv(
  filename: string,
  csv: string,
): Promise<void> {
  const file = new File([csv], filename, { type: "text/csv;charset=utf-8" });
  if (
    typeof navigator !== "undefined" &&
    "canShare" in navigator &&
    navigator.canShare?.({ files: [file] })
  ) {
    await navigator.share({ files: [file], title: filename });
    return;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function timestampFilename(prefix: string): string {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `${prefix}_${parts.join("")}.csv`;
}

const PROCESSED_BOOK_FIELD_KEYS: Array<keyof ProcessedBookRecord> = [
  "noPerolehan",
  "isbn",
  "title",
  "author",
  "publisher",
  "year",
  "pages",
  "price",
  "language",
  "type",
  "dewey",
  "initial",
  "quantity",
];

const PROCESSED_BOOK_HEADER_LABELS = [
  "No Perolehan",
  "ISBN",
  "Title",
  "Author",
  "Publisher",
  "Year",
  "Pages",
  "Price",
  "Language",
  "Type",
  "Dewey",
  "Initial",
  "Quantity",
] as const;

function normalizeProcessedBookHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeProcessedBookCell(value: unknown): string {
  return String(value ?? "").trim();
}

function validateProcessedBookHeaders(headerRow: unknown[]): void {
  const actualHeaders = headerRow.map((cell) => normalizeProcessedBookCell(cell));
  const normalizedHeaders = actualHeaders.map((header) =>
    normalizeProcessedBookHeader(header),
  );

  const hasExpectedHeaders = PROCESSED_BOOK_HEADER_LABELS.every(
    (expectedHeader, index) =>
      normalizedHeaders[index] === normalizeProcessedBookHeader(expectedHeader),
  );
  const hasOnlyEmptyTrailingHeaders = normalizedHeaders
    .slice(PROCESSED_BOOK_HEADER_LABELS.length)
    .every((header) => header.length === 0);

  if (hasExpectedHeaders && hasOnlyEmptyTrailingHeaders) {
    return;
  }

  throw new Error(
    `Invalid database headers. Expected: ${PROCESSED_BOOK_HEADER_LABELS.join(", ")}`,
  );
}

export function parseProcessedBooksTable(rows: Array<unknown[]>): ProcessedBookRecord[] {
  const [headerRow, ...dataRows] = rows.filter((row) =>
    row.some((cell) => normalizeProcessedBookCell(cell).length > 0),
  );

  if (!headerRow) {
    return [];
  }

  validateProcessedBookHeaders(headerRow);

  return dataRows
    .map((row) => {
      const values = PROCESSED_BOOK_FIELD_KEYS.map((_, index) =>
        normalizeProcessedBookCell(row[index]),
      );

      return {
        noPerolehan: values[0],
        isbn: values[1],
        title: values[2],
        author: values[3],
        publisher: values[4],
        year: values[5],
        pages: values[6],
        price: values[7],
        language: values[8],
        type: values[9],
        dewey: values[10],
        initial: values[11],
        quantity: values[12],
      };
    })
    .filter((book) => book.isbn.length > 0);
}

function parseCsvRow(row: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];

    if (char === '"') {
      const nextChar = row[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

export function parseProcessedBooksCsv(csv: string): ProcessedBookRecord[] {
  const rows = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((row) => row.trim().length > 0)
    .map((row) => parseCsvRow(row));

  return parseProcessedBooksTable(rows);
}

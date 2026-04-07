import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProcessedBookRecord } from "../types";
import { parseProcessedBooksCsv, parseProcessedBooksTable } from "./utils";

const PROCESSED_DATABASE_BUCKET = "processed-database";
const PROCESSED_DATABASE_METADATA_KEY = "latest";
const PROCESSED_DATABASE_METADATA_TABLE = "processed_database_files";
const LEGACY_PROCESSED_DATABASE_INDEXED_DB_NAME = "scan-to-lms";
const INLINE_PROCESSED_DATABASE_PREFIX = "inline-json:";

type ProcessedDatabaseMetadataRow = {
  key: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  uploaded_at: string;
};

export const PROCESSED_DATABASE_FILE_ACCEPT = ".csv,.xlsx,.xls";

export type SharedProcessedDatabase = {
  fileName: string;
  mimeType: string;
  storagePath: string;
  uploadedAt: string;
  records: ProcessedBookRecord[];
};

function getProcessedDatabaseExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function guessProcessedDatabaseMimeType(fileName: string): string {
  const extension = getProcessedDatabaseExtension(fileName);
  if (extension === "csv") {
    return "text/csv";
  }
  if (extension === "xls") {
    return "application/vnd.ms-excel";
  }
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export function isSupportedProcessedDatabaseFile(file: File): boolean {
  return ["csv", "xlsx", "xls"].includes(
    getProcessedDatabaseExtension(file.name),
  );
}

function coerceProcessedBookRecord(
  record: Partial<ProcessedBookRecord> | null | undefined,
): ProcessedBookRecord {
  return {
    noPerolehan: String(record?.noPerolehan ?? ""),
    isbn: String(record?.isbn ?? ""),
    title: String(record?.title ?? ""),
    author: String(record?.author ?? ""),
    publisher: String(record?.publisher ?? ""),
    year: String(record?.year ?? ""),
    pages: String(record?.pages ?? ""),
    price: String(record?.price ?? ""),
    language: String(record?.language ?? ""),
    type: String(record?.type ?? ""),
    dewey: String(record?.dewey ?? ""),
    initial: String(record?.initial ?? ""),
    quantity: String(record?.quantity ?? ""),
  };
}

function serializeInlineProcessedDatabase(
  records: ProcessedBookRecord[],
): string {
  return `${INLINE_PROCESSED_DATABASE_PREFIX}${JSON.stringify(records)}`;
}

function parseInlineProcessedDatabase(
  value: string,
): ProcessedBookRecord[] | null {
  if (!value.startsWith(INLINE_PROCESSED_DATABASE_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      value.slice(INLINE_PROCESSED_DATABASE_PREFIX.length),
    ) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((record) =>
        coerceProcessedBookRecord(
          record && typeof record === "object"
            ? (record as Partial<ProcessedBookRecord>)
            : null,
        ),
      )
      .filter((record) => record.isbn.length > 0);
  } catch (error) {
    console.error("Unable to parse inline processed database payload", error);
    return [];
  }
}

async function parseProcessedDatabaseBlob(
  fileName: string,
  blob: Blob,
): Promise<ProcessedBookRecord[]> {
  const extension = getProcessedDatabaseExtension(fileName);

  if (extension === "csv") {
    return parseProcessedBooksCsv(await blob.text());
  }

  if (extension === "xlsx" || extension === "xls") {
    const { read, utils: xlsxUtils } = await import("xlsx");
    const workbook = read(await blob.arrayBuffer(), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return [];
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rows = xlsxUtils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    }) as Array<unknown[]>;

    return parseProcessedBooksTable(rows);
  }

  throw new Error("Upload a CSV or Excel file.");
}

export async function parseProcessedDatabaseFile(
  file: File,
): Promise<ProcessedBookRecord[]> {
  return parseProcessedDatabaseBlob(file.name, file);
}

export async function loadProcessedDatabaseFromSupabase(
  client: SupabaseClient,
): Promise<SharedProcessedDatabase | null> {
  const { data: metadata, error: metadataError } = await client
    .from(PROCESSED_DATABASE_METADATA_TABLE)
    .select("key, file_name, mime_type, storage_path, uploaded_at")
    .eq("key", PROCESSED_DATABASE_METADATA_KEY)
    .maybeSingle<ProcessedDatabaseMetadataRow>();

  if (metadataError) {
    throw metadataError;
  }

  if (!metadata) {
    return null;
  }

  const inlineRecords = parseInlineProcessedDatabase(metadata.storage_path);
  if (inlineRecords) {
    return {
      fileName: metadata.file_name,
      mimeType: metadata.mime_type,
      storagePath: metadata.storage_path,
      uploadedAt: metadata.uploaded_at,
      records: inlineRecords,
    };
  }

  const { data: blob, error: downloadError } = await client.storage
    .from(PROCESSED_DATABASE_BUCKET)
    .download(metadata.storage_path);

  if (downloadError) {
    throw downloadError;
  }

  return {
    fileName: metadata.file_name,
    mimeType: metadata.mime_type,
    storagePath: metadata.storage_path,
    uploadedAt: metadata.uploaded_at,
    records: await parseProcessedDatabaseBlob(metadata.file_name, blob),
  };
}

export async function uploadProcessedDatabaseToSupabase(
  client: SupabaseClient,
  file: File,
  records: ProcessedBookRecord[],
): Promise<SharedProcessedDatabase> {
  const mimeType = file.type || guessProcessedDatabaseMimeType(file.name);
  const storagePath = serializeInlineProcessedDatabase(records);
  const uploadedAt = new Date().toISOString();

  const { error: metadataError } = await client
    .from(PROCESSED_DATABASE_METADATA_TABLE)
    .upsert(
      {
        key: PROCESSED_DATABASE_METADATA_KEY,
        file_name: file.name,
        mime_type: mimeType,
        storage_path: storagePath,
        uploaded_at: uploadedAt,
      },
      { onConflict: "key" },
    );

  if (metadataError) {
    throw metadataError;
  }

  return {
    fileName: file.name,
    mimeType,
    storagePath,
    uploadedAt,
    records,
  };
}

function clearLegacyProcessedDatabaseIndexedDb(): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(
      LEGACY_PROCESSED_DATABASE_INDEXED_DB_NAME,
    );

    request.addEventListener("success", () => resolve());
    request.addEventListener("blocked", () => resolve());
    request.addEventListener("error", () => resolve());
  });
}

async function clearProcessedDatabaseCacheStorage(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return;
  }

  const cacheNames = await window.caches.keys();

  await Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await window.caches.open(cacheName);
      const requests = await cache.keys();

      await Promise.all(
        requests
          .filter((request) => {
            const url = request.url;
            return (
              url.includes("/storage/v1/object/") &&
              url.includes(`/${PROCESSED_DATABASE_BUCKET}/`)
            );
          })
          .map((request) => cache.delete(request)),
      );
    }),
  );
}

export async function clearProcessedDatabaseClientCache(): Promise<void> {
  await Promise.all([
    clearLegacyProcessedDatabaseIndexedDb(),
    clearProcessedDatabaseCacheStorage(),
  ]);
}

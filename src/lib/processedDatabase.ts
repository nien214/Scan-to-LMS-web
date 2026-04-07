import type { ProcessedBookRecord } from "../types";
import { parseProcessedBooksCsv, parseProcessedBooksTable } from "./utils";

const INDEXED_DB_NAME = "scan-to-lms";
const INDEXED_DB_VERSION = 1;
const INDEXED_DB_STORE_NAME = "processed-database";
const INDEXED_DB_LATEST_KEY = "latest";

export const PROCESSED_DATABASE_FILE_ACCEPT = ".csv,.xlsx,.xls";

export type StoredProcessedDatabase = {
  fileName: string;
  mimeType: string;
  uploadedAt: string;
  records: ProcessedBookRecord[];
};

type StoredProcessedDatabaseEntry = StoredProcessedDatabase & {
  id: typeof INDEXED_DB_LATEST_KEY;
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

function openProcessedDatabaseStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(INDEXED_DB_STORE_NAME)) {
        database.createObjectStore(INDEXED_DB_STORE_NAME, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Failed to open processed database store."));
    });
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    });
  });
}

function blobToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to encode uploaded database file."));
        return;
      }

      const [, base64 = ""] = reader.result.split(",", 2);
      resolve(base64);
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Unable to read uploaded database file."));
    });

    reader.readAsDataURL(file);
  });
}

export function isSupportedProcessedDatabaseFile(file: File): boolean {
  return ["csv", "xlsx", "xls"].includes(
    getProcessedDatabaseExtension(file.name),
  );
}

export async function parseProcessedDatabaseFile(
  file: File,
): Promise<ProcessedBookRecord[]> {
  const extension = getProcessedDatabaseExtension(file.name);

  if (extension === "csv") {
    return parseProcessedBooksCsv(await file.text());
  }

  if (extension === "xlsx" || extension === "xls") {
    const { read, utils: xlsxUtils } = await import("xlsx");
    const workbook = read(await file.arrayBuffer(), { type: "array" });
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

export async function loadStoredProcessedDatabase(): Promise<StoredProcessedDatabase | null> {
  const database = await openProcessedDatabaseStore();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(INDEXED_DB_STORE_NAME, "readonly");
      const request = transaction
        .objectStore(INDEXED_DB_STORE_NAME)
        .get(INDEXED_DB_LATEST_KEY);

      request.addEventListener("success", () => {
        const entry = request.result as StoredProcessedDatabaseEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }

        resolve({
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          uploadedAt: entry.uploadedAt,
          records: entry.records,
        });
      });
      request.addEventListener("error", () => {
        reject(
          request.error ?? new Error("Failed to read the stored processed database."),
        );
      });
    });
  } finally {
    database.close();
  }
}

export async function saveStoredProcessedDatabase(
  file: File,
  records: ProcessedBookRecord[],
): Promise<StoredProcessedDatabase> {
  const database = await openProcessedDatabaseStore();
  const uploadedAt = new Date().toISOString();

  try {
    const transaction = database.transaction(INDEXED_DB_STORE_NAME, "readwrite");
    const entry: StoredProcessedDatabaseEntry = {
      id: INDEXED_DB_LATEST_KEY,
      fileName: file.name,
      mimeType: file.type || guessProcessedDatabaseMimeType(file.name),
      uploadedAt,
      records,
    };

    transaction.objectStore(INDEXED_DB_STORE_NAME).put(entry);
    await waitForTransaction(transaction);

    return {
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      uploadedAt: entry.uploadedAt,
      records: entry.records,
    };
  } finally {
    database.close();
  }
}

export async function mirrorProcessedDatabaseToSource(file: File): Promise<{
  fileName: string;
  path: string;
}> {
  const endpoint = new URL(
    "api/processed-database",
    `${window.location.origin}${import.meta.env.BASE_URL}`,
  ).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || guessProcessedDatabaseMimeType(file.name),
      contentBase64: await blobToBase64(file),
    }),
  });

  if (!response.ok) {
    throw new Error("Source mirror endpoint is unavailable.");
  }

  const payload = (await response.json()) as { fileName: string; path: string };
  return payload;
}

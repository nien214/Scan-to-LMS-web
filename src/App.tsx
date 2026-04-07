import {
  Suspense,
  type ChangeEvent,
  lazy,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ellipsis,
  Eye,
  Flag,
  LoaderCircle,
  ScanLine,
  Search,
  SquareArrowOutUpRight,
  Trash2,
  Upload,
} from "lucide-react";
import bundledProcessedBooksCsv from "./components/book.csv?raw";
import {
  clearProcessedDatabaseClientCache,
  getProcessedDatabaseErrorMessage,
  PROCESSED_DATABASE_FILE_ACCEPT,
  isSupportedProcessedDatabaseFile,
  loadProcessedDatabaseFromSupabase,
  parseProcessedDatabaseFile,
  uploadProcessedDatabaseToSupabase,
} from "./lib/processedDatabase";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import {
  deriveInitial,
  getHeaderTitle,
  inferFallback,
  isBookIncomplete,
  normalizeDraft,
  normalizeIsbn,
  parseProcessedBooksCsv,
  shareOrDownloadCsv,
  shouldHideBook,
  sortBooks,
  timestampFilename,
  toCsv,
} from "./lib/utils";
import type {
  BookDraft,
  BookRecord,
  BooksFilterState,
  CompletionResult,
  ProcessedBookRecord,
} from "./types";
import { defaultFilters } from "./types";

const ScannerSheet = lazy(() =>
  import("./components/ScannerSheet").then((module) => ({
    default: module.ScannerSheet,
  })),
);

const DetailSheet = lazy(() =>
  import("./components/DetailSheet").then((module) => ({
    default: module.DetailSheet,
  })),
);

type DatabaseBook = {
  id: string;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  pages: string;
  price: string;
  language: string;
  type: string;
  dewey: string;
  initial: string;
  quantity: number;
  is_rejected: boolean;
  is_flagged: boolean;
  created_at: string;
  updated_at: string;
};

type MenuState = "filters" | "export" | "clear" | null;
type DetailState = {
  draft: BookDraft;
  isCurrentlyRejected: boolean;
};
type QuickFilterMode = "accepted" | "review" | "rejected" | "flagged";
type AppView = "home" | "processed-check" | "processed-results";
type ScannerMode = "library" | "processed-check";
type ProcessedDatabaseState = {
  fileName: string;
  rowCount: number;
  uploadedAt: string | null;
  source: "bundled" | "supabase";
};

const SUPABASE_CONFIG_MESSAGE =
  "Add VITE_SUPABASE_ANON_KEY to connect this web app to your Supabase project.";
const PROCESSED_BOOK_RESULT_ALERT_DELAY_MS = 450;
const PROCESSED_BOOK_FIELDS: Array<{
  key: keyof ProcessedBookRecord;
  label: string;
}> = [
  { key: "noPerolehan", label: "No Perolehan" },
  { key: "isbn", label: "ISBN" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "publisher", label: "Publisher" },
  { key: "year", label: "Year" },
  { key: "pages", label: "Pages" },
  { key: "price", label: "Price" },
  { key: "language", label: "Language" },
  { key: "type", label: "Type" },
  { key: "dewey", label: "Dewey" },
  { key: "initial", label: "Initial" },
  { key: "quantity", label: "Quantity" },
];

export default function App() {
  const bundledProcessedBooks = useMemo(
    () => parseProcessedBooksCsv(bundledProcessedBooksCsv),
    [],
  );
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(
    hasSupabaseConfig ? null : SUPABASE_CONFIG_MESSAGE,
  );
  const [filters, setFilters] = useState<BooksFilterState>(defaultFilters);
  const [toast, setToast] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerStatus, setScannerStatus] = useState(
    "Position barcode in frame",
  );
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [menuState, setMenuState] = useState<MenuState>(null);
  const [rowMenuBook, setRowMenuBook] = useState<BookRecord | null>(null);
  const [appView, setAppView] = useState<AppView>("home");
  const [scannerMode, setScannerMode] = useState<ScannerMode>("library");
  const [processedLookupIsbn, setProcessedLookupIsbn] = useState("");
  const [processedBookResults, setProcessedBookResults] = useState<
    ProcessedBookRecord[]
  >([]);
  const [processedBooks, setProcessedBooks] = useState<ProcessedBookRecord[]>(
    () => bundledProcessedBooks,
  );
  const [processedDatabaseState, setProcessedDatabaseState] =
    useState<ProcessedDatabaseState>(() => ({
      fileName: "book.csv",
      rowCount: bundledProcessedBooks.length,
      uploadedAt: null,
      source: "bundled",
    }));
  const [processedDatabaseReady, setProcessedDatabaseReady] = useState(false);
  const [processedDatabaseUploading, setProcessedDatabaseUploading] =
    useState(false);
  const processedDatabaseInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void clearProcessedDatabaseClientCache();
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!hasSupabaseConfig || !client) {
      setIsLoading(false);
      return;
    }

    void loadBooks();

    const channel = client
      .channel("public-books")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books" },
        () => {
          void loadBooks(false);
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setToast(detail);
    };

    window.addEventListener("scan-to-lms:toast", onToast as EventListener);
    return () => {
      window.removeEventListener("scan-to-lms:toast", onToast as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const sortedBooks = useMemo(() => sortBooks(books), [books]);
  const processedBooksByIsbn = useMemo(() => {
    const lookup = new Map<string, ProcessedBookRecord[]>();

    for (const book of processedBooks) {
      const normalized = normalizeIsbn(book.isbn);
      if (!normalized) {
        continue;
      }

      const existing = lookup.get(normalized);
      if (existing) {
        existing.push(book);
      } else {
        lookup.set(normalized, [book]);
      }
    }

    return lookup;
  }, [processedBooks]);
  const visibleBooks = useMemo(
    () => sortedBooks.filter((book) => !shouldHideBook(book, filters)),
    [filters, sortedBooks],
  );
  const acceptedBooks = useMemo(
    () => books.filter((book) => !book.isRejected),
    [books],
  );
  const rejectedBooks = useMemo(
    () => books.filter((book) => book.isRejected),
    [books],
  );
  const flaggedBooks = useMemo(
    () => books.filter((book) => book.isFlagged),
    [books],
  );
  const needReviewBooks = useMemo(
    () => books.filter((book) => !book.isRejected && isBookIncomplete(book)),
    [books],
  );
  const headerTitle = useMemo(() => getHeaderTitle(filters), [filters]);
  const detailExistingBook = detailState
    ? (books.find((entry) => entry.isbn === detailState.draft.isbn) ?? null)
    : null;
  const processedDatabaseSummary = useMemo(() => {
    if (!processedDatabaseReady) {
      return "Loading processed database...";
    }

    const details = [
      `${processedDatabaseState.rowCount.toLocaleString()} rows`,
      processedDatabaseState.source === "supabase" &&
      processedDatabaseState.uploadedAt
        ? `Synced ${new Date(processedDatabaseState.uploadedAt).toLocaleString()}`
        : "Bundled fallback",
    ];

    return `Current database: ${processedDatabaseState.fileName} • ${details.join(" • ")}`;
  }, [processedDatabaseReady, processedDatabaseState]);

  useEffect(() => {
    let ignore = false;

    const applyBundledProcessedDatabase = () => {
      if (ignore) {
        return;
      }

      setProcessedBooks(bundledProcessedBooks);
      setProcessedDatabaseState({
        fileName: "book.csv",
        rowCount: bundledProcessedBooks.length,
        uploadedAt: null,
        source: "bundled",
      });
    };

    const syncProcessedDatabase = async () => {
      if (!supabase) {
        applyBundledProcessedDatabase();
        if (!ignore) {
          setProcessedDatabaseReady(true);
        }
        return;
      }

      try {
        const sharedDatabase = await loadProcessedDatabaseFromSupabase(supabase);
        if (!sharedDatabase) {
          applyBundledProcessedDatabase();
          return;
        }

        if (ignore) {
          return;
        }

        setProcessedBooks(sharedDatabase.records);
        setProcessedDatabaseState({
          fileName: sharedDatabase.fileName,
          rowCount: sharedDatabase.records.length,
          uploadedAt: sharedDatabase.uploadedAt,
          source: "supabase",
        });
      } catch (error) {
        console.error("Unable to load shared processed database", error);
        applyBundledProcessedDatabase();
      } finally {
        if (!ignore) {
          setProcessedDatabaseReady(true);
        }
      }
    };

    void syncProcessedDatabase();

    if (!supabase) {
      return () => {
        ignore = true;
      };
    }

    const client = supabase;
    const channel = client
      .channel("public-processed-database")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "processed_database_files" },
        () => {
          void syncProcessedDatabase();
        },
      )
      .subscribe();

    return () => {
      ignore = true;
      void client.removeChannel(channel);
    };
  }, [bundledProcessedBooks]);

  function getQuickFilterPreset(mode: QuickFilterMode): BooksFilterState {
    switch (mode) {
      case "accepted":
        return {
          hideRejectedBooks: true,
          hideFlaggedBooks: false,
          hideAcceptedBooks: false,
          hideIncompleteBooks: false,
          isShowFlaggedOnlyMode: false,
        };
      case "review":
        return {
          hideRejectedBooks: true,
          hideFlaggedBooks: false,
          hideAcceptedBooks: true,
          hideIncompleteBooks: false,
          isShowFlaggedOnlyMode: false,
        };
      case "rejected":
        return {
          hideRejectedBooks: false,
          hideFlaggedBooks: false,
          hideAcceptedBooks: true,
          hideIncompleteBooks: true,
          isShowFlaggedOnlyMode: false,
        };
      case "flagged":
        return {
          hideRejectedBooks: true,
          hideFlaggedBooks: false,
          hideAcceptedBooks: true,
          hideIncompleteBooks: true,
          isShowFlaggedOnlyMode: true,
        };
    }
  }

  function isQuickFilterActive(mode: QuickFilterMode): boolean {
    const preset = getQuickFilterPreset(mode);
    return (
      filters.hideRejectedBooks === preset.hideRejectedBooks &&
      filters.hideFlaggedBooks === preset.hideFlaggedBooks &&
      filters.hideAcceptedBooks === preset.hideAcceptedBooks &&
      filters.hideIncompleteBooks === preset.hideIncompleteBooks &&
      filters.isShowFlaggedOnlyMode === preset.isShowFlaggedOnlyMode
    );
  }

  function toggleQuickFilter(mode: QuickFilterMode) {
    setFilters(
      isQuickFilterActive(mode) ? defaultFilters : getQuickFilterPreset(mode),
    );
  }

  async function loadBooks(showLoader = true) {
    if (!supabase) {
      return;
    }

    if (showLoader) {
      setIsLoading(true);
    }

    const { data, error } = await supabase
      .from("books")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      setAppError(error.message);
    } else {
      startTransition(() => {
        setBooks((data as DatabaseBook[]).map(mapDbBook));
      });
      setAppError(null);
    }

    if (showLoader) {
      setIsLoading(false);
    }
  }

  function mapDbBook(row: DatabaseBook): BookRecord {
    return {
      id: row.id,
      isbn: row.isbn,
      title: row.title,
      author: row.author,
      publisher: row.publisher,
      year: row.year,
      pages: row.pages,
      price: row.price,
      language: row.language as BookRecord["language"],
      type: row.type as BookRecord["type"],
      dewey: row.dewey,
      initial: row.initial,
      quantity: row.quantity,
      isRejected: row.is_rejected,
      isFlagged: row.is_flagged,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function serializeDraft(draft: BookDraft) {
    return {
      isbn: draft.isbn,
      title: draft.title,
      author: draft.author,
      publisher: draft.publisher,
      year: draft.year,
      pages: draft.pages,
      price: draft.price,
      language: draft.language,
      type: draft.type,
      dewey: draft.dewey,
      initial: draft.initial,
      quantity: draft.quantity,
      is_rejected: draft.isRejected,
      is_flagged: draft.isFlagged,
    };
  }

  async function saveBook(draft: BookDraft, rejected: boolean) {
    if (!supabase) {
      setAppError(SUPABASE_CONFIG_MESSAGE);
      return;
    }

    setBusyAction(true);
    const normalized = normalizeDraft(draft, rejected);
    const { error } = await supabase
      .from("books")
      .upsert(serializeDraft(normalized), { onConflict: "isbn" });

    setBusyAction(false);
    if (error) {
      setToast(`Save failed: ${error.message}`);
      return;
    }

    setDetailState(null);
    setToast(rejected ? "Book kept in rejected list" : "Book saved");
    await loadBooks(false);
  }

  async function toggleFlag(book: BookRecord) {
    if (!supabase) {
      setAppError(SUPABASE_CONFIG_MESSAGE);
      return;
    }

    const nextDraft: BookDraft = {
      isbn: book.isbn,
      title: book.title,
      author: book.author,
      publisher: book.publisher,
      year: book.year,
      pages: book.pages,
      price: book.price,
      language: book.language,
      type: book.type,
      dewey: book.dewey,
      initial: book.initial,
      quantity: book.quantity,
      isRejected: book.isRejected,
      isFlagged: !book.isFlagged,
    };

    const { error } = await supabase
      .from("books")
      .upsert(serializeDraft(nextDraft), { onConflict: "isbn" });

    if (error) {
      setToast(`Flag update failed: ${error.message}`);
      return;
    }

    setToast(nextDraft.isFlagged ? "Book flagged" : "Flag removed");
    await loadBooks(false);
  }

  async function deleteBook(book: BookRecord) {
    if (!supabase) {
      setAppError(SUPABASE_CONFIG_MESSAGE);
      return;
    }

    if (!window.confirm(`Delete "${book.title || book.isbn}"?`)) {
      return;
    }

    const { error } = await supabase
      .from("books")
      .delete()
      .eq("isbn", book.isbn);
    if (error) {
      setToast(`Delete failed: ${error.message}`);
      return;
    }

    setDetailState(null);
    setRowMenuBook(null);
    setToast("Book deleted");
    await loadBooks(false);
  }

  async function clearBooks(mode: "all" | "accepted" | "rejected") {
    if (!supabase) {
      setAppError(SUPABASE_CONFIG_MESSAGE);
      return;
    }

    const labels = {
      all: "all accepted and rejected books",
      accepted: "all accepted books",
      rejected: "all rejected books",
    };

    if (!window.confirm(`Clear ${labels[mode]}? This cannot be undone.`)) {
      return;
    }

    let error: { message: string } | null = null;

    if (mode === "accepted") {
      const result = await supabase
        .from("books")
        .delete()
        .eq("is_rejected", false);
      error = result.error;
    } else if (mode === "rejected") {
      const result = await supabase
        .from("books")
        .delete()
        .eq("is_rejected", true);
      error = result.error;
    } else {
      const result = await supabase
        .from("books")
        .delete()
        .not("isbn", "is", null);
      error = result.error;
    }

    if (error) {
      setToast(`Clear failed: ${error.message}`);
      return;
    }

    setMenuState(null);
    setToast("Books cleared");
    await loadBooks(false);
  }

  async function exportBooks(mode: "accepted" | "rejected") {
    const collection = mode === "accepted" ? acceptedBooks : rejectedBooks;
    if (collection.length === 0) {
      return;
    }

    const filename = timestampFilename(
      mode === "accepted" ? "Accepted" : "Rejected",
    );
    await shareOrDownloadCsv(filename, toCsv(collection));
    setMenuState(null);
  }

  async function handleDetected(rawIsbn: string) {
    const isbn = normalizeIsbn(rawIsbn);
    if (!isbn) {
      setToast("Invalid ISBN detected");
      return;
    }

    setScannerBusy(true);
    setScannerStatus("Looking up book...");

    const existing = books.find((book) => book.isbn === isbn);
    let completion: CompletionResult | null = null;

    try {
      if (supabase) {
        const { data, error } = await supabase.functions.invoke(
          "complete-book-info",
          {
            body: { isbn },
          },
        );

        if (error) {
          throw error;
        }

        completion = data as CompletionResult;
      }
    } catch {
      setToast("GPT lookup unavailable. Opening manual review.");
    }

    const titleSeed = completion?.title || existing?.title || "";
    const fallback = titleSeed
      ? inferFallback(titleSeed)
      : {
          language: (existing?.language ||
            completion?.language ||
            "Others") as BookDraft["language"],
          type: (existing?.type || completion?.type || "") as BookDraft["type"],
          dewey: existing?.dewey || completion?.dewey || "",
        };

    const nextDraft: BookDraft = {
      isbn,
      title: completion?.title || existing?.title || "",
      author: completion?.author || existing?.author || "",
      publisher: completion?.publisher || existing?.publisher || "",
      year: completion?.year || existing?.year || "",
      pages: completion?.pages || existing?.pages || "",
      price: existing?.price || "",
      language: (completion?.language ||
        existing?.language ||
        fallback.language) as BookDraft["language"],
      type: (completion?.type ||
        existing?.type ||
        fallback.type) as BookDraft["type"],
      dewey: completion?.dewey || existing?.dewey || fallback.dewey,
      initial:
        completion?.initial ||
        existing?.initial ||
        deriveInitial(completion?.author || existing?.author || ""),
      quantity: existing?.quantity || 1,
      isRejected: existing?.isRejected || false,
      isFlagged: existing?.isFlagged || false,
    };

    setScannerBusy(false);
    setScannerStatus("Position barcode in frame");
    setScannerOpen(false);
    setDetailState({
      draft: nextDraft,
      isCurrentlyRejected: existing?.isRejected || false,
    });
  }

  const openBook = (book: BookRecord) => {
    setDetailState({
      draft: {
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        year: book.year,
        pages: book.pages,
        price: book.price,
        language: book.language,
        type: book.type,
        dewey: book.dewey,
        initial: book.initial,
        quantity: book.quantity,
        isRejected: book.isRejected,
        isFlagged: book.isFlagged,
      },
      isCurrentlyRejected: book.isRejected,
    });
  };

  function resetScannerState() {
    setScannerBusy(false);
    setScannerStatus("Position barcode in frame");
  }

  function openLibraryScanner() {
    setScannerMode("library");
    resetScannerState();
    setScannerOpen(true);
  }

  function openProcessedLookup() {
    setMenuState(null);
    setRowMenuBook(null);
    setDetailState(null);
    setProcessedLookupIsbn("");
    setProcessedBookResults([]);
    setAppView("processed-check");
  }

  function backToHome() {
    setProcessedLookupIsbn("");
    setProcessedBookResults([]);
    setAppView("home");
  }

  function backToProcessedLookup() {
    setProcessedLookupIsbn("");
    setProcessedBookResults([]);
    setAppView("processed-check");
  }

  function openProcessedLookupScanner() {
    if (!processedDatabaseReady) {
      setToast("Processed database is still loading");
      return;
    }

    if (processedDatabaseUploading) {
      setToast("Wait for the database upload to finish");
      return;
    }

    setScannerMode("processed-check");
    setScannerBusy(false);
    setScannerStatus("Scan ISBN to check processed details");
    setScannerOpen(true);
  }

  function openProcessedDatabasePicker() {
    if (processedDatabaseUploading) {
      return;
    }

    const input = processedDatabaseInputRef.current;
    if (!input) {
      setToast("Upload picker is unavailable");
      return;
    }

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.click();
  }

  async function handleProcessedDatabaseUpload(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedProcessedDatabaseFile(file)) {
      setToast("Upload a CSV or Excel file");
      return;
    }

    setProcessedDatabaseUploading(true);

    try {
      if (!supabase) {
        throw new Error("Supabase upload is unavailable");
      }

      const records = await parseProcessedDatabaseFile(file);
      if (records.length === 0) {
        throw new Error("No valid rows found in the uploaded database");
      }

      const sharedDatabase = await uploadProcessedDatabaseToSupabase(
        supabase,
        file,
        records,
      );
      await clearProcessedDatabaseClientCache();

      setProcessedBooks(sharedDatabase.records);
      setProcessedDatabaseState({
        fileName: sharedDatabase.fileName,
        rowCount: sharedDatabase.records.length,
        uploadedAt: sharedDatabase.uploadedAt,
        source: "supabase",
      });
      setProcessedLookupIsbn("");
      setProcessedBookResults([]);
      setToast(
        `Database uploaded to Supabase (${sharedDatabase.records.length.toLocaleString()} rows)`,
      );
    } catch (error) {
      setToast(getProcessedDatabaseErrorMessage(error));
    } finally {
      setProcessedDatabaseUploading(false);
      setProcessedDatabaseReady(true);
    }
  }

  function handleProcessedBookLookup(rawIsbn: string) {
    if (!processedDatabaseReady) {
      setToast("Processed database is still loading");
      return;
    }

    const isbn = normalizeIsbn(rawIsbn);
    if (!isbn) {
      setToast("Invalid ISBN detected");
      return;
    }

    setScannerBusy(true);
    setScannerStatus("Checking processed book...");

    const matches = processedBooksByIsbn.get(isbn) ?? [];

    setProcessedLookupIsbn(isbn);
    setProcessedBookResults(matches);
    setScannerOpen(false);
    resetScannerState();

    if (matches.length === 0) {
      setAppView("processed-check");
      window.setTimeout(() => {
        window.alert("This book is not processed.");
      }, PROCESSED_BOOK_RESULT_ALERT_DELAY_MS);
      return;
    }

    setAppView("processed-results");
  }

  async function handleScannerDetected(rawIsbn: string) {
    if (scannerMode === "processed-check") {
      handleProcessedBookLookup(rawIsbn);
      return;
    }

    await handleDetected(rawIsbn);
  }

  return (
    <>
      <div className="page-shell">
        {appView === "home" ? (
          <>
            <div className="app-shell">
              <header className="topbar">
                <div>
                  <h1>Scan to LMS</h1>
                </div>
                <div className="toolbar-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setMenuState("filters")}
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setMenuState("export")}
                    disabled={books.length === 0}
                  >
                    <SquareArrowOutUpRight size={18} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setMenuState("clear")}
                    disabled={books.length === 0}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </header>

              {appError ? (
                <div className="banner banner-danger">
                  <AlertTriangle size={18} />
                  <p>{appError}</p>
                </div>
              ) : null}

              <button
                className="check-entry-button"
                type="button"
                onClick={openProcessedLookup}
              >
                CHECK No. Perolehan
              </button>

              <section className="stats-row">
                <StatCard
                  label="Accepted"
                  value={acceptedBooks.length}
                  tone="accepted"
                  active={isQuickFilterActive("accepted")}
                  onClick={() => toggleQuickFilter("accepted")}
                />
                <StatCard
                  label="Need Review"
                  value={needReviewBooks.length}
                  tone="review"
                  active={isQuickFilterActive("review")}
                  onClick={() => toggleQuickFilter("review")}
                />
                <StatCard
                  label="Rejected"
                  value={rejectedBooks.length}
                  tone="rejected"
                  active={isQuickFilterActive("rejected")}
                  onClick={() => toggleQuickFilter("rejected")}
                />
                <StatCard
                  label="Flagged"
                  value={flaggedBooks.length}
                  tone="neutral"
                  active={isQuickFilterActive("flagged")}
                  onClick={() => toggleQuickFilter("flagged")}
                />
              </section>

              <section className="list-panel">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">Library Queue</p>
                    <h2>{headerTitle}</h2>
                  </div>
                  <span className="count-pill">{visibleBooks.length}</span>
                </div>

                {isLoading ? (
                  <div className="empty-state">
                    <LoaderCircle className="spin" size={28} />
                    <p>Loading books from Supabase...</p>
                  </div>
                ) : books.length === 0 ? (
                  <div className="empty-state">
                    <Search size={26} />
                    <p>No books yet. Tap Scan to capture an ISBN barcode.</p>
                  </div>
                ) : (
                  <div className="book-list">
                    {visibleBooks.map((book) => (
                      <article
                        className={`book-row ${getRowTone(book)}`}
                        key={book.id}
                        onClick={() => openBook(book)}
                      >
                        <div className="book-row-main">
                          <div className="book-title-row">
                            {isBookIncomplete(book) ? (
                              <AlertTriangle size={14} />
                            ) : null}
                            {book.isFlagged ? <Flag size={14} /> : null}
                            <h3>{book.title || "(Unknown title)"}</h3>
                          </div>
                          <p className="book-meta">ISBN: {book.isbn}</p>
                        </div>

                        <div className="book-row-actions">
                          <button
                            className={
                              book.isFlagged
                                ? "icon-button toggled"
                                : "icon-button"
                            }
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleFlag(book);
                            }}
                          >
                            <Flag size={16} />
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label="Open book menu"
                            onClick={(event) => {
                              event.stopPropagation();
                              setRowMenuBook(book);
                            }}
                          >
                            <Ellipsis size={16} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {books.length > 0 ? (
                <footer className="legend-bar">
                  <LegendItem
                    label="Accepted"
                    tone="accepted"
                    hidden={filters.hideAcceptedBooks}
                  />
                  <LegendItem
                    label="Need Review"
                    tone="review"
                    hidden={filters.hideIncompleteBooks}
                  />
                  <LegendItem
                    label="Rejected"
                    tone="rejected"
                    hidden={filters.hideRejectedBooks}
                  />
                </footer>
              ) : null}
            </div>

            <button
              className="scan-fab"
              type="button"
              onClick={openLibraryScanner}
            >
              Scan
            </button>
          </>
        ) : appView === "processed-check" ? (
          <ProcessedLookupView
            onBack={backToHome}
            onScan={openProcessedLookupScanner}
            onUpload={openProcessedDatabasePicker}
            isScanDisabled={!processedDatabaseReady || processedDatabaseUploading}
            isUploadBusy={processedDatabaseUploading}
            databaseSummary={processedDatabaseSummary}
          />
        ) : (
          <ProcessedLookupResultsView
            isbn={processedLookupIsbn}
            books={processedBookResults}
            onBack={backToProcessedLookup}
          />
        )}

        {toast ? <div className="toast">{toast}</div> : null}
      </div>

      <input
        ref={processedDatabaseInputRef}
        className="visually-hidden-input"
        type="file"
        accept={PROCESSED_DATABASE_FILE_ACCEPT}
        onChange={handleProcessedDatabaseUpload}
        tabIndex={-1}
      />

      <Suspense fallback={null}>
        <ScannerSheet
          open={scannerOpen}
          busy={scannerBusy}
          statusMessage={scannerStatus}
          onClose={() => {
            if (!scannerBusy) {
              setScannerOpen(false);
            }
          }}
          onDetected={handleScannerDetected}
        />

        <DetailSheet
          open={Boolean(detailState)}
          book={detailState?.draft ?? null}
          busy={busyAction}
          isCurrentlyRejected={detailState?.isCurrentlyRejected ?? false}
          onClose={() => setDetailState(null)}
          onSave={async (draft) => {
            await saveBook(draft, false);
          }}
          onReject={async (draft) => {
            await saveBook(draft, true);
          }}
          onDelete={
            detailExistingBook
              ? async () => {
                  await deleteBook(detailExistingBook);
                }
              : undefined
          }
        />
      </Suspense>

      <ActionSheet
        open={menuState === "filters"}
        title="Filters"
        onClose={() => setMenuState(null)}
      >
        <ActionButton
          label={
            filters.hideRejectedBooks
              ? "Show Rejected Books"
              : "Hide Rejected Books"
          }
          onClick={() =>
            setFilters((current) => ({
              ...current,
              hideRejectedBooks: !current.hideRejectedBooks,
              isShowFlaggedOnlyMode: false,
            }))
          }
        />
        <ActionButton
          label={
            filters.hideFlaggedBooks
              ? "Show Flagged Books"
              : "Hide Flagged Books"
          }
          onClick={() =>
            setFilters((current) => ({
              ...current,
              hideFlaggedBooks: !current.hideFlaggedBooks,
              isShowFlaggedOnlyMode: false,
            }))
          }
        />
        <ActionButton
          label={
            filters.hideAcceptedBooks
              ? "Show Accepted Books"
              : "Hide Accepted Books"
          }
          onClick={() =>
            setFilters((current) => ({
              ...current,
              hideAcceptedBooks: !current.hideAcceptedBooks,
              isShowFlaggedOnlyMode: false,
            }))
          }
        />
        <ActionButton
          label={
            filters.hideIncompleteBooks
              ? "Show Need Review Books"
              : "Hide Need Review Books"
          }
          onClick={() =>
            setFilters((current) => ({
              ...current,
              hideIncompleteBooks: !current.hideIncompleteBooks,
              isShowFlaggedOnlyMode: false,
            }))
          }
        />
        <ActionButton
          label="Show Flagged Books Only"
          onClick={() =>
            setFilters({
              hideRejectedBooks: true,
              hideFlaggedBooks: false,
              hideAcceptedBooks: true,
              hideIncompleteBooks: true,
              isShowFlaggedOnlyMode: true,
            })
          }
        />
        <ActionButton
          label="Show All Books"
          onClick={() => setFilters(defaultFilters)}
        />
      </ActionSheet>

      <ActionSheet
        open={menuState === "export"}
        title="Export CSV"
        onClose={() => setMenuState(null)}
      >
        <ActionButton
          label={`Export Accepted Books (${acceptedBooks.length})`}
          disabled={acceptedBooks.length === 0}
          onClick={() => void exportBooks("accepted")}
        />
        <ActionButton
          label={`Export Rejected Books (${rejectedBooks.length})`}
          disabled={rejectedBooks.length === 0}
          onClick={() => void exportBooks("rejected")}
        />
      </ActionSheet>

      <ActionSheet
        open={menuState === "clear"}
        title="Clear Entries"
        onClose={() => setMenuState(null)}
      >
        <ActionButton
          label="Clear All (Accepted & Rejected)"
          danger
          onClick={() => void clearBooks("all")}
        />
        <ActionButton
          label="Clear Accepted Books Only"
          danger
          onClick={() => void clearBooks("accepted")}
        />
        <ActionButton
          label="Clear Rejected Books Only"
          danger
          onClick={() => void clearBooks("rejected")}
        />
      </ActionSheet>

      <ActionSheet
        open={Boolean(rowMenuBook)}
        title={rowMenuBook?.title || rowMenuBook?.isbn || "Book Actions"}
        onClose={() => setRowMenuBook(null)}
      >
        <ActionButton
          label="Copy ISBN"
          onClick={async () => {
            if (!rowMenuBook) return;
            await navigator.clipboard.writeText(rowMenuBook.isbn);
            setToast("ISBN copied");
            setRowMenuBook(null);
          }}
        />
        <ActionButton
          label="Copy Title"
          onClick={async () => {
            if (!rowMenuBook?.title) return;
            await navigator.clipboard.writeText(rowMenuBook.title);
            setToast("Title copied");
            setRowMenuBook(null);
          }}
        />
        <ActionButton
          label="Search ISBN"
          onClick={() => {
            if (!rowMenuBook) return;
            window.open(
              `https://isbnsearch.org/isbn/${encodeURIComponent(rowMenuBook.isbn)}`,
              "_blank",
              "noopener,noreferrer",
            );
          }}
        />
        <ActionButton
          label="Google ISBN"
          onClick={() => {
            if (!rowMenuBook) return;
            window.open(
              `https://www.google.com/search?q=${encodeURIComponent(rowMenuBook.isbn)}`,
              "_blank",
              "noopener,noreferrer",
            );
          }}
        />
        <ActionButton
          label="Google Title"
          onClick={() => {
            if (!rowMenuBook) return;
            window.open(
              `https://www.google.com/search?q=${encodeURIComponent(rowMenuBook.title || rowMenuBook.isbn)}`,
              "_blank",
              "noopener,noreferrer",
            );
          }}
        />
        <ActionButton
          label={rowMenuBook?.isFlagged ? "Remove Flag" : "Flag Book"}
          onClick={() => {
            if (!rowMenuBook) return;
            void toggleFlag(rowMenuBook);
            setRowMenuBook(null);
          }}
        />
        <ActionButton
          label="Delete Book"
          danger
          onClick={() => {
            if (!rowMenuBook) return;
            void deleteBook(rowMenuBook);
          }}
        />
      </ActionSheet>
    </>
  );
}

function ProcessedLookupView({
  onBack,
  onScan,
  onUpload,
  isScanDisabled,
  isUploadBusy,
  databaseSummary,
}: {
  onBack: () => void;
  onScan: () => void;
  onUpload: () => void;
  isScanDisabled: boolean;
  isUploadBusy: boolean;
  databaseSummary: string;
}) {
  return (
    <div className="app-shell">
      <div className="subpage-header subpage-header-actions">
        <button
          className="secondary-button page-back-button"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <button
          className="info-button check-upload-button"
          type="button"
          onClick={onUpload}
          disabled={isUploadBusy}
        >
          <Upload size={20} />
          {isUploadBusy ? "Uploading..." : "Upload database"}
        </button>
      </div>

      <section className="list-panel check-screen-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Processed Lookup</p>
            <h2>CHECK No. Perolehan</h2>
          </div>
        </div>

        <div className="check-screen-body">
          <button
            className="primary-button check-scan-button"
            type="button"
            onClick={onScan}
            disabled={isScanDisabled}
          >
            <ScanLine size={20} />
            Scan
          </button>
          <p className="check-screen-description">
            Tap Scan button to view processed book details.
          </p>
          <p className="check-screen-description check-screen-meta">
            {databaseSummary}
          </p>
        </div>
      </section>
    </div>
  );
}

function ProcessedLookupResultsView({
  isbn,
  books,
  onBack,
}: {
  isbn: string;
  books: ProcessedBookRecord[];
  onBack: () => void;
}) {
  return (
    <div className="app-shell">
      <div className="subpage-header">
        <button
          className="secondary-button page-back-button"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
          Back
        </button>
      </div>

      <section className="list-panel result-screen-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Processed Lookup</p>
            <h2>Result</h2>
          </div>
          <span className="count-pill">{books.length}</span>
        </div>

        <p className="result-screen-subtitle">ISBN: {isbn}</p>

        <div className="processed-book-list">
          {books.map((book, index) => (
            <article
              className="processed-book-card"
              key={`${book.noPerolehan}-${book.isbn}-${index}`}
            >
              {PROCESSED_BOOK_FIELDS.map((field) => (
                <p className="processed-book-line" key={field.key}>
                  <strong>{field.label}:</strong> {book[field.key] || "-"}
                </p>
              ))}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function getRowTone(book: BookRecord) {
  if (book.isRejected) {
    return "rejected";
  }
  if (isBookIncomplete(book)) {
    return "review";
  }
  return "accepted";
}

function StatCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "accepted" | "review" | "rejected" | "neutral";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`stat-card ${tone}${active ? " active" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      <p>{label}</p>
      <strong>{value}</strong>
    </button>
  );
}

function LegendItem({
  label,
  tone,
  hidden,
}: {
  label: string;
  tone: "accepted" | "review" | "rejected";
  hidden: boolean;
}) {
  if (hidden) {
    return null;
  }

  return (
    <div className="legend-item">
      <span className={`legend-swatch ${tone}`} />
      <span>{label}</span>
    </div>
  );
}

function ActionSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="sheet action-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-header compact">
          <div>
            <p className="sheet-kicker">Actions</p>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="action-sheet-buttons">{children}</div>
      </section>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={danger ? "action-button danger" : "action-button"}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

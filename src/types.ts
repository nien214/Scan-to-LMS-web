export type BookLanguage = "English" | "Malay" | "Chinese" | "Tamil" | "Others" | "";
export type BookType = "F" | "NF" | "R" | "";

export type BookRecord = {
  id: string;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  pages: string;
  price: string;
  language: BookLanguage;
  type: BookType;
  dewey: string;
  initial: string;
  quantity: number;
  isRejected: boolean;
  isFlagged: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BookDraft = Omit<BookRecord, "id" | "createdAt" | "updatedAt">;

export type BooksFilterState = {
  hideRejectedBooks: boolean;
  hideFlaggedBooks: boolean;
  hideAcceptedBooks: boolean;
  hideIncompleteBooks: boolean;
  isShowFlaggedOnlyMode: boolean;
};

export type CompletionResult = Pick<
  BookDraft,
  "isbn" | "title" | "author" | "publisher" | "year" | "pages" | "language" | "type" | "dewey" | "initial"
>;

export const defaultFilters: BooksFilterState = {
  hideRejectedBooks: false,
  hideFlaggedBooks: false,
  hideAcceptedBooks: false,
  hideIncompleteBooks: false,
  isShowFlaggedOnlyMode: false
};

export function createEmptyDraft(isbn = ""): BookDraft {
  return {
    isbn,
    title: "",
    author: "",
    publisher: "",
    year: "",
    pages: "",
    price: "",
    language: "",
    type: "",
    dewey: "",
    initial: "",
    quantity: 1,
    isRejected: false,
    isFlagged: false
  };
}

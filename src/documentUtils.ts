import { supportedLanguageIds } from "./constants";

export interface DocumentLike {
  languageId: string;
  uri: {
    scheme: string;
  };
}

export function isPascalDocument(document: DocumentLike): boolean {
  return supportedLanguageIds.includes(document.languageId as (typeof supportedLanguageIds)[number]);
}

export function isFileBackedDocument(document: DocumentLike): boolean {
  return document.uri.scheme === "file";
}

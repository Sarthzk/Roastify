import { describe, it, expect } from "vitest";
import {
  sourceState,
  classifyUploadFile,
  unsupportedFileMessage,
  emptyExtractionMessage,
  extractionFailedMessage,
} from "./inputFormHelpers.js";

describe("sourceState (tier/locked-state derivation)", () => {
  it("every non-instagram source is always open, regardless of tier", () => {
    for (const value of ["github", "linkedin", "resume"]) {
      expect(sourceState({ value }, { instagramEnabled: true, signedIn: true })).toBe("open");
      expect(sourceState({ value }, { instagramEnabled: false, signedIn: false })).toBe("open");
    }
  });

  it("instagram is open when enabled and signed in", () => {
    expect(sourceState({ value: "instagram" }, { instagramEnabled: true, signedIn: true })).toBe("open");
  });

  it("instagram is locked when enabled but signed out", () => {
    expect(sourceState({ value: "instagram" }, { instagramEnabled: true, signedIn: false })).toBe("locked");
  });

  it("the kill switch outranks the sign-in lock: disabled wins even when signed in", () => {
    expect(sourceState({ value: "instagram" }, { instagramEnabled: false, signedIn: true })).toBe("disabled");
    expect(sourceState({ value: "instagram" }, { instagramEnabled: false, signedIn: false })).toBe("disabled");
  });
});

describe("classifyUploadFile", () => {
  it("recognizes a PDF by extension even with no/wrong MIME type", () => {
    expect(classifyUploadFile("resume.pdf", "")).toEqual({ isPdf: true, isText: false, isSupported: true });
  });

  it("recognizes a PDF by MIME type even with a non-.pdf name", () => {
    expect(classifyUploadFile("resume", "application/pdf")).toEqual({ isPdf: true, isText: false, isSupported: true });
  });

  it("recognizes a .txt file", () => {
    expect(classifyUploadFile("notes.txt", "text/plain")).toEqual({ isPdf: false, isText: true, isSupported: true });
  });

  it("recognizes any text/* MIME type even with a different extension", () => {
    expect(classifyUploadFile("notes", "text/markdown")).toEqual({ isPdf: false, isText: true, isSupported: true });
  });

  it("rejects an unsupported file (e.g. an image)", () => {
    expect(classifyUploadFile("selfie.jpg", "image/jpeg")).toEqual({ isPdf: false, isText: false, isSupported: false });
  });
});

describe("upload failure messages", () => {
  it("unsupportedFileMessage names the actual file, never a generic message", () => {
    expect(unsupportedFileMessage("selfie.jpg")).toBe(
      '"selfie.jpg" isn\'t a PDF or text file — try a different file, or paste the text instead.'
    );
  });

  it("emptyExtractionMessage covers a PDF/file with no extractable text", () => {
    expect(emptyExtractionMessage("blank.pdf")).toBe(
      'Couldn\'t find any text in "blank.pdf" — try pasting the text instead.'
    );
  });

  it("extractionFailedMessage covers the extraction step itself throwing", () => {
    expect(extractionFailedMessage("corrupt.pdf")).toBe(
      'Couldn\'t read "corrupt.pdf" — try a different file, or paste the text instead.'
    );
  });
});

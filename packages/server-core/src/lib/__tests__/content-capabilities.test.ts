import { describe, expect, it } from "vitest";

import {
  buildContentReadResponse,
  validateContentUpload,
} from "../content-capabilities.js";

const signatures = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  gif: Buffer.from("GIF89a", "ascii"),
  webp: Buffer.from("RIFF\x04\x00\x00\x00WEBP", "binary"),
  svg: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
  pdf: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"),
};

describe("content capability validation", () => {
  it.each([
    ["image.png", "image/png", signatures.png],
    ["image.jpg", "image/jpeg", signatures.jpg],
    ["image.jpeg", "image/jpeg", signatures.jpg],
    ["image.gif", "image/gif", signatures.gif],
    ["image.webp", "image/webp", signatures.webp],
    ["image.svg", "image/svg+xml", signatures.svg],
    ["invoice.pdf", "application/pdf", signatures.pdf],
  ])("accepts a valid %s", (filename, declaredMimeType, bytes) => {
    expect(validateContentUpload({ filename, declaredMimeType, bytes })).toMatchObject({
      ok: true,
      mimeType: declaredMimeType,
    });
  });

  it.each([
    ["notes.txt", "text/plain", Buffer.from("notes"), "CONTENT_TYPE_UNSUPPORTED", 400],
    ["image.png", "application/pdf", signatures.png, "CONTENT_MIME_MISMATCH", 400],
    ["image.png", "image/png", Buffer.from("not a png"), "CONTENT_SIGNATURE_INVALID", 400],
    [
      "image.png",
      "image/png",
      Buffer.alloc(10 * 1024 * 1024 + 1, 0),
      "CONTENT_TOO_LARGE",
      413,
    ],
  ])("rejects invalid upload %# with a stable code", (filename, declaredMimeType, bytes, code, status) => {
    expect(validateContentUpload({ filename, declaredMimeType, bytes })).toMatchObject({
      ok: false,
      code,
      status,
    });
  });
});

describe("content read response", () => {
  it("builds safe inline PDF headers for a full response", () => {
    expect(buildContentReadResponse({ filename: "invoice.pdf", size: 100 })).toEqual({
      status: 200,
      start: 0,
      end: 99,
      headers: expect.objectContaining({
        "Accept-Ranges": "bytes",
        "Content-Disposition": expect.stringContaining("inline"),
        "Content-Length": "100",
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      }),
    });
  });

  it("builds a bounded partial response", () => {
    expect(buildContentReadResponse({ filename: "invoice.pdf", size: 100, rangeHeader: "bytes=10-19" })).toEqual({
      status: 206,
      start: 10,
      end: 19,
      headers: expect.objectContaining({
        "Content-Length": "10",
        "Content-Range": "bytes 10-19/100",
      }),
    });
  });

  it("returns 416 metadata for an unsatisfiable range", () => {
    expect(buildContentReadResponse({ filename: "invoice.pdf", size: 100, rangeHeader: "bytes=100-120" })).toEqual({
      status: 416,
      start: null,
      end: null,
      headers: expect.objectContaining({ "Content-Range": "bytes */100" }),
    });
  });
});

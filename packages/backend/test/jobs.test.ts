/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { normalizeBackendUrl } from "../convex/jobs";

describe("normalizeBackendUrl", () => {
  test("strips trailing slashes", () => {
    expect(normalizeBackendUrl("http://localhost:4000///")).toBe(
      "http://localhost:4000",
    );
  });
  test("keeps host.docker.internal URLs", () => {
    expect(normalizeBackendUrl("http://host.docker.internal:4000")).toBe(
      "http://host.docker.internal:4000",
    );
  });
  test("accepts https", () => {
    expect(normalizeBackendUrl("https://backend.example.com/api")).toBe(
      "https://backend.example.com/api",
    );
  });
  test("rejects non-URLs", () => {
    expect(() => normalizeBackendUrl("not-a-url")).toThrow(/not a valid URL/);
  });
  test("rejects non-http(s) schemes", () => {
    expect(() => normalizeBackendUrl("ftp://x.example/y")).toThrow(
      /must use http or https/,
    );
  });
  test("rejects empty input", () => {
    expect(() => normalizeBackendUrl("   ")).toThrow();
  });
});

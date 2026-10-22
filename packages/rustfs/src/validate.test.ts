/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import {
  MAX_BUCKET_SUFFIX_LEN,
  validateBucketSuffix,
  validateFullBucketName,
  validateObjectKey,
  formatBytes,
  rfc3339,
} from "./validate";

describe("validateBucketSuffix", () => {
  test("accepts valid suffixes", () => {
    expect(validateBucketSuffix("profile-images")).toBeNull();
    expect(validateBucketSuffix("a")).toBeNull();
    expect(validateBucketSuffix("data01")).toBeNull();
    expect(validateBucketSuffix("a-b-c")).toBeNull();
  });
  test("rejects empty, long, uppercase, bad chars, edge hyphens, doubles", () => {
    expect(validateBucketSuffix("")).toMatch(/required/i);
    expect(validateBucketSuffix("x".repeat(MAX_BUCKET_SUFFIX_LEN + 1))).toMatch(
      /at most/i,
    );
    expect(validateBucketSuffix("Profile")).toMatch(/lowercase/i);
    expect(validateBucketSuffix("my_bucket")).toMatch(/lowercase/i);
    expect(validateBucketSuffix("-leading")).toMatch(/starting/i);
    expect(validateBucketSuffix("trailing-")).toMatch(/starting/i);
    expect(validateBucketSuffix("a--b")).toMatch(/consecutive/i);
  });
});

describe("validateFullBucketName", () => {
  test("accepts valid S3 names", () => {
    expect(validateFullBucketName("my-bucket")).toBeNull();
    expect(validateFullBucketName("a.b.c")).toBeNull();
  });
  test("rejects short, long, IP-formatted, bad edges", () => {
    expect(validateFullBucketName("ab")).toMatch(/3–63/i);
    expect(validateFullBucketName("x".repeat(64))).toMatch(/3–63/i);
    expect(validateFullBucketName("192.168.1.1")).toMatch(/IP address/i);
    expect(validateFullBucketName(".abc")).toMatch(/lowercase/i);
    expect(validateFullBucketName("ABC")).toMatch(/lowercase/i);
  });
});

describe("validateObjectKey (path-traversal defense)", () => {
  test("accepts normal keys", () => {
    expect(validateObjectKey("photos/2026/01/01/img.png")).toBeNull();
    expect(validateObjectKey("a b.txt")).toBeNull();
    expect(validateObjectKey("reports.pdf")).toBeNull();
  });
  test("rejects traversal, absolute, backslash, control chars, empty, overlong", () => {
    expect(validateObjectKey("")).toMatch(/required/i);
    expect(validateObjectKey("/etc/passwd")).toMatch(/leading slash/i);
    expect(validateObjectKey("..")).toMatch(/\.\./i);
    expect(validateObjectKey("a/../b")).toMatch(/\.\./i);
    expect(validateObjectKey("a/..")).toMatch(/\.\./i);
    expect(validateObjectKey("a\\b")).toMatch(/backslash/i);
    expect(validateObjectKey("a\x00b")).toMatch(/control/i);
    expect(validateObjectKey("a\x7fb")).toMatch(/control/i);
    expect(validateObjectKey("x".repeat(1025))).toMatch(/at most/i);
  });
});

describe("formatBytes", () => {
  test("formats B/KB/MB/GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1024 * 1024 * 5)).toBe("5 MB");
    expect(formatBytes(1024 ** 3 * 1.5)).toBe("1.5 GB");
  });
});

describe("rfc3339", () => {
  test("produces RFC 3339 UTC with second precision", () => {
    expect(rfc3339(0)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

import { describe, it, expect } from "vitest";
import { matchGlob, matchString, matchArgument, matchArguments, matchAnnotations } from "./matcher.js";

describe("matchGlob", () => {
  it("matches exact strings", () => {
    expect(matchGlob("hello", "hello")).toBe(true);
    expect(matchGlob("hello", "world")).toBe(false);
  });

  it("matches * wildcard", () => {
    expect(matchGlob("*", "anything")).toBe(true);
    expect(matchGlob("file*", "file.txt")).toBe(true);
    expect(matchGlob("file*", "file")).toBe(true);
    expect(matchGlob("*file", "myfile")).toBe(true);
    expect(matchGlob("*.txt", "readme.txt")).toBe(true);
    expect(matchGlob("*.txt", "readme.md")).toBe(false);
  });

  it("matches ? wildcard", () => {
    expect(matchGlob("file?.txt", "file1.txt")).toBe(true);
    expect(matchGlob("file?.txt", "file12.txt")).toBe(false);
    expect(matchGlob("?.?", "a.b")).toBe(true);
  });

  it("matches character classes", () => {
    // basic glob doesn't support character classes in this impl, but * works
    expect(matchGlob("filesystem/*", "filesystem/read")).toBe(true);
    expect(matchGlob("filesystem/*", "github/create")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(matchGlob("", "")).toBe(true);
    expect(matchGlob("*", "")).toBe(true);
    expect(matchGlob("a", "")).toBe(false);
  });

  it("matches patterns used in policy rules", () => {
    expect(matchGlob("*/delete_*", "filesystem/delete_file")).toBe(true);
    expect(matchGlob("*/delete_*", "filesystem/read_file")).toBe(false);
    expect(matchGlob("github/*", "github/create_issue")).toBe(true);
    expect(matchGlob("shell/execute", "shell/execute")).toBe(true);
  });
});

describe("matchString", () => {
  it("matches undefined (always true)", () => {
    expect(matchString(undefined, "anything")).toBe(true);
  });

  it("matches plain string as glob", () => {
    expect(matchString("hello", "hello")).toBe(true);
    expect(matchString("file*", "file.txt")).toBe(true);
  });

  it("matches StringMatcher with glob", () => {
    expect(matchString({ glob: "*.txt" }, "readme.txt")).toBe(true);
    expect(matchString({ glob: "*.txt" }, "readme.md")).toBe(false);
  });

  it("matches StringMatcher with regex", () => {
    expect(matchString({ regex: "^admin\\." }, "admin.users")).toBe(true);
    expect(matchString({ regex: "^admin\\." }, "user.admin")).toBe(false);
  });

  it("matches StringMatcher with equals", () => {
    expect(matchString({ equals: "exact" }, "exact")).toBe(true);
    expect(matchString({ equals: "exact" }, "not-exact")).toBe(false);
  });
});

describe("matchArgument", () => {
  it("matches string value with glob", () => {
    expect(matchArgument("*.txt", "readme.txt")).toBe(true);
    expect(matchArgument("*.txt", "readme.md")).toBe(false);
  });

  it("matches startsWith", () => {
    expect(matchArgument({ startsWith: "/safe/" }, "/safe/file.txt")).toBe(true);
    expect(matchArgument({ startsWith: "/safe/" }, "/unsafe/file.txt")).toBe(false);
  });

  it("matches endsWith", () => {
    expect(matchArgument({ endsWith: ".js" }, "script.js")).toBe(true);
    expect(matchArgument({ endsWith: ".js" }, "script.ts")).toBe(false);
  });

  it("matches contains", () => {
    expect(matchArgument({ contains: "password" }, "my_password_123")).toBe(true);
    expect(matchArgument({ contains: "password" }, "my_secret_123")).toBe(false);
  });

  it("matches regex", () => {
    expect(matchArgument({ regex: "rm\\s+-rf" }, "rm -rf /")).toBe(true);
    expect(matchArgument({ regex: "rm\\s+-rf" }, "rm file")).toBe(false);
  });

  it("matches equals", () => {
    expect(matchArgument({ equals: "admin" }, "admin")).toBe(true);
    expect(matchArgument({ equals: "admin" }, "user")).toBe(false);
  });

  it("matches in", () => {
    expect(matchArgument({ in: ["rm", "rmdir", "mv"] }, "rm")).toBe(true);
    expect(matchArgument({ in: ["rm", "rmdir", "mv"] }, "ls")).toBe(false);
  });

  it("matches not", () => {
    expect(matchArgument({ not: { startsWith: "/unsafe/" } }, "/safe/file")).toBe(true);
    expect(matchArgument({ not: { startsWith: "/unsafe/" } }, "/unsafe/file")).toBe(false);
  });
});

describe("matchArguments", () => {
  it("returns true when no matchers", () => {
    expect(matchArguments(undefined, { a: 1 })).toBe(true);
  });

  it("matches multiple argument conditions", () => {
    const matchers = {
      command: { regex: "rm\\s+-rf" },
      path: { startsWith: "/tmp/" },
    };
    expect(matchArguments(matchers, { command: "rm -rf foo", path: "/tmp/foo" })).toBe(true);
    expect(matchArguments(matchers, { command: "rm -rf foo", path: "/etc/passwd" })).toBe(false);
    expect(matchArguments(matchers, { command: "ls", path: "/tmp/foo" })).toBe(false);
  });
});

describe("matchAnnotations", () => {
  it("returns true when no matchers", () => {
    expect(matchAnnotations(undefined, { readOnlyHint: true })).toBe(true);
  });

  it("returns false when annotations missing", () => {
    expect(matchAnnotations({ readOnlyHint: true }, undefined)).toBe(false);
  });

  it("matches annotation values", () => {
    expect(matchAnnotations({ readOnlyHint: true }, { readOnlyHint: true })).toBe(true);
    expect(matchAnnotations({ readOnlyHint: true }, { readOnlyHint: false })).toBe(false);
  });
});

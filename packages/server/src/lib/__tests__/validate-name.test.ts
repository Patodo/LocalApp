import { describe, it, expect } from "vitest";
import { validateName } from "../validate-name.js";

describe("validateName", () => {
  it("accepts valid kebab-case names", () => {
    expect(validateName("my-cool-app")).toBeNull();
    expect(validateName("abc")).toBeNull();
    expect(validateName("a".repeat(63))).toBeNull();
    expect(validateName("data-viewer-3000")).toBeNull();
    expect(validateName("the-page-content")).toBeNull();
  });

  it("rejects uppercase letters", () => {
    expect(validateName("My-Cool-App")).not.toBeNull();
  });

  it("rejects underscores", () => {
    expect(validateName("my_cool_app")).not.toBeNull();
  });

  it("rejects spaces", () => {
    expect(validateName("my cool app")).not.toBeNull();
  });

  it("rejects digit-starting names", () => {
    expect(validateName("123app")).not.toBeNull();
  });

  it("rejects consecutive hyphens", () => {
    expect(validateName("my--app")).not.toBeNull();
  });

  it("rejects leading hyphen", () => {
    expect(validateName("-my-app")).not.toBeNull();
  });

  it("rejects trailing hyphen", () => {
    expect(validateName("my-app-")).not.toBeNull();
  });

  it("rejects names shorter than 3 chars", () => {
    expect(validateName("ab")).not.toBeNull();
  });

  it("rejects names longer than 63 chars", () => {
    expect(validateName("a".repeat(64))).not.toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateName("")).not.toBeNull();
  });

  it("rejects reserved names", () => {
    expect(validateName("api")).not.toBeNull();
    expect(validateName("serve")).not.toBeNull();
    expect(validateName("health")).not.toBeNull();
    expect(validateName("cli")).not.toBeNull();
    expect(validateName("keys")).not.toBeNull();
    expect(validateName("upload")).not.toBeNull();
    expect(validateName("pages")).not.toBeNull();
    expect(validateName("schemas")).not.toBeNull();
  });

  it("allows names containing reserved words as substrings", () => {
    expect(validateName("my-api-tool")).toBeNull();
    expect(validateName("api-docs")).toBeNull();
  });
});

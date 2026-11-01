// Unit tests for the citation parser. The cases live in citation-cases.json so
// that evals/test_checks.py runs the Python port on exactly the same examples.

import { describe, expect, it } from "vitest";
import { extractCitations } from "../src/citations";
import shared from "./citation-cases.json";

interface Case {
  name: string;
  answer: string;
  citations: string[];
  not_expanded: string[];
}

const material: Record<string, number> = shared.material;
const cases: Case[] = shared.cases;

const knownIds = new Set(
  Object.entries(material).flatMap(([file, lines]) => Array.from({ length: lines }, (_, i) => `${file}#${i + 1}`)),
);

describe("extractCitations (shared cases)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(extractCitations(c.answer, knownIds)).toEqual(c.citations);
  });
});

describe("extractCitations", () => {
  it("keeps the existing behaviour for plain ids", () => {
    expect(extractCitations("A [x#2, x#3; y#1] b [x#2] c [x#99] [not an id] [x 2]", knownIds)).toEqual(["x#2", "x#3", "y#1"]);
  });

  it("ignores a bracket longer than 300 characters, range or not", () => {
    expect(extractCitations(`[${"a".repeat(300)} x#2–x#4]`, knownIds)).toEqual([]);
  });

  it("drops a range whose line numbers are too large to count", () => {
    expect(extractCitations("[x#9007199254740993–x#9007199254740994]", new Set(["x#9007199254740993"]))).toEqual([]);
  });
});

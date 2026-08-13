import { fieldsFromSample, filterHint } from "./fields";

describe("filterHint", () => {
  it("names the sampled fields with their types", () => {
    const hint = filterHint([
      { name: "question", type: "string" },
      { name: "rating", type: "number" },
    ]);

    expect(hint).toContain("question (string)");
    expect(hint).toContain("rating (number)");
  });

  it("shows the filter syntax when there is nothing to sample", () => {
    expect(filterHint([])).toMatch(/eq\(/);
  });
});

describe("fieldsFromSample", () => {
  it("yields no fields when the Custom API has no entries to sample", () => {
    expect(fieldsFromSample([])).toEqual([]);
  });

  // The envelope is Elastic Path's, not the designer's: id and type are not
  // filterable custom fields, and created_at/updated_at live inside meta rather
  // than at the top level, so meta must not be offered as a field either.
  it("does not offer Elastic Path's envelope keys as fields", () => {
    const fields = fieldsFromSample([
      {
        id: "0e5eb3d4",
        type: "faq_ext",
        links: { self: "/v2/extensions/faqs/0e5eb3d4" },
        meta: { timestamps: { created_at: "2026-05-07T06:24:05.130Z" } },
        question: "Do you ship to Canada?",
      },
    ]);

    expect(fields.map((f) => f.name)).toEqual(["question"]);
  });

  // Inferred from JSON, so integer and float are indistinguishable and a field
  // that happens to be null on the sampled entry reveals only its name. Both
  // limits are inherent to sampling and are stated in the hint.
  it("infers each field's type from the sampled value", () => {
    const fields = fieldsFromSample([
      {
        id: "0e5eb3d4",
        question: "Do you ship to Canada?",
        rating: 4.5,
        published: true,
        tags: ["shipping", "international"],
        retired_on: null,
      },
    ]);

    expect(fields).toEqual([
      { name: "question", type: "string" },
      { name: "rating", type: "number" },
      { name: "published", type: "boolean" },
      { name: "tags", type: "list" },
      { name: "retired_on", type: "unknown" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeExtractorOutput } from "@/lib/openai";

describe("normalizeExtractorOutput", () => {
  it("normalizes extracted map requirement->string using top-level requirement chunk map", () => {
    const normalized = normalizeExtractorOutput(
      {
        requirements: ["MFA required for privileged access"],
        extracted: {
          "MFA required for privileged access": "Yes"
        },
        supportingChunkIds: {
          "MFA required for privileged access": ["chunk-1"]
        },
        overall: "FOUND"
      },
      new Set(["chunk-1", "chunk-2"])
    );

    expect(normalized.extracted).toEqual([
      {
        requirement: "MFA required for privileged access",
        value: "Yes",
        supportingChunkIds: ["chunk-1"]
      }
    ]);
    expect(normalized.overall).toBe("FOUND");
    expect(normalized.extractorInvalid).toBe(false);
  });

  it("normalizes extracted map requirement->{value,supportingChunkIds} and filters invalid chunk ids", () => {
    const normalized = normalizeExtractorOutput(
      {
        requirements: "Minimum TLS version",
        extracted: {
          "Minimum TLS version": {
            value: "TLS 1.2+",
            supportingChunkIds: ["chunk-valid", "chunk-invalid"]
          }
        }
      },
      new Set(["chunk-valid"])
    );

    expect(normalized.requirements).toEqual(["Minimum TLS version"]);
    expect(normalized.extracted).toEqual([
      {
        requirement: "Minimum TLS version",
        value: "TLS 1.2+",
        supportingChunkIds: ["chunk-valid"]
      }
    ]);
    expect(normalized.overall).toBe("FOUND");
    expect(normalized.extractorInvalid).toBe(false);
  });

  it("normalizes requirements object map to requirements list", () => {
    const normalized = normalizeExtractorOutput(
      {
        requirements: {
          req1: "Current SOC 2 Type II report status"
        },
        extracted: {
          "Current SOC 2 Type II report status": {
            extractedValue: "Available",
            chunkIds: ["chunk-soc2"]
          }
        }
      },
      new Set(["chunk-soc2"])
    );

    expect(normalized.requirements).toEqual(["Current SOC 2 Type II report status"]);
    expect(normalized.extracted[0]).toEqual({
      requirement: "Current SOC 2 Type II report status",
      value: "Available",
      supportingChunkIds: ["chunk-soc2"]
    });
    expect(normalized.overall).toBe("FOUND");
  });

  it("does not apply top-level supportingChunkIds array to all extracted map items", () => {
    const normalized = normalizeExtractorOutput(
      {
        requirements: ["Requirement A", "Requirement B"],
        extracted: {
          "Requirement A": "Value A",
          "Requirement B": "Value B"
        },
        supportingChunkIds: ["chunk-1"]
      },
      new Set(["chunk-1"])
    );

    expect(normalized.extracted).toEqual([
      {
        requirement: "Requirement A",
        value: null,
        supportingChunkIds: []
      },
      {
        requirement: "Requirement B",
        value: null,
        supportingChunkIds: []
      }
    ]);
    expect(normalized.overall).toBe("NOT_FOUND");
    expect(normalized.extractorInvalid).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { CaptureFileSignature } from "@omnitwin/types";
import { classifyCaptureFile } from "../classify.js";

function signature(format: CaptureFileSignature["format"]): CaptureFileSignature {
  return {
    format,
    magicHex: "",
    e57Header:
      format === "e57"
        ? {
            versionMajor: 1,
            versionMinor: 0,
            physicalLengthBytes: 48,
            xmlPhysicalOffsetBytes: 0,
            xmlLogicalLengthBytes: 0,
            pageSizeBytes: 1024,
            fileLengthMatchesHeader: true,
          }
        : null,
  };
}

describe("classifyCaptureFile", () => {
  it("stages a structurally identified E57 as primary evidence", () => {
    expect(classifyCaptureFile("cloud_0.e57", signature("e57"))).toMatchObject({
      role: "primary_capture",
      disposition: "stage",
      confidence: "high",
    });
  });

  it("stages GUID-named MatterPak controls", () => {
    expect(
      classifyCaptureFile(
        "th obj/424ff41f6e5d41969c635fcd61be9b3f_000.jpg",
        signature("jpeg"),
      ),
    ).toMatchObject({ role: "vendor_control", disposition: "stage" });
  });

  it("excludes an aligned OBJ before vendor rules can accept it", () => {
    expect(
      classifyCaptureFile("th obj/TH_OBJ_RC_ALIGNED.obj", signature("wavefront_obj")),
    ).toMatchObject({ role: "experiment", disposition: "exclude", confidence: "high" });
  });

  it("keeps derived poses as reference-only evidence", () => {
    expect(classifyCaptureFile("poses.json", signature("json"))).toMatchObject({
      role: "derived_reference",
      disposition: "reference_only",
    });
  });
});

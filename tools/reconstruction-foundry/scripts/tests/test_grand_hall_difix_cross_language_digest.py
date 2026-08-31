from __future__ import annotations

import ast
from pathlib import Path
from types import FunctionType
import unittest


ADAPTER_PATH = (
    Path(__file__).resolve().parents[2]
    / "python"
    / "grand_hall_difix_no_reference_adapter.py"
)


def load_adapter_domain_digest() -> FunctionType:
    parsed = ast.parse(ADAPTER_PATH.read_text(encoding="utf-8"), filename=str(ADAPTER_PATH))
    required_names = {"canonical_json", "sha256_bytes", "domain_digest"}
    functions = [
        node
        for node in parsed.body
        if isinstance(node, ast.FunctionDef) and node.name in required_names
    ]
    if {function.name for function in functions} != required_names:
        raise RuntimeError("Could not extract the exact adapter digest implementation.")
    prelude = ast.parse(
        "from __future__ import annotations\nimport hashlib\nimport json\nfrom typing import Any\n"
    )
    module = ast.Module(body=[*prelude.body, *functions], type_ignores=[])
    ast.fix_missing_locations(module)
    namespace: dict[str, object] = {}
    exec(compile(module, str(ADAPTER_PATH), "exec"), namespace)  # noqa: S102 - exact source-selected test fixture
    value = namespace.get("domain_digest")
    if not isinstance(value, FunctionType):
        raise RuntimeError("Extracted adapter domain_digest is not callable.")
    return value


class GrandHallDifixCrossLanguageDigestTest(unittest.TestCase):
    def test_python_matches_the_shared_cross_language_golden_vector(self) -> None:
        domain_digest = load_adapter_domain_digest()
        value = {
            "nested": {
                "renderGenerationReceipt": "g",
                "rendererArtifact": "r",
            },
            "renderGenerationReceiptSha256": "g",
            "rendererArtifactSha256": "r",
        }
        self.assertEqual(
            domain_digest(
                "VENVIEWER_GRAND_HALL_DIFIX_CROSS_LANGUAGE_CANONICAL_TEST_V1",
                value,
            ),
            "sha256:e3d8ffd05318aca4cfc932d136fb27c348b0cf11e417e57f31aabcf0ad71299c",
        )


if __name__ == "__main__":
    unittest.main()

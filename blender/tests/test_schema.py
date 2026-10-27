import unittest

import support
from ewscene import schema

TOY = {
    "type": "object",
    "required": ["n", "tags"],
    "additionalProperties": False,
    "properties": {
        "n": {"type": "integer", "minimum": 0, "maximum": 10},
        "x": {"type": "number", "exclusiveMinimum": 0},
        "tags": {"type": "array", "minItems": 1, "maxItems": 2, "items": {"type": "string", "pattern": "^[a-z]+$"}},
        "kind": {"enum": ["a", "b"]},
        "v": {"const": 1},
        "name": {"type": ["string", "null"], "minLength": 2},
    },
}


class Validator(unittest.TestCase):
    def test_normal(self):
        self.assertEqual(schema.errors({"n": 3, "tags": ["ab"], "kind": "a", "v": 1, "name": None}, TOY), [])

    def test_each_rule_reports_its_path(self):
        cases = [
            ({"tags": ["a"]}, "$: missing n"),
            ({"n": 3, "tags": ["a"], "z": 1}, "$: unknown key z"),
            ({"n": 11, "tags": ["a"]}, "$.n: above 10"),
            ({"n": -1, "tags": ["a"]}, "$.n: below 0"),
            ({"n": 1.5, "tags": ["a"]}, "$.n: not integer"),
            ({"n": True, "tags": ["a"]}, "$.n: not integer"),
            ({"n": 1, "x": 0, "tags": ["a"]}, "$.x: not above 0"),
            ({"n": 1, "tags": []}, "$.tags: fewer than 1 items"),
            ({"n": 1, "tags": ["a", "b", "c"]}, "$.tags: more than 2 items"),
            ({"n": 1, "tags": ["A"]}, "$.tags[0]: does not match"),
            ({"n": 1, "tags": ["a"], "kind": "c"}, "$.kind: not one of"),
            ({"n": 1, "tags": ["a"], "v": 2}, "$.v: not 1"),
            ({"n": 1, "tags": ["a"], "name": "x"}, "$.name: shorter than 2"),
            ({"n": 1, "tags": ["a"], "name": 3}, "$.name: not string or null"),
        ]
        for doc, expected in cases:
            with self.subTest(expected=expected):
                errs = schema.errors(doc, TOY)
                self.assertTrue(any(e.startswith(expected) for e in errs), errs)

    def test_enum_and_const_match_the_type_too(self):
        cases = [
            ({"fps": {"enum": [24, 30]}}, {"fps": 24.0}, "$.fps: not one of"),
            ({"fps": {"enum": [24, 30]}}, {"fps": True}, "$.fps: not one of"),
            ({"v": {"const": 1}}, {"v": 1.0}, "$.v: not 1"),
            ({"v": {"const": True}}, {"v": 1}, "$.v: not true"),
            ({"v": {"const": 0}}, {"v": False}, "$.v: not 0"),
            ({"v": {"const": [1, 2]}}, {"v": [1, 2.0]}, "$.v: not [1, 2]"),
        ]
        for props, doc, expected in cases:
            with self.subTest(doc=doc):
                errs = schema.errors(doc, {"type": "object", "properties": props})
                self.assertTrue(any(e.startswith(expected) for e in errs), errs)
        self.assertEqual(schema.errors({"fps": 30}, {"properties": {"fps": {"enum": [24, 30]}}}), [])
        self.assertEqual(schema.errors({"v": 2.5}, {"properties": {"v": {"const": 2.5}}}), [])

    def test_numbers_must_be_finite(self):
        for bad in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=bad):
                errs = schema.errors({"n": 1, "x": bad, "tags": ["a"]}, TOY)
                self.assertTrue(any(e.startswith("$.x: not finite") for e in errs), errs)
                self.assertTrue(schema.errors({"x": [bad]}, {"properties": {"x": {"items": {}}}}))

    def test_a_final_dollar_does_not_match_before_a_newline(self):
        for value in ("abc\n", "ab\nc"):
            with self.subTest(value=value):
                errs = schema.errors({"n": 1, "tags": [value]}, TOY)
                self.assertTrue(any(e.startswith("$.tags[0]: does not match") for e in errs), errs)
        self.assertEqual(schema.errors("a$", {"type": "string", "pattern": "^a\\$"}), [])
        self.assertTrue(schema.errors("a$\n", {"type": "string", "pattern": "^a\\$$"}))
        self.assertEqual(schema.errors("a\\", {"type": "string", "pattern": "^a\\\\$"}), [])
        self.assertTrue(schema.errors("a\\\n", {"type": "string", "pattern": "^a\\\\$"}))

    def test_unsupported_keyword_is_refused(self):
        with self.assertRaises(ValueError):
            schema.errors({}, {"type": "object", "patternProperties": {}})

    def test_shipped_schemas_load(self):
        for name in ("scene-spec", "truth", "motion", "render"):
            with self.subTest(name=name):
                self.assertEqual(schema.load(name)["type"], "object")


if __name__ == "__main__":
    unittest.main()

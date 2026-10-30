import copy
import os
import unittest

import support
from ewscene import assets, house

CATALOG = assets.load_catalog()
RULES = house.load_rules()


def spec_of(name):
    return copy.deepcopy(support.load_json(os.path.join(support.REPO_DIR, "fixtures", "synthetic", name + "-before", "spec.json")))


def with_material(name, struct_id, material):
    doc = spec_of(name)
    next(s for s in doc["structures"] if s["id"] == struct_id)["material"] = material
    return doc


class WoodStructures(unittest.TestCase):
    def assertAHazard(self, doc, struct_id):
        try:
            house.validate(doc, CATALOG, RULES)
        except house.HouseError as error:
            self.fail("the house check refused it: %s" % error)
        found = {f["id"]: f for f in house.wood_findings(doc, RULES)}
        self.assertIn(struct_id, found, "it is not named as a hazard")
        self.assertEqual(RULES[found[struct_id]["rule_id"]]["concept"], "wood_deck")

    def test_a_hillside_house_with_a_wooden_deck(self):
        """a hillside house has a wooden deck and tall trees"""
        self.assertAHazard(with_material("hero", "back-deck", "wood"), "back-deck")

    def test_a_wooden_porch(self):
        """a hillside house has a wooden deck and tall trees (porches are decks at the front door)"""
        self.assertAHazard(with_material("hero", "front-porch", "wood"), "front-porch")

    def test_a_wooden_deck_beside_the_mobile_home(self):
        doc = with_material("mobile", "carport", "wood")
        next(s for s in doc["structures"] if s["id"] == "carport").update(id="side-deck", kind="deck", height_in=6)
        self.assertAHazard(doc, "side-deck")


if __name__ == "__main__":
    unittest.main()

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
    def assertAccepted(self, doc):
        try:
            house.validate(doc, CATALOG, RULES)
        except house.HouseError as error:
            self.fail("the house check refused it: %s" % error)

    def test_a_hillside_house_with_a_wooden_deck(self):
        """a hillside house has a wooden deck and tall trees"""
        self.assertAccepted(with_material("hero", "back-deck", "wood"))

    def test_a_wooden_porch(self):
        """a hillside house has a wooden deck and tall trees (porches are decks at the front door)"""
        self.assertAccepted(with_material("hero", "front-porch", "wood"))

    def test_a_wooden_carport(self):
        """a hillside house has a wooden deck and tall trees (a wooden carport burns the same way)"""
        self.assertAccepted(with_material("mobile", "carport", "wood"))


if __name__ == "__main__":
    unittest.main()

"""Deterministic ingredient-line parser (no-LLM ingestion paths)."""

import pytest

from mealy_worker.ingredients import parse_ingredient_line


def test_pound_line():
    ing = parse_ingredient_line("1 pound medium shrimp, peeled and deveined")
    assert ing.quantity == 1
    assert ing.unit == "pound"
    assert ing.name == "medium shrimp, peeled and deveined"
    assert ing.raw == "1 pound medium shrimp, peeled and deveined"


def test_no_quantity_passes_through():
    ing = parse_ingredient_line("Sea salt and black pepper")
    assert ing.quantity is None
    assert ing.unit is None
    assert ing.name == "Sea salt and black pepper"


def test_tablespoons():
    ing = parse_ingredient_line("4 tablespoons extra-virgin olive oil")
    assert ing.quantity == 4
    assert ing.unit == "tablespoons"
    assert ing.name == "extra-virgin olive oil"


def test_count_without_unit():
    ing = parse_ingredient_line("1 medium onion, chopped")
    assert ing.quantity == 1
    assert ing.unit is None
    assert ing.name == "medium onion, chopped"


def test_unicode_fraction():
    ing = parse_ingredient_line("⅔ cup ouzo")
    assert ing.quantity == pytest.approx(2 / 3, abs=1e-3)
    assert ing.unit == "cup"
    assert ing.name == "ouzo"


def test_ounces():
    ing = parse_ingredient_line("8 ounces crushed tomatoes")
    assert ing.quantity == 8
    assert ing.unit == "ounces"
    assert ing.name == "crushed tomatoes"


def test_mixed_fraction():
    ing = parse_ingredient_line("1 1/2 cups chicken stock")
    assert ing.quantity == 1.5
    assert ing.unit == "cups"
    assert ing.name == "chicken stock"


def test_mixed_unicode_fraction():
    ing = parse_ingredient_line("1½ tsp smoked paprika")
    assert ing.quantity == 1.5
    assert ing.unit == "tsp"
    assert ing.name == "smoked paprika"


def test_range_keeps_first_number():
    ing = parse_ingredient_line("2-3 garlic cloves, minced")
    assert ing.quantity == 2
    assert ing.unit is None
    assert ing.name == "garlic cloves, minced"


def test_range_with_to():
    ing = parse_ingredient_line("2 to 3 tablespoons harissa")
    assert ing.quantity == 2
    assert ing.unit == "tablespoons"
    assert ing.name == "harissa"


def test_french_line_with_de():
    ing = parse_ingredient_line("200 g de lardons")
    assert ing.quantity == 200
    assert ing.unit == "g"
    assert ing.name == "lardons"


def test_decimal_comma():
    ing = parse_ingredient_line("1,5 l d'eau")
    assert ing.quantity == 1.5
    assert ing.unit == "l"
    assert ing.name == "eau"


def test_alt_measure_parenthetical_after_unit():
    ing = parse_ingredient_line("1 pound (450 g) shrimp")
    assert ing.quantity == 1
    assert ing.unit == "pound"
    assert ing.name == "shrimp"


def test_parenthetical_without_unit_stays():
    ing = parse_ingredient_line("1 (14-ounce) can crushed tomatoes")
    assert ing.quantity == 1
    assert ing.unit is None
    assert ing.name == "(14-ounce) can crushed tomatoes"


def test_unit_word_prefix_not_matched_inside_name():
    # "l" must not be clipped out of "lemon".
    ing = parse_ingredient_line("1 lemon")
    assert ing.quantity == 1
    assert ing.unit is None
    assert ing.name == "lemon"


def test_bare_number_keeps_raw_as_name():
    ing = parse_ingredient_line("2")
    assert ing.quantity is None
    assert ing.name == "2"


def test_unit_with_trailing_period():
    ing = parse_ingredient_line("1 lb. steak")
    assert ing.quantity == 1
    assert ing.unit == "lb"
    assert ing.name == "steak"


def test_quitoque_cuillere_s_normalized():
    ing = parse_ingredient_line("1 cuillère(s) à soupe Huile de sésame")
    assert ing.quantity == 1
    assert ing.unit == "cuillère à soupe"
    assert ing.name == "Huile de sésame"

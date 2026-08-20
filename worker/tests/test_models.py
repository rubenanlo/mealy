"""Task 3 — canonical model tests."""

import json

import pytest
from pydantic import ValidationError

from mealy_worker.models import CanonicalRecipe, Ingredient, IngestResult, Verbatim


def test_canonical_recipe_round_trips_from_dict():
    data = {
        "title": "Poulet basquaise",
        "language": "fr",
        "servings": 4,
        "prep_minutes": 20,
        "cook_minutes": 45,
        "dish_type": "main",
        "tags": ["poulet", "basque"],
        "ingredients": [
            {
                "raw": "1 kg de poulet fermier",
                "quantity": 1000.0,
                "unit": "g",
                "name": "poulet fermier",
                "group": None,
                "fodmap": None,
            },
            {
                "raw": "2 poivrons rouges",
                "quantity": 2.0,
                "unit": None,
                "name": "poivron rouge",
                "group": None,
                "fodmap": None,
            },
        ],
        "steps": ["Faire revenir le poulet.", "Ajouter les poivrons."],
        "nutrition": None,
        "confidence": 0.9,
    }
    recipe = CanonicalRecipe.model_validate(data)
    assert recipe.title == "Poulet basquaise"
    assert recipe.ingredients[0].raw == "1 kg de poulet fermier"
    assert recipe.model_dump() == data


def test_ingredient_requires_raw_and_name():
    with pytest.raises(ValidationError):
        Ingredient(name="poulet")  # missing raw
    with pytest.raises(ValidationError):
        Ingredient(raw="1 kg de poulet")  # missing name
    ing = Ingredient(raw="1 kg de poulet", name="poulet")
    assert ing.quantity is None
    assert ing.unit is None
    assert ing.group is None
    assert ing.fodmap is None


def test_ingest_result_serialises_with_model_dump_json():
    result = IngestResult(
        verbatim=Verbatim(kind="paste", pasted="Recette: 200 g de riz.\nCuire."),
        canonical=CanonicalRecipe(
            title="Riz",
            language="fr",
            ingredients=[Ingredient(raw="200 g de riz", name="riz", quantity=200.0, unit="g")],
            steps=["Cuire."],
            confidence=0.8,
        ),
        needs_review=False,
        image_urls=[],
    )
    payload = json.loads(result.model_dump_json())
    assert payload["verbatim"]["kind"] == "paste"
    assert payload["verbatim"]["pasted"] == "Recette: 200 g de riz.\nCuire."
    assert payload["canonical"]["ingredients"][0]["raw"] == "200 g de riz"
    assert payload["needs_review"] is False
    assert payload["image_urls"] == []


def test_verbatim_kind_is_constrained():
    with pytest.raises(ValidationError):
        Verbatim(kind="carrier-pigeon")
    for kind in ("url", "reel", "photo", "pdf", "paste"):
        assert Verbatim(kind=kind).kind == kind


def test_ingest_result_allows_null_canonical():
    result = IngestResult(
        verbatim=Verbatim(kind="url", url="https://example.com", page_text="403 Forbidden"),
        canonical=None,
        needs_review=True,
    )
    assert result.canonical is None
    assert result.needs_review is True
    assert result.image_urls == []

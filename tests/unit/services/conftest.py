"""
Unit-level conftest for services tests.

The MagicMock stubs that isolate this directory's tests from the heavy
backend stack are managed by the parent conftest at ``tests/unit/conftest.py``.

Centralising the install/restore logic at the parent level allows pytest to
toggle the stubs in/out as collection crosses the services boundary, avoiding
``sys.modules`` poisoning of sibling test directories
(``tests/unit/tasks/``, ``tests/unit/test_coordinates.py``, etc.).

See ``tests/unit/conftest.py`` for the implementation and the post-mortem
note explaining why the install/restore must live at the parent level.

WARNING — MagicMock stubs masquent certains bugs (post-mortem 04)
--------------------------------------------------------------------
Ce conftest installe (via le parent ``tests/unit/conftest.py``) des
``MagicMock`` pour ``app.core.pdf_engine`` et plusieurs dépendances lourdes.
Cela a deux effets secondaires importants à connaître :

1. ``MagicMock`` implémente ``__getitem__`` par défaut : tout accès
   ``pdf_doc[i]`` réussit silencieusement et retourne un autre ``MagicMock``
   au lieu de lever ``TypeError``. Le bug ``LegacyDocumentProxy subscript``
   (``pdfDoc[i]``) aurait été INVISIBLE ici — les tests unitaires auraient
   été verts.

2. Les appels au vrai ``PDFEngine`` (pikepdf) ne sont jamais exercés depuis
   cette couche : les bugs d'``AttributeError``/``TypeError`` liés à l'API
   pikepdf ne peuvent pas être détectés ici.

Pour attraper ces régressions, utiliser les tests d'intégration :
  ``tests/integration/test_storage_integration.py``
    → Exercent le vrai ``PDFEngine`` + la vraie ``LegacyDocumentProxy``
    → Capturent les erreurs que les mocks rendent invisibles
    → N'utilisent PAS ``MagicMock`` pour ``pdf_engine``

Règle : chaque nouveau comportement de ``pdf_engine`` DOIT avoir un test
dans ``tests/integration/test_storage_integration.py``, pas seulement ici.
"""

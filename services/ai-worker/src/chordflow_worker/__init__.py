"""chordflow AI worker.

The worker talks to the web app only through the language-neutral worker HTTP
API (SPEC section 10). It never imports Node code and needs no GPU for tests.
"""

__version__ = "0.0.0"

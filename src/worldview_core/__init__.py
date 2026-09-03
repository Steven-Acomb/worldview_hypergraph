"""worldview-core: a portable JSON format for worldviews.

A worldview is a set of natural-language *statements* connected by
*arguments*, where an argument is a directed hyperedge from N premise
statements to M conclusion statements.  This package is the reference
implementation: load, validate, compute content-derived identities, run
structural queries, and diff two worldviews.

Typical use::

    from worldview_core import load, rests_on, compute_identities

    wv = load("my-worldview.json")
    print(rests_on(wv, "some-statement-id"))
    ids = compute_identities(wv)
"""

from .canon import H, canon
from .diff import diff
from .errors import LoadError, UnknownIdError, ValidationError, WorldviewError
from .graph import Graph
from .identity import Identities, compute_identities, prop_id
from .model import FORMAT, FORMAT_VERSION, Argument, Statement, Worldview, load, loads
from .queries import foundations, rests_on, sccs, supports, well_founded
from .validate import schema, validate_dict, validate_with_jsonschema

__version__ = "0.1.0"

__all__ = [
    "FORMAT",
    "FORMAT_VERSION",
    "Argument",
    "Graph",
    "H",
    "Identities",
    "LoadError",
    "Statement",
    "UnknownIdError",
    "ValidationError",
    "Worldview",
    "WorldviewError",
    "__version__",
    "canon",
    "compute_identities",
    "diff",
    "foundations",
    "load",
    "loads",
    "prop_id",
    "rests_on",
    "schema",
    "sccs",
    "supports",
    "validate_dict",
    "validate_with_jsonschema",
    "well_founded",
]

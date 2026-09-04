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
from .export import to_dot, to_mermaid
from .graph import Graph
from .identity import Identities, compute_identities, prop_id
from .lint import duplicates, empty_justifications, is_ought_gaps, lint_all, unused
from .merge import merge
from .model import FORMAT, FORMAT_VERSION, Argument, Statement, Worldview, load, loads
from .present import present
from .queries import foundations, plan, rests_on, sccs, supports, well_founded
from .stats import stats
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
    "duplicates",
    "empty_justifications",
    "foundations",
    "is_ought_gaps",
    "lint_all",
    "load",
    "loads",
    "merge",
    "plan",
    "present",
    "prop_id",
    "rests_on",
    "schema",
    "sccs",
    "stats",
    "supports",
    "to_dot",
    "to_mermaid",
    "unused",
    "validate_dict",
    "validate_with_jsonschema",
    "well_founded",
]

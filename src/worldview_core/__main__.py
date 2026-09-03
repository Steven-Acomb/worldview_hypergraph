"""Allow ``python -m worldview_core ...`` as an alias for the ``worldview`` CLI."""

import sys

from .cli import main

sys.exit(main())

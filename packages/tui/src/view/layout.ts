/** Column widths the screens are laid out with. Layout, not policy: changing
 * any of these changes how the product looks and nothing else. */
import { bound } from "@oma/domain/surface-bounds";

export const LAYOUT_BOUNDS = Object.freeze({
  labelColumn: bound(28, "cells", "widest Config label the screen shows"),
  minLabelColumn: bound(10, "cells", "keeps a label readable on a narrow terminal"),
  valueColumn: bound(24, "cells", "leaves room for the apply-scope note beside a value"),
  senderColumn: bound(14, "cells", "Mail sender column"),
  kindColumn: bound(12, "cells", "Mail kind column"),
  roleColumns: bound(26, "cells", "Extensions reserves this for both role columns"),
  minNameColumn: bound(12, "cells", "keeps an extension id readable on a narrow terminal"),
});

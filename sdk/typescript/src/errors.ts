/** Exception types for worldview-core. */

/** Base class for all worldview-core errors. */
export class WorldviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The text could not be read or parsed as JSON. */
export class LoadError extends WorldviewError {}

/**
 * The document is not a valid worldview-core file.
 *
 * `problems` is the full list of human-readable problem strings; the
 * message is the first of them (or a summary).
 */
export class ValidationError extends WorldviewError {
  readonly problems: string[];

  constructor(problems: readonly string[]) {
    const list = [...problems];
    super(
      list.length === 1
        ? (list[0] as string)
        : `${list.length} validation problems; first: ${list[0] ?? "(none)"}`,
    );
    this.problems = list;
  }
}

/** A query referenced a statement or argument id that is not in the file. */
export class UnknownIdError extends WorldviewError {
  readonly kind: "statement" | "argument";
  readonly id: string;

  constructor(kind: "statement" | "argument", id: string) {
    super(`no ${kind} with id ${JSON.stringify(id)}`);
    this.kind = kind;
    this.id = id;
  }
}

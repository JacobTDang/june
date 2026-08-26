import { describe, expect, it } from "vitest";
import {
  confirmedRemovals,
  removeById,
  restoreAt,
  withoutPending,
} from "../../src/lib/room/queue-edit";

/** Removing a queue row happens in the interface first and on the server
 *  second, which means two lists that briefly disagree. These are the rules for
 *  reconciling them — including the case that matters most, the delete that
 *  fails and has to put the row back exactly where it was. */

const row = (id: string) => ({ id, title: id.toUpperCase() });
const queue = () => [row("a"), row("b"), row("c")];

describe("removeById", () => {
  it("takes the row out and remembers where it sat", () => {
    const { next, removed, index } = removeById(queue(), "b");
    expect(next.map((t) => t.id)).toEqual(["a", "c"]);
    expect(removed?.id).toBe("b");
    expect(index).toBe(1);
  });

  it("leaves the list alone when the row has already gone", () => {
    const before = queue();
    const { next, removed, index } = removeById(before, "z");
    expect(next).toBe(before);
    expect(removed).toBeNull();
    expect(index).toBe(-1);
  });

  it("doesn't mutate the list it was given", () => {
    const before = queue();
    removeById(before, "a");
    expect(before.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("restoreAt", () => {
  it("puts a row back where it was", () => {
    const { next, removed, index } = removeById(queue(), "b");
    expect(restoreAt(next, removed!, index).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("puts it on the end when the queue has since shrunk", () => {
    expect(restoreAt([row("a")], row("b"), 9).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("puts it on the front for an index below the list", () => {
    expect(restoreAt([row("b")], row("a"), -3).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("doesn't double a row realtime has already brought back", () => {
    const current = queue();
    expect(restoreAt(current, row("b"), 1)).toBe(current);
  });
});

describe("withoutPending", () => {
  it("hides the rows whose delete is still in flight", () => {
    expect(withoutPending(queue(), new Set(["a", "c"])).map((t) => t.id)).toEqual(["b"]);
  });

  it("leaves the server's list alone when nothing is pending", () => {
    const server = queue();
    expect(withoutPending(server, new Set()).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("confirmedRemovals", () => {
  it("names the ids the server has caught up with", () => {
    // "c" is gone from the server's list, so its tombstone has done its job and
    // can be dropped; "a" is still there, so it has to keep hiding the row.
    expect(confirmedRemovals(["a", "c"], [row("a"), row("b")])).toEqual(["c"]);
  });

  it("names none while every removed row is still on the server", () => {
    expect(confirmedRemovals(["a"], queue())).toEqual([]);
  });

  it("names none when nothing is pending", () => {
    expect(confirmedRemovals([], queue())).toEqual([]);
  });
});

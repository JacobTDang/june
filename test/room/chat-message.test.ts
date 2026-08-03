import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  groupMessages,
  mergeMessages,
  normalizeMessageBody,
  type ChatMessage,
} from "../../src/lib/room/chat-message";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    userId: "u1",
    name: "Uso",
    body: "hey",
    createdAt: 1_000,
    ...overrides,
  };
}

describe("normalizeMessageBody", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeMessageBody("  hello  ")).toBe("hello");
  });

  it("rejects a message that is empty or only whitespace", () => {
    expect(normalizeMessageBody("")).toBeNull();
    expect(normalizeMessageBody("   \n\t ")).toBeNull();
  });

  it("rejects a message longer than the limit rather than silently truncating it", () => {
    // Truncating would send something the author didn't write; the caller
    // surfaces the rejection instead.
    expect(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH))).toBe(
      "x".repeat(MAX_MESSAGE_LENGTH),
    );
    expect(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH + 1))).toBeNull();
  });

  it("measures the limit after trimming, so trailing spaces can't push it over", () => {
    expect(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH) + "   ")).toBe(
      "x".repeat(MAX_MESSAGE_LENGTH),
    );
  });
});

describe("mergeMessages", () => {
  it("adds new messages in send order", () => {
    const merged = mergeMessages(
      [message({ id: "a", createdAt: 1 })],
      [message({ id: "b", createdAt: 2 })],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("ignores a message it already has, so realtime and polling can't double it up", () => {
    const existing = [message({ id: "a", createdAt: 1 })];
    const merged = mergeMessages(existing, [message({ id: "a", createdAt: 1 })]);
    expect(merged).toHaveLength(1);
  });

  it("sorts by send time, so an out-of-order delivery still lands in place", () => {
    const merged = mergeMessages(
      [message({ id: "b", createdAt: 2 })],
      [message({ id: "a", createdAt: 1 })],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("breaks ties on id so equal timestamps produce a stable order", () => {
    const merged = mergeMessages(
      [message({ id: "b", createdAt: 5 })],
      [message({ id: "a", createdAt: 5 })],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("groupMessages", () => {
  it("groups consecutive messages from the same author", () => {
    const groups = groupMessages([
      message({ id: "a", userId: "u1", createdAt: 0 }),
      message({ id: "b", userId: "u1", createdAt: 1_000 }),
      message({ id: "c", userId: "u2", createdAt: 2_000 }),
    ]);
    expect(groups.map((g) => g.messages.map((m) => m.id))).toEqual([["a", "b"], ["c"]]);
    expect(groups.map((g) => g.userId)).toEqual(["u1", "u2"]);
  });

  it("starts a new group when the same author returns after a long gap", () => {
    const groups = groupMessages([
      message({ id: "a", userId: "u1", createdAt: 0 }),
      message({ id: "b", userId: "u1", createdAt: 10 * 60_000 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("returns nothing for an empty log", () => {
    expect(groupMessages([])).toEqual([]);
  });
});

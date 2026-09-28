import { describe, expect, it } from "vitest";
import type { PinService } from "../../src/audio/pins";
import { sendKeepList, type KeepListStore } from "../../src/lib/spotify/keep-list";

function fakePins() {
  const sent: (readonly string[])[] = [];
  const pins: PinService = {
    async replacePins(videoIds) {
      sent.push(videoIds);
      return { count: videoIds.length, added: videoIds.length, removed: 0 };
    },
  };
  return { pins, sent };
}

const storeOf = (ids: string[]): KeepListStore => ({ libraryVideoIds: async () => ids });

describe("sendKeepList", () => {
  it("sends every video id in the libraries, as one set", async () => {
    const { pins, sent } = fakePins();

    const result = await sendKeepList(storeOf(["aaaaaaaaaaa", "bbbbbbbbbbb"]), pins);

    expect(sent).toEqual([["aaaaaaaaaaa", "bbbbbbbbbbb"]]);
    expect(result).toEqual({ count: 2, added: 2, removed: 0 });
  });

  it("sends an empty list when no library holds a matched song, clearing the pins", async () => {
    const { pins, sent } = fakePins();
    await sendKeepList(storeOf([]), pins);
    expect(sent).toEqual([[]]);
  });

  it("lets a failing read stop the send", async () => {
    const { pins, sent } = fakePins();
    const failing: KeepListStore = {
      async libraryVideoIds() {
        throw new Error("read the keep list: boom");
      },
    };
    await expect(sendKeepList(failing, pins)).rejects.toThrow(/boom/);
    expect(sent).toEqual([]);
  });
});

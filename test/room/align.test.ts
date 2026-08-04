import { describe, expect, it } from "vitest";
import { MIN_CHAT_LOG_PX, alignedLogHeight } from "../../src/lib/room/align";

describe("alignedLogHeight", () => {
  it("makes the composer land exactly on the search bar", () => {
    // The log ends where the composer begins, minus the gap between them.
    expect(alignedLogHeight({ searchTop: 549, logTop: 239, gap: 13 })).toBe(297);
  });

  it("follows the search bar when it moves", () => {
    // A track starting adds the now-playing block, pushing search down ~85px;
    // the log has to grow by the same amount or the bars drift apart.
    const idle = alignedLogHeight({ searchTop: 464, logTop: 239, gap: 13 });
    const playing = alignedLogHeight({ searchTop: 549, logTop: 239, gap: 13 });
    expect(playing - idle).toBe(85);
  });

  it("keeps a usable log when the search bar sits high", () => {
    // A short centre column would otherwise compute a log of nothing, leaving
    // a chat you can't read. Alignment is worth less than a working chat.
    expect(alignedLogHeight({ searchTop: 250, logTop: 239, gap: 13 })).toBe(MIN_CHAT_LOG_PX);
  });

  it("refuses nonsense measurements rather than producing a negative box", () => {
    expect(alignedLogHeight({ searchTop: 0, logTop: 0, gap: 0 })).toBe(MIN_CHAT_LOG_PX);
    expect(alignedLogHeight({ searchTop: 100, logTop: 500, gap: 13 })).toBe(MIN_CHAT_LOG_PX);
  });

  it("rounds to whole pixels", () => {
    expect(alignedLogHeight({ searchTop: 549.6, logTop: 239.2, gap: 12.75 })).toBe(298);
  });
});

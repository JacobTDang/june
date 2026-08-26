import { describe, expect, it } from "vitest";
import {
  ROW_EXIT_MS,
  rowExit,
  swipeAxis,
  swipeCommitDistance,
  swipeOffset,
  swipeRelease,
} from "../../src/lib/room/swipe";

/** The queue row carries three gestures at once: the page scrolls through it,
 *  the handle reorders it, and now a sideways drag deletes it. These hold the
 *  arbitration between them, which is the part that can't be eyeballed. */

describe("swipeAxis", () => {
  it("commits to nothing until the finger has actually travelled", () => {
    // A tap wobbles by a pixel or two. Deciding on that would steal the first
    // moment of every scroll.
    expect(swipeAxis(0, 0)).toBe("undecided");
    expect(swipeAxis(6, 0)).toBe("undecided");
    expect(swipeAxis(0, -8)).toBe("undecided");
    expect(swipeAxis(7, 7)).toBe("undecided");
  });

  it("reads a mostly-sideways drag as a swipe", () => {
    expect(swipeAxis(14, 2)).toBe("horizontal");
    expect(swipeAxis(60, -20)).toBe("horizontal");
    // Backwards is still sideways: the row resists rather than the page
    // lurching off under a drag that was clearly horizontal.
    expect(swipeAxis(-30, 4)).toBe("horizontal");
  });

  it("leaves a mostly-upright drag to the page", () => {
    expect(swipeAxis(2, 14)).toBe("vertical");
    expect(swipeAxis(-6, -40)).toBe("vertical");
  });

  it("gives a diagonal to the page", () => {
    // Scrolling is the gesture people do a hundred times a session and the one
    // that hurts most when it's stolen, so it wins the ties.
    expect(swipeAxis(20, 20)).toBe("vertical");
    expect(swipeAxis(-20, 20)).toBe("vertical");
  });
});

describe("swipeOffset", () => {
  it("follows the finger to the right", () => {
    expect(swipeOffset(0)).toBe(0);
    expect(swipeOffset(84)).toBe(84);
  });

  it("resists a pull the other way instead of following it", () => {
    // Nothing lives to the left of the row, so a leftward drag gets a short
    // rubber band and no further — it reads as "not that way" rather than dead.
    expect(swipeOffset(-9)).toBe(-3);
    expect(swipeOffset(-300)).toBe(-16);
    expect(swipeOffset(-300)).toBeGreaterThan(-17);
  });
});

describe("swipeCommitDistance", () => {
  it("asks for about a third of the row", () => {
    expect(swipeCommitDistance(320)).toBe(112);
  });

  it("caps the distance on a wide row", () => {
    // A third of a desktop rail is a marathon; past a point the gesture has
    // plainly been made.
    expect(swipeCommitDistance(900)).toBe(120);
  });

  it("keeps a floor on a narrow one", () => {
    expect(swipeCommitDistance(90)).toBe(40);
  });

  it("falls back to the floor when the row hasn't been measured", () => {
    expect(swipeCommitDistance(0)).toBe(40);
    expect(swipeCommitDistance(Number.NaN)).toBe(40);
  });
});

describe("swipeRelease", () => {
  it("removes the row once the swipe is past the threshold", () => {
    expect(swipeRelease(120, 320)).toBe("remove");
    expect(swipeRelease(112, 320)).toBe("remove");
  });

  it("springs back from a swipe that stopped short", () => {
    expect(swipeRelease(111, 320)).toBe("return");
    expect(swipeRelease(12, 320)).toBe("return");
  });

  it("never removes on a drag the wrong way", () => {
    expect(swipeRelease(-400, 320)).toBe("return");
  });
});

describe("rowExit", () => {
  it("leaves left to right, easing out, in about a fifth of a second", () => {
    expect(ROW_EXIT_MS).toBe(200);
    const exit = rowExit(false);
    expect(exit.x).toBe("110%");
    expect(exit.opacity).toBe(0);
    expect(exit.transition.duration).toBe(ROW_EXIT_MS / 1000);
    // The stylesheet's --ease, so a row leaves on the same curve as everything
    // else that moves in this app.
    expect(exit.transition.ease).toEqual([0.22, 1, 0.36, 1]);
  });

  it("just goes, with no travel, when the reader asked for less motion", () => {
    const exit = rowExit(true);
    expect(exit.x).toBeUndefined();
    expect(exit.transition.duration).toBe(0);
  });
});

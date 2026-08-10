import { describe, expect, it } from "vitest";
import { parseSseFrames } from "./sse-client";

describe("parseSseFrames", () => {
  it("разбирает два полных кадра из одного буфера", () => {
    const { frames, rest } = parseSseFrames(
      'event: token\ndata: {"text":"раз"}\n\nevent: done\ndata: {"messageId":7}\n\n',
    );

    expect(frames).toEqual([
      { event: "token", data: { text: "раз" } },
      { event: "done", data: { messageId: 7 } },
    ]);
    expect(rest).toBe("");
  });

  it("оставляет незавершённый кадр в остатке", () => {
    const { frames, rest } = parseSseFrames('event: token\ndata: {"text":"раз"}\n\nevent: to');

    expect(frames).toHaveLength(1);
    expect(rest).toBe("event: to");
  });

  it("склеивает многострочный data по спецификации SSE", () => {
    const { frames } = parseSseFrames('event: done\ndata: {"text":\ndata: "два"}\n\n');
    expect(frames[0].data).toEqual({ text: "два" });
  });

  it("молча пропускает кадр, в котором не JSON", () => {
    const { frames } = parseSseFrames("event: token\ndata: не json\n\n");
    expect(frames).toEqual([]);
  });

  it("считает кадр без event сообщением по умолчанию", () => {
    const { frames } = parseSseFrames('data: {"text":"раз"}\n\n');
    expect(frames[0].event).toBe("message");
  });
});

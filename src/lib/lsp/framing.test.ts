import { describe, expect, it } from "vitest";
import { FrameReader, encodeFrame } from "./framing";

describe("encodeFrame", () => {
  it("считает длину в байтах, а не в символах", () => {
    const frame = encodeFrame({ text: "матрица" });
    const header = frame.toString("utf8").split("\r\n\r\n")[0];
    const body = JSON.stringify({ text: "матрица" });
    expect(header).toBe(`Content-Length: ${Buffer.byteLength(body, "utf8")}`);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(body.length);
  });
});

describe("FrameReader", () => {
  it("читает два кадра из одного чанка", () => {
    const reader = new FrameReader();
    const chunk = Buffer.concat([encodeFrame({ id: 1 }), encodeFrame({ id: 2 })]);
    expect(reader.push(chunk)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("собирает кадр, разрезанный посередине тела", () => {
    const reader = new FrameReader();
    const frame = encodeFrame({ method: "initialize" });
    expect(reader.push(frame.subarray(0, 30))).toEqual([]);
    expect(reader.push(frame.subarray(30))).toEqual([{ method: "initialize" }]);
  });

  it("собирает кадр, разрезанный внутри заголовка", () => {
    const reader = new FrameReader();
    const frame = encodeFrame({ ok: true });
    expect(reader.push(frame.subarray(0, 8))).toEqual([]);
    expect(reader.push(frame.subarray(8))).toEqual([{ ok: true }]);
  });

  it("многобайтное тело не обрезается по символам", () => {
    const reader = new FrameReader();
    const message = { hover: "Транспонирование матрицы — строки становятся столбцами" };
    expect(reader.push(encodeFrame(message))).toEqual([message]);
  });

  it("кадр с телом, которое не разбирается как JSON, пропускается, а не рушит поток", () => {
    const reader = new FrameReader();
    const broken = Buffer.from("Content-Length: 5\r\n\r\n{нет}", "utf8");
    expect(reader.push(broken)).toEqual([]);
    expect(reader.push(encodeFrame({ next: true }))).toEqual([{ next: true }]);
  });
});

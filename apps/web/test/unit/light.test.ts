import { describe, expect, it, vi } from "vitest";
import { browserLight, LIGHT_SIZE, meanLight } from "../../src/light.ts";
import { fakeStream } from "./fakes.ts";

const pixels = (...rgb: [number, number, number][]) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

describe("meanLight", () => {
  it("reads black as 0, white as 255 and green brighter than red and red brighter than blue, as the eye sees them", () => {
    expect(meanLight(pixels([0, 0, 0]))).toBe(0);
    expect(meanLight(pixels([255, 255, 255]))).toBe(255);
    const [red, green, blue] = [meanLight(pixels([255, 0, 0])), meanLight(pixels([0, 255, 0])), meanLight(pixels([0, 0, 255]))];
    expect(green).toBeGreaterThan(red!);
    expect(red).toBeGreaterThan(blue!);
    expect([red, green, blue]).toEqual([76, 150, 29]);
  });

  it("averages every pixel and ignores the alpha channel", () => {
    expect(meanLight(pixels([0, 0, 0], [255, 255, 255]))).toBe(128);
    expect(meanLight(new Uint8ClampedArray([200, 200, 200, 0]))).toBe(200);
  });

  it("gives no reading for an empty picture", () => {
    expect(meanLight(new Uint8ClampedArray(0))).toBeNull();
    expect(meanLight(new Uint8ClampedArray(3))).toBeNull();
  });
});

type FakeContext = { drawImage: ReturnType<typeof vi.fn>; getImageData: ReturnType<typeof vi.fn> };

const fakeDocument = (context: FakeContext | null, readyState = 4) => {
  const video = { muted: false, playsInline: false, srcObject: null as MediaStream | null, readyState, play: vi.fn(async () => undefined) };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
  const doc = { createElement: (name: string) => (name === "video" ? video : canvas) } as unknown as Pick<Document, "createElement">;
  return { doc, video, canvas };
};

const lit = (value: number): FakeContext => ({
  drawImage: vi.fn(),
  getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(value) })),
});

describe("browserLight", () => {
  it("plays the camera muted into a small picture and reads its light", () => {
    const context = lit(90);
    const { doc, video, canvas } = fakeDocument(context);
    const { stream } = fakeStream();
    const meter = browserLight(doc)(stream);
    expect(video).toMatchObject({ muted: true, playsInline: true, srcObject: stream });
    expect(video.play).toHaveBeenCalledOnce();
    expect([canvas.width, canvas.height]).toEqual([LIGHT_SIZE.width, LIGHT_SIZE.height]);
    expect(meter?.read()).toBe(90);
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, LIGHT_SIZE.width, LIGHT_SIZE.height);
    meter?.stop();
    expect(video.srcObject).toBeNull();
  });

  it("gives no reading before the camera shows a picture, or when the picture cannot be read", () => {
    const waiting = fakeDocument(lit(90), 1);
    expect(browserLight(waiting.doc)(fakeStream().stream)?.read()).toBeNull();
    expect(browserLight(fakeDocument(lit(90), 2).doc)(fakeStream().stream)?.read()).toBe(90);
    const refusing = lit(90);
    refusing.getImageData.mockImplementation(() => {
      throw new DOMException("The canvas has been tainted", "SecurityError");
    });
    expect(browserLight(fakeDocument(refusing).doc)(fakeStream().stream)?.read()).toBeNull();
  });

  it("gives no meter when the browser cannot draw a picture", () => {
    expect(browserLight(fakeDocument(null).doc)(fakeStream().stream)).toBeNull();
  });
});

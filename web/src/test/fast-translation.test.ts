import { afterEach, describe, expect, it, vi } from "vitest";

import { translateFastSegments } from "@/lib/fast-translation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("translateFastSegments", () => {
  it("translates complete documents with Chrome's local engine without calling the Gateway", async () => {
    const fetchMock = vi.fn();
    const destroy = vi.fn();
    const translate = vi.fn(async (text: string) => `Local:${text}`);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Translator", {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockResolvedValue({ translate, destroy }),
    });

    const result = await translateFastSegments({
      segments: [
        { id: "a", text: "Dose 5 mg" },
        { id: "b", text: "Blood pressure 120/80" },
      ],
      sourceLanguage: "en",
      targetLanguage: "es",
    });

    expect(result.a).toContain("5");
    expect(result.b).toContain("120/80");
    expect(translate).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses larger document batches to stay below the Gateway request-rate ceiling", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { texts: { id: string; text: string }[] };
      return new Response(JSON.stringify({
        translations: body.texts.map((item) => ({ id: item.id, text: `T:${item.text}` })),
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const segments = Array.from({ length: 321 }, (_, index) => ({
      id: `segment-${index}`,
      text: `Clinical document row ${index}`,
    }));
    const result = await translateFastSegments({
      segments,
      sourceLanguage: "en",
      targetLanguage: "es",
    });

    expect(Object.keys(result)).toHaveLength(321);
    expect(fetchMock).toHaveBeenCalledTimes(14);
  });

  it("requeues ids omitted by a successful response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ translations: [{ id: "a", text: "Uno" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ translations: [{ id: "b", text: "Dos" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(translateFastSegments({
      segments: [{ id: "a", text: "One" }, { id: "b", text: "Two" }],
      sourceLanguage: "en",
      targetLanguage: "es",
    })).resolves.toEqual({ a: "Uno", b: "Dos" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops a provider retry storm without splitting into single segments", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = translateFastSegments({
      segments: [{ id: "a", text: "One" }, { id: "b", text: "Two" }],
      sourceLanguage: "en",
      targetLanguage: "es",
    });
    const rejection = expect(promise).rejects.toThrow("El avance quedó guardado");
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("treats repeated network failures as provider unavailability", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const promise = translateFastSegments({
      segments: [{ id: "a", text: "One" }, { id: "b", text: "Two" }],
      sourceLanguage: "en",
      targetLanguage: "es",
    });
    const rejection = expect(promise).rejects.toThrow("El avance quedó guardado");
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

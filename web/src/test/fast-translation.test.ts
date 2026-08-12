import { afterEach, describe, expect, it, vi } from "vitest";

import { translateFastSegments } from "@/lib/fast-translation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("translateFastSegments", () => {
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

  it("splits a failed multi-segment batch instead of dropping the rest", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "saturado" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ translations: [{ id: "a", text: "Uno" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ translations: [{ id: "b", text: "Dos" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = translateFastSegments({
      segments: [{ id: "a", text: "One" }, { id: "b", text: "Two" }],
      sourceLanguage: "en",
      targetLanguage: "es",
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ a: "Uno", b: "Dos" });
  });
});

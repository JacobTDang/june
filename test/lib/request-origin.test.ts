import { describe, expect, it } from "vitest";
import { requestOrigin } from "../../src/lib/request-origin";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("requestOrigin", () => {
  it("uses the host the browser sent, not the one next dev names itself", () => {
    // next dev builds request.url from its own hostname, so a browser at
    // 127.0.0.1 still arrives as localhost.
    const req = request("http://localhost:3000/api/spotify/connect", { host: "127.0.0.1:3000" });
    expect(requestOrigin(req)).toBe("http://127.0.0.1:3000");
  });

  it("keeps the production domain as it is", () => {
    const req = request("https://june-jam.vercel.app/auth/callback", {
      host: "june-jam.vercel.app",
      "x-forwarded-proto": "https",
    });
    expect(requestOrigin(req)).toBe("https://june-jam.vercel.app");
  });

  it("takes the first protocol when a proxy chain lists several", () => {
    const req = request("http://localhost:3000/", { host: "june-jam.vercel.app", "x-forwarded-proto": "https,http" });
    expect(requestOrigin(req)).toBe("https://june-jam.vercel.app");
  });

  it("falls back to the request URL when there is no Host header", () => {
    expect(requestOrigin(request("http://localhost:3000/x"))).toBe("http://localhost:3000");
  });
});

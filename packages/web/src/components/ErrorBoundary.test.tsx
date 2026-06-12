import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorFallback } from "./ErrorBoundary";

describe("ErrorFallback", () => {
  it("renders the branded card with message and reload action", () => {
    const html = renderToStaticMarkup(<ErrorFallback error={new Error("kaput")} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("kaput");
    expect(html).toContain("Reload");
  });
});

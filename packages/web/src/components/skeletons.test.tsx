import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableSkeleton, CardSkeleton } from "./skeletons";

describe("skeletons", () => {
  it("TableSkeleton renders rows × cols cells", () => {
    const html = renderToStaticMarkup(<TableSkeleton rows={3} cols={4} />);
    expect(html.match(/data-skeleton-cell/g)).toHaveLength(12);
  });
  it("CardSkeleton renders a card shell", () => {
    expect(renderToStaticMarkup(<CardSkeleton />)).toContain("rounded-xl");
  });
});

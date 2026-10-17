// Aggregates every StarPets pet listing into { "pet_name|VARIANT": cheapest_usd }.
// The CDN serves the cached blob instantly and refreshes it in the background.

const SOURCE = "https://market.apineural.com/api/v2/store/items/all";
const PAGE_SIZE = 200;
const MAX_PAGES = 60;

const variantOf = ({ pumping, flyable, rideable }) =>
  (pumping === "mega_neon" ? "M" : pumping === "neon" ? "N" : "") +
  (flyable ? "F" : "") +
  (rideable ? "R" : "");

const keyOf = (name, listing) =>
  `${String(name).toLowerCase().replace(/[\s-]+/g, "_")}|${variantOf(listing)}`;

async function fetchPage(page) {
  const response = await fetch(SOURCE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: { types: [{ type: "pet" }] },
      page,
      amount: PAGE_SIZE,
      currency: "usd",
      sort: { popularity: "desc" },
    }),
  });
  if (!response.ok) throw new Error(`StarPets responded ${response.status}`);
  return response.json();
}

export default async function handler(_request, response) {
  const prices = {};
  let page = 1;
  let pages = 1;

  try {
    do {
      const { items = [], count } = await fetchPage(page);
      if (!items.length) break;
      pages = Math.min(MAX_PAGES, Math.ceil((count ?? items.length) / PAGE_SIZE));
      for (const listing of items) {
        const price = Number(listing.price);
        if (!listing.realName || !(price > 0)) continue;
        const key = keyOf(listing.realName, listing);
        if (!(key in prices) || price < prices[key]) prices[key] = price;
      }
      page += 1;
    } while (page <= pages);
  } catch (error) {
    // Serve whatever was collected; a short cache lets the next hit retry.
    response.setHeader("Cache-Control", "public, s-maxage=60");
    return response.status(Object.keys(prices).length ? 200 : 502).json({
      error: String(error.message || error),
      updated: Date.now(),
      prices,
    });
  }

  response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  return response.json({ updated: Date.now(), count: Object.keys(prices).length, prices });
}

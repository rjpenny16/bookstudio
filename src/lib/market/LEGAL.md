# Market data sources

BookStudio does not scrape Amazon. Market data comes only from the two paid APIs below, under the account holder's own subscription. The keys stay in the server's environment. Confirm each provider's current terms before relying on this summary, and re-check them when they change.

| | Keepa | DataForSEO |
|---|---|---|
| **Used for** | Competing books for a search: title, author, price, Best Sellers Rank, reviews, rating, page count, publication date, cover image URL, and BSR history for your own ASINs | Monthly Amazon search volumes for phrases, related phrases for a seed, and phrases a competing ASIN ranks for |
| **Contractual basis** | Keepa API subscription ([keepa.com/#!api](https://keepa.com/#!api)), Keepa's Terms of Service | DataForSEO account ([dataforseo.com](https://dataforseo.com)), DataForSEO's Terms of Service |
| **Rate limits and cost** | Token-based. The plan sets the refill rate. A search for a book idea costs about 20 tokens (two result pages), and a history lookup about 1 token per ASIN. A 429 response is reported to the user and not retried. | Pay per request. Each response reports its cost, and Settings shows the running total. |
| **Retention** | Each search is cached in the user's browser (IndexedDB) for 7 days, then fetched again. A book keeps the snapshot it was planned against in its project file. | Same as Keepa |
| **Redistribution** | None. Data is shown only to the account holder in their own BookStudio. Export packages carry only the book's own listing, never competitor data or images. Cover image URLs point at Amazon's CDN and are not downloaded into exports. | None. Volumes inform keyword choice and are not published. |

## Estimates

- Search volumes and sales ranks are values the provider observed.
- Anything derived from them is labelled as an estimate wherever it appears: monthly sales from rank, opportunity scores, recommended prices.
- Sales estimates fitted to the user's own royalty reports say how many data points they rest on.

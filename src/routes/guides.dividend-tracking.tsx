import { createFileRoute, Link } from "@tanstack/react-router";

const TITLE = "Dividend Tracking Guide — Golden Compass";
const DESCRIPTION =
  "Learn how to track dividends from Golden Compass investment pools: how distributions are calculated, when they hit your wallet, and how to monitor yield over time.";

export const Route = createFileRoute("/guides/dividend-tracking")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "/guides/dividend-tracking" },
    ],
    links: [{ rel: "canonical", href: "/guides/dividend-tracking" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "Dividend Tracking Guide",
          description: DESCRIPTION,
          author: { "@type": "Organization", name: "Golden Compass" },
          publisher: { "@type": "Organization", name: "Golden Compass" },
          mainEntityOfPage: "/guides/dividend-tracking",
        }),
      },
    ],
  }),
  component: DividendTrackingGuide,
});

function DividendTrackingGuide() {
  return (
    <article className="flex flex-col gap-6 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          GUIDES · YIELD
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 24 }}>
          Dividend Tracking
        </h1>
        <p className="t-serif t-sec mt-2" style={{ fontSize: 14, fontStyle: "italic" }}>
          How distributions from Golden Compass pools reach your wallet — and how to
          measure the yield you're actually earning.
        </p>
      </header>

      <section className="glass-gold rounded-2xl p-5">
        <h2 className="t-display t-parch" style={{ fontSize: 16 }}>
          How dividends work in a pool
        </h2>
        <p className="t-serif t-sec mt-2" style={{ fontSize: 13 }}>
          Each Golden Compass pool holds a basket of income-producing assets.
          Coupons, interest, and dividends collected by the pool are re-priced into
          the pool's NAV daily. When a distribution is declared, your share is
          credited to your wallet in KES based on the units you held on the record
          date.
        </p>
      </section>

      <section className="glass-gold rounded-2xl p-5">
        <h2 className="t-display t-parch" style={{ fontSize: 16 }}>
          Where to find your dividends
        </h2>
        <ul className="t-serif t-sec mt-2 space-y-2" style={{ fontSize: 13 }}>
          <li>
            <strong className="t-parch">Wallet balance</strong> — distributions
            land here as a credit transaction tagged <em>Dividend</em>.
          </li>
          <li>
            <strong className="t-parch">History</strong> — every distribution
            appears in your transaction log with pool, amount, and date.
          </li>
          <li>
            <strong className="t-parch">Pool NAV</strong> — between distributions,
            unrealised yield shows up as NAV growth on the pool card.
          </li>
        </ul>
      </section>

      <section className="glass-gold rounded-2xl p-5">
        <h2 className="t-display t-parch" style={{ fontSize: 16 }}>
          Measuring real yield
        </h2>
        <p className="t-serif t-sec mt-2" style={{ fontSize: 13 }}>
          To estimate annualised yield, sum the dividends paid into your wallet
          over the last 12 months and divide by your average invested principal
          across that window. Reinvested distributions compound — so cash yield
          will understate total return when NAV is also rising.
        </p>
      </section>

      <section className="glass-gold rounded-2xl p-5">
        <h2 className="t-display t-parch" style={{ fontSize: 16 }}>
          Next steps
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          <Link to="/pools" className="btn-brass text-center" style={{ padding: "12px 16px", fontSize: 11 }}>
            Explore investment pools
          </Link>
          <Link
            to="/history"
            className="t-mono t-sec text-center"
            style={{ fontSize: 10, letterSpacing: "0.14em" }}
          >
            VIEW YOUR DISTRIBUTION HISTORY →
          </Link>
        </div>
      </section>
    </article>
  );
}

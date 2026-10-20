// ---------------------------------------------------------------------------
// Competitor prices: the plug-in point for a licensed data feed.
//
// Blake (17 October 2026) chose a licensed data provider for competitors'
// prices; which provider is still being researched. This file is therefore
// an interface and nothing more:
//
//   - no implementation ships here or anywhere else;
//   - nothing scrapes a website, and nothing calls out to a provider;
//   - no route, job or suggestion reads competitor prices today.
//
// A licensed feed implements CompetitorPriceSource once its contract and
// licence are signed. Its observations carry their provenance (who supplied
// them, under which licence, when they were read) so any screen showing one
// can say who stated the figure and when.
//
// COMPETITOR PRICES MUST NEVER SET OR CHANGE A PRICE AUTOMATICALLY.
// The UK Competition and Markets Authority warns that pricing algorithms
// which react to competitors' prices, above all through a common tool or
// data provider, can facilitate collusion or amount to it, which the
// Competition Act 1998 (Chapter I) prohibits; see the CMA's paper
// "Algorithms: How they can reduce competition and harm consumers" (2021)
// and its guidance for businesses on pricing algorithms. A competitor's
// figure may only ever be shown to a person, as context, beside the venue's
// own reasoning. It is not an input to services/pricing-advice.ts, whose
// suggestions rest on the venue's own record, and a person decides every
// price in the Pricing desk's ordinary form.
// ---------------------------------------------------------------------------

/** Where an observation came from: the provider, the licence it is held
 *  under, and when the provider read it. */
export interface CompetitorPriceProvenance {
  readonly provider: string;
  /** The licence or contract reference the data is held under. */
  readonly licence: string;
  /** ISO 8601 instant the provider observed the price. */
  readonly observedAt: string;
}

/** One published price of another venue, as a licensed feed reports it. */
export interface CompetitorPriceObservation {
  readonly provenance: CompetitorPriceProvenance;
  /** The other venue's name as the provider gives it. */
  readonly venueName: string;
  /** The space or package the price is for, in the provider's words. */
  readonly offering: string;
  /** YYYY-MM-DD: the event date the price is for, when the provider gives one. */
  readonly eventDate: string | null;
  /** The provider's description of the time of day, when it gives one. */
  readonly dayPart: string | null;
  readonly amountMinor: number;
  /** ISO 4217. */
  readonly currency: string;
  /** Whether the figure includes VAT, as the provider states it; null when
   *  the provider does not say. */
  readonly includesVat: boolean | null;
  /** The guest numbers the price is for, when stated. */
  readonly guests: { readonly min: number | null; readonly max: number | null } | null;
}

/** What a caller asks of a feed: comparable offerings near one venue. */
export interface CompetitorPriceQuery {
  /** The Venviewer venue the comparison is for. */
  readonly venueId: string;
  /** YYYY-MM-DD, inclusive. */
  readonly from: string;
  readonly through: string;
  /** Guest numbers the comparison should cover, when known. */
  readonly guests: number | null;
  readonly signal: AbortSignal;
}

/**
 * A licensed source of competitors' published prices. Implemented only once
 * a provider is chosen and licensed. Read-only by contract: it returns
 * observations and never changes anything in Venviewer.
 */
export interface CompetitorPriceSource {
  /** The provider's name, as the venue would recognise it. */
  readonly provider: string;
  /** The licence the venue's use is covered by. */
  readonly licence: string;
  observations(query: CompetitorPriceQuery): Promise<readonly CompetitorPriceObservation[]>;
}

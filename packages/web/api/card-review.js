import { neon } from '@neondatabase/serverless';
import { createReviewHandler } from '../server/card-review-core.mjs';
import { createReviewStore } from '../server/card-review-store.mjs';

let handler;
export default async function cardReview(req, res) {
  if (!handler) {
    const databaseUrl = process.env.CARD_REVIEW_DATABASE_URL;
    if (!databaseUrl) {
      res.statusCode = 503;
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'The review service is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' }));
      return;
    }
    const sql = neon(databaseUrl);
    const origins = ['https://venviewer.com', 'https://www.venviewer.com'];
    if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);
    handler = createReviewHandler({
      store: createReviewStore((text, values) => sql(text, values)),
      ownerToken: process.env.CARD_REVIEW_OWNER_TOKEN,
      rateSecret: process.env.CARD_REVIEW_RATE_SECRET,
      allowedOrigins: origins,
      // Do not log request contents, credentials, connection strings or reviewer names.
      onError: () => console.error('Card review storage operation failed.'),
    });
  }
  await handler(req, res);
}

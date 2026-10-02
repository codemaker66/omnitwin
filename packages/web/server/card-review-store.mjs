const columns = `id, reviewer_name AS "reviewerName", favourite, comments,
  general_comment AS "generalComment", revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

export function createReviewStore(query) {
  return {
    async takeRateLimit(key, limit) {
      const rows = await query(`
        WITH expired AS (DELETE FROM card_review.rate_limits WHERE expires_at < now())
        INSERT INTO card_review.rate_limits (key, window_start, count, expires_at)
        VALUES ($1, date_trunc('hour', now()), 1, date_trunc('hour', now()) + interval '2 hours')
        ON CONFLICT (key, window_start) DO UPDATE SET count = card_review.rate_limits.count + 1
        RETURNING count`, [key]);
      return rows[0].count <= limit;
    },
    async getResponse(sessionHash) {
      return (await query(`SELECT ${columns} FROM card_review.responses WHERE session_hash = $1`, [sessionHash]))[0] ?? null;
    },
    async listResponses() {
      return query(`SELECT ${columns} FROM card_review.responses ORDER BY updated_at DESC, id`, []);
    },
    async saveResponse(sessionHash, body) {
      // Unique insertion and compare-and-swap editing also protect simultaneous
      // requests from two tabs. A random session owns only its own row.
      const values = [sessionHash, body.reviewerName, body.favourite, JSON.stringify(body.comments), body.generalComment];
      if (body.revision === 0) {
        return (await query(`INSERT INTO card_review.responses
          (session_hash, reviewer_name, favourite, comments, general_comment, revision)
          VALUES ($1,$2,$3,$4::jsonb,$5,1) ON CONFLICT (session_hash) DO NOTHING RETURNING ${columns}`,
        values))[0] ?? null;
      }
      return (await query(`UPDATE card_review.responses SET reviewer_name=$2, favourite=$3,
          comments=$4::jsonb, general_comment=$5, revision=revision+1, updated_at=now()
          WHERE session_hash=$1 AND revision=$6 RETURNING ${columns}`,
        [...values, body.revision]))[0] ?? null;
    },
  };
}

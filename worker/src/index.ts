// cv-bot Worker, scaffold only.
//
// Issue 3 (Worker v1) adds /ask, /material-hash, the rate limit, the spend
// cap and the model call. Until then every request fails closed with a
// polite "not available right now" and no model is ever called.

export default {
  async fetch(): Promise<Response> {
    return new Response(
      JSON.stringify({ answer: "Not available right now.", citations: [], refused: true }),
      { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  },
};

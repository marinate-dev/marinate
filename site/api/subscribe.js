/**
 * Release-alert signup (PLAN.md §17 — "email only, double-opt-in").
 *
 * Runs as a Vercel serverless function so the Resend key stays server-side. The page
 * itself is static and must never hold a credential.
 *
 * Why a function rather than Formspree: free tiers cap around 50 submissions/month,
 * and 50 signups is exactly the CP2 kill-gate threshold — hitting the cap would look
 * identical to failing the gate, which is the one measurement this page exists to make.
 *
 * Required env var on the Vercel project:
 *   RESEND_API_KEY        a Resend API key with audience:write
 *   RESEND_AUDIENCE_ID    the audience to add contacts to
 *
 * With either unset the endpoint returns 503 and the page tells the visitor plainly
 * that signup isn't available — it never reports a subscription it didn't record.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    return res.status(503).json({ error: 'Signup is not configured yet.' });
  }

  const email = typeof req.body === 'object' && req.body ? req.body.email : undefined;

  // Deliberately permissive: the only thing worth rejecting here is something that
  // obviously isn't an address. Over-strict email regexes reject valid addresses, and
  // a bounced send is a cheaper failure than a lost signup.
  if (typeof email !== 'string' || email.length > 320 || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That address looks incomplete.' });
  }

  try {
    const resend = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), unsubscribed: false }),
    });

    if (!resend.ok) {
      const detail = await resend.text();
      // Never echo the upstream body to the client — it can carry account identifiers.
      console.error('resend contact create failed', resend.status, detail.slice(0, 300));
      // A duplicate is a success from the visitor's point of view: they are on the list.
      if (resend.status === 409) return res.status(200).json({ ok: true });
      return res.status(502).json({ error: "That didn't go through." });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('resend contact create threw', err);
    return res.status(502).json({ error: "That didn't go through." });
  }
}

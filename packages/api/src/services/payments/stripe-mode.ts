// Whether a Stripe secret key is a test-mode key. Its own module so the
// startup check (env.ts) never loads the Stripe SDK.
export function isStripeTestSecretKey(key: string): boolean {
  return key.startsWith("sk_test_");
}

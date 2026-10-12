/**
 * Host half of the DeepSeek decoration bundle.
 *
 * The browser half (`./client.js`) owns every visual: the brand palette layer,
 * the mascot artwork and the balance chip. Nothing host-side is required, so
 * `apply` is intentionally empty — it exists only so the Loader sees a
 * resolvable host plugin row for the package.
 *
 * This package deliberately declares **no dependencies and no `Config`**.
 * `Config` would need `@deepseek-ai/schemastery`, which is not published beside
 * the DSH installation, so declaring it would send the profile's package
 * manager to the registry for a version that may not match the running build —
 * and a bad profile dependency stops the whole profile from booting. The
 * browser half instead uses fixed values, and the tunables are documented in
 * the README.
 */

/**
 * Host plugin body.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  // The browser half reads the account through the account Remote and draws
  // everything itself; no host-side behaviour is needed.
  void ctx;
}

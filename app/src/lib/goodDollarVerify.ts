import { compressToEncodedURIComponent } from "lz-string";

// ─── GoodDollar face-verification constants ─────────────────────────
// Matches GoodWeb3-Mono ClaimSDK.generateFVLink + sovads frontend port.
export const FV_LOGIN_MSG =
  "Sign this message to login into GoodDollar Unique Identity service.\n" +
  "WARNING: do not sign this message unless you trust the website/application requesting this signature.\n" +
  "nonce:";

export const FV_IDENTIFIER_MSG2 =
  "Sign this message to request verifying your account <account> and to create your own secret unique identifier for your anonymized record.\n" +
  "You can use this identifier in the future to delete this anonymized record.\n" +
  "WARNING: do not sign this message unless you trust the website/application requesting this signature.";

export const GOODID_URL = "https://goodid.gooddollar.org";
export const CELO_CHAIN_ID = 42220;

/** Build the lz-compressed GoodDollar FV deep link. */
export function buildFVLink(params: {
  account: string;
  nonce: string;
  fvsig: string;
  loginSig: string;
  firstName?: string;
  redirectUrl?: string;
}): string {
  const { account, nonce, fvsig, loginSig, firstName = "", redirectUrl } = params;
  const payload: Record<string, string | number> = {
    account,
    nonce,
    fvsig,
    firstname: firstName,
    sg: loginSig,
    chain: CELO_CHAIN_ID,
  };
  if (redirectUrl) payload["rdu"] = redirectUrl;
  const url = new URL(GOODID_URL);
  url.searchParams.append(
    "lz",
    compressToEncodedURIComponent(JSON.stringify(payload)),
  );
  return url.toString();
}

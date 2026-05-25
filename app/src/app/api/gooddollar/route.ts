import { NextResponse } from "next/server";

const COINMARKETCAP_URL = "https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest";
const CMC_SYMBOL = "G%24";
const DEFAULT_USER_AGENT = "Bloom/1.0 (+https://bloom.app)";

function parseCoinMarketCapPrice(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const payload = (data as any).data;
  if (!Array.isArray(payload) || payload.length === 0) return 0;

  const usdQuote = Array.isArray(payload[0]?.quote)
    ? payload[0].quote.find((item: any) => item?.symbol === "USD")
    : undefined;

  return typeof usdQuote?.price === "number" ? usdQuote.price : 0;
}

export async function GET() {
  try {
    const coinMarketCapKey = process.env.COINMARKETCAP_API_KEY;

    if (!coinMarketCapKey) {
      return NextResponse.json({ usd: 0 }, { status: 502 });
    }

    const url = `${COINMARKETCAP_URL}?symbol=${CMC_SYMBOL}&convert=USD`;
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        "X-CMC_PRO_API_KEY": coinMarketCapKey,
      },
    });

    if (!response.ok) {
      console.warn("/api/gooddollar CoinMarketCap fetch failed", response.status, await response.text());
      return NextResponse.json({ usd: 0 }, { status: 502 });
    }

    const data = await response.json();
    const usd = parseCoinMarketCapPrice(data);
    return NextResponse.json({ usd: typeof usd === "number" ? usd : 0 });
  } catch (error) {
    console.error("/api/gooddollar error", error);
    return NextResponse.json({ usd: 0 }, { status: 502 });
  }
}

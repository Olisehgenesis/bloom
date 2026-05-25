"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

export type CurrencyCode = "USD" | "UGX" | "EUR" | "GBP" | "KES" | "NGN" | "ZAR" | "GHS";

const CURRENCY_OPTIONS: CurrencyCode[] = ["USD", "UGX", "EUR", "GBP", "KES", "NGN", "ZAR", "GHS"];

const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  USD: "US Dollar",
  UGX: "Ugandan Shilling",
  EUR: "Euro",
  GBP: "British Pound",
  KES: "Kenyan Shilling",
  NGN: "Nigerian Naira",
  ZAR: "South African Rand",
  GHS: "Ghanaian Cedi",
};

const COUNTRY_TO_CURRENCY: Record<string, CurrencyCode> = {
  UG: "UGX",
  KE: "KES",
  NG: "NGN",
  ZA: "ZAR",
  GH: "GHS",
};

const STORAGE_KEY = "bloom-selected-currency";

export type CurrencyRates = Record<CurrencyCode, number>;

interface CurrencyContextValue {
  selectedCurrency: CurrencyCode;
  setSelectedCurrency: (currency: CurrencyCode) => void;
  rates: CurrencyRates;
  goodDollarUsdPrice: number;
  isLoading: boolean;
  isError: boolean;
  options: { code: CurrencyCode; label: string }[];
  convert: (amount: number, from?: CurrencyCode, to?: CurrencyCode) => number;
  convertFromUsd: (amount: number) => number;
  convertGdToLocal: (amount: number, to?: CurrencyCode) => number;
  formatAmount: (value: number, currency?: CurrencyCode) => string;
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

const defaultRates: CurrencyRates = {
  USD: 1,
  UGX: 0,
  EUR: 0,
  GBP: 0,
  KES: 0,
  NGN: 0,
  ZAR: 0,
  GHS: 0,
};

const EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest/USD";
const FLOAT_RATES_URL = "https://www.floatrates.com/daily/usd.json";

const fetchCurrencyRates = async (): Promise<CurrencyRates> => {
  try {
    const response = await fetch(EXCHANGE_RATE_URL, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error("Failed to load currency rates");
    }
    const data = await response.json();
    if (data?.result !== "success") {
      throw new Error("Exchange rate service returned an error");
    }

    const apiRates = (data?.rates ?? {}) as Partial<Record<CurrencyCode, number>>;
    return { ...defaultRates, ...apiRates, USD: 1 };
  } catch (error) {
    console.warn("useCurrency primary exchange rate source failed, trying fallback", error);
    try {
      const response = await fetch(FLOAT_RATES_URL, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error("Fallback exchange rate source failed");
      }
      const data = await response.json();
      const apiRates: Partial<Record<CurrencyCode, number>> = {};
      if (data?.eur?.rate) apiRates.EUR = data.eur.rate;
      if (data?.gbp?.rate) apiRates.GBP = data.gbp.rate;
      if (data?.ugx?.rate) apiRates.UGX = data.ugx.rate;
      if (data?.kes?.rate) apiRates.KES = data.kes.rate;
      if (data?.ngn?.rate) apiRates.NGN = data.ngn.rate;
      if (data?.zar?.rate) apiRates.ZAR = data.zar.rate;
      if (data?.ghs?.rate) apiRates.GHS = data.ghs.rate;
      return { ...defaultRates, ...apiRates, USD: 1 };
    } catch (fallbackError) {
      console.error("useCurrency fallback exchange rate source failed:", fallbackError);
      return { ...defaultRates };
    }
  }
};

const fetchGoodDollarUsdPrice = async (): Promise<number> => {
  try {
    if (typeof window === "undefined") return 0;
    const url = new URL("/api/gooddollar", window.location.origin).href;
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
      console.error("useCurrency fetchGoodDollarUsdPrice status", response.status, response.statusText);
      throw new Error("Failed to fetch GoodDollar price from API route");
    }
    const data = await response.json();
    const usd = data?.usd;
    return typeof usd === "number" ? usd : 0;
  } catch (error) {
    console.error("useCurrency fetchGoodDollarUsdPrice error:", error);
    return 0;
  }
};

async function getCountryCodeFromIp(): Promise<string | undefined> {
  try {
    const response = await fetch("https://ipapi.co/json/", { cache: "no-cache" });
    if (!response.ok) return undefined;
    const data = await response.json();
    return data.country_code as string | undefined;
  } catch {
    return undefined;
  }
}

function resolvedCurrencyFromLocale(locale?: string, countryCode?: string): CurrencyCode {
  const code = locale?.toUpperCase() ?? "";
  if (code.includes("UG")) return "UGX";
  if (code.includes("KE")) return "KES";
  if (code.includes("NG")) return "NGN";
  if (code.includes("ZA")) return "ZAR";
  if (code.includes("GH")) return "GHS";
  if (countryCode && COUNTRY_TO_CURRENCY[countryCode]) {
    return COUNTRY_TO_CURRENCY[countryCode];
  }
  return "USD";
}

function formatCurrency(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "UGX" || currency === "KES" || currency === "NGN" || currency === "ZAR" || currency === "GHS" ? 0 : 2,
  }).format(value);
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>("USD");

  const {
    data: ratesData,
    isLoading: ratesLoading,
    isError: ratesError,
  } = useQuery({
    queryKey: ["currencyRates"],
    queryFn: fetchCurrencyRates,
    staleTime: 1000 * 60 * 10,
    refetchInterval: 1000 * 60 * 15,
    retry: 1,
  });

  const {
    data: goodDollarUsdPriceData,
    isLoading: goodDollarLoading,
    isError: goodDollarError,
  } = useQuery({
    queryKey: ["goodDollarUsdPrice"],
    queryFn: () => fetchGoodDollarUsdPrice(),
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
    retry: 1,
  });

  const rates = useMemo<CurrencyRates>(() => ({ ...defaultRates, ...ratesData }), [ratesData]);
  const goodDollarUsdPrice = goodDollarUsdPriceData ?? 0;

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Prefer sessionStorage (per-tab "session"), fall back to legacy localStorage.
    const fromSession = window.sessionStorage.getItem(STORAGE_KEY) as CurrencyCode | null;
    const fromLocal = window.localStorage.getItem(STORAGE_KEY) as CurrencyCode | null;
    const stored =
      (fromSession && CURRENCY_OPTIONS.includes(fromSession) && fromSession) ||
      (fromLocal && CURRENCY_OPTIONS.includes(fromLocal) && fromLocal) ||
      null;
    if (stored) {
      setSelectedCurrency(stored);
      // Migrate to session storage so it follows the session.
      window.sessionStorage.setItem(STORAGE_KEY, stored);
      return;
    }

    const locale = window.navigator.language ?? window.navigator.languages?.[0];
    const initial = resolvedCurrencyFromLocale(locale);
    if (initial !== "USD") {
      setSelectedCurrency(initial);
    }

    let cancelled = false;
    getCountryCodeFromIp().then((countryCode) => {
      if (cancelled) return;
      const detected = resolvedCurrencyFromLocale(locale, countryCode);
      if (detected !== selectedCurrency) {
        setSelectedCurrency(detected);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEY, selectedCurrency);
    // Keep localStorage in sync as a fallback for first load in a new tab.
    window.localStorage.setItem(STORAGE_KEY, selectedCurrency);
  }, [selectedCurrency]);

  const convert = (amount: number, from: CurrencyCode = "USD", to: CurrencyCode = selectedCurrency) => {
    if (!amount) return 0;
    if (from === to) return amount;
    const fromRate = from === "USD" ? 1 : rates[from] ?? 1;
    const toRate = to === "USD" ? 1 : rates[to] ?? 1;
    return (amount / fromRate) * toRate;
  };

  const convertFromUsd = (amount: number) => convert(amount, "USD", selectedCurrency);

  const convertGdToLocal = (amount: number, to: CurrencyCode = selectedCurrency) => {
    if (!amount || goodDollarUsdPrice <= 0) return 0;
    const usdValue = amount * goodDollarUsdPrice;
    return convert(usdValue, "USD", to);
  };

  const formatAmount = (value: number, currency: CurrencyCode = selectedCurrency) => formatCurrency(value, currency);

  const isLoading = ratesLoading || goodDollarLoading;
  const isError = ratesError || goodDollarError;

  const value = useMemo(
    () => ({
      selectedCurrency,
      setSelectedCurrency,
      rates,
      goodDollarUsdPrice,
      isLoading,
      isError,
      options: CURRENCY_OPTIONS.map((code) => ({ code, label: CURRENCY_LABELS[code] })),
      convert,
      convertFromUsd,
      convertGdToLocal,
      formatAmount,
    }),
    [selectedCurrency, rates, goodDollarUsdPrice, isLoading, isError],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
}

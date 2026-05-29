"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";

function OnboardingDoodle() {
  return (
    <svg viewBox="0 0 360 240" className="h-full w-full" fill="none" aria-hidden>
      <g stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="58" cy="50" r="14" />
        <path d="M44 83c4-11 9-17 14-17s10 6 14 17" />
        <rect x="38" y="87" width="40" height="24" rx="8" />
        <path d="M50 98h16" />

        <circle cx="138" cy="88" r="14" />
        <path d="M124 121c4-11 9-17 14-17s10 6 14 17" />
        <rect x="118" y="126" width="40" height="24" rx="8" />
        <path d="M130 137h16" />

        <circle cx="236" cy="64" r="14" />
        <path d="M222 97c4-11 9-17 14-17s10 6 14 17" />
        <rect x="216" y="102" width="40" height="24" rx="8" />
        <path d="M228 113h16" />

        <circle cx="306" cy="104" r="14" />
        <path d="M292 137c4-11 9-17 14-17s10 6 14 17" />
        <rect x="286" y="142" width="40" height="24" rx="8" />
        <path d="M298 153h16" />

        <path d="M82 98c20-10 30-7 48 6" />
        <path d="M158 138c24-12 40-18 58-16" />
        <path d="M254 113c18-3 28 2 38 13" />
      </g>
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-[color:var(--color-white)]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[460px] flex-col lg:max-w-none lg:flex-row">
        <section className="relative flex-[0_0_55%] bg-[color:var(--color-cream)] px-[var(--screen-padding)] pt-6 lg:flex lg:w-1/2 lg:flex-col lg:items-center lg:justify-center lg:px-12 lg:py-16">
          <div className="mx-auto flex w-full max-w-[280px] items-center justify-center gap-2.5 lg:max-w-none">
            <Image
              src="/icon-192.png"
              alt="Bloom"
              width={28}
              height={28}
              priority
              className="h-7 w-7 rounded-full"
            />
            <span className="font-display text-[20px] font-bold text-[color:var(--color-black)]">Bloom</span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="mx-auto mt-6 h-[68%] w-full max-w-[340px] lg:mt-10 lg:h-auto lg:max-w-[380px]"
          >
            <OnboardingDoodle />
          </motion.div>

          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5 lg:static lg:mt-8">
            <span className="h-2 w-2 bg-[color:var(--color-black)]" />
            <span className="h-2 w-2 rounded-full border border-[color:var(--color-gray-400)]" />
            <span className="h-2 w-2 rounded-full border border-[color:var(--color-gray-400)]" />
          </div>
        </section>

        <section className="flex flex-[0_0_45%] flex-col rounded-t-[var(--radius-xl)] bg-[color:var(--color-white)] px-[var(--screen-padding)] pb-10 pt-8 lg:w-1/2 lg:items-center lg:justify-center lg:rounded-none lg:px-12 lg:py-16">
          <div className="w-full lg:max-w-[400px]">
            <h1 className="text-center font-display text-[28px] font-bold text-[color:var(--color-black)] lg:text-[32px]">
              You can bloom.
            </h1>
            <p className="mx-auto mt-3 max-w-[280px] text-center text-[14px] text-[color:var(--color-gray-400)] lg:max-w-[360px] lg:text-[16px]">
              Real-time GoodDollar streams on Celo with custody-free wallet control.
            </p>

            <div className="mt-8 grid gap-3 lg:mt-10">
              <Link
                href="/login"
                className="btn-primary inline-flex h-14 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[color:var(--color-black)] px-6 font-display text-[16px] font-semibold text-[color:var(--color-white)] lg:mx-auto lg:max-w-[400px]"
              >
                Login
              </Link>
              <Link
                href="/login"
                className="btn-outline inline-flex h-14 w-full items-center justify-center rounded-[var(--radius-lg)] border-[1.5px] border-[color:var(--color-black)] bg-transparent px-6 font-display text-[16px] font-semibold text-[color:var(--color-black)] lg:mx-auto lg:max-w-[400px]"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

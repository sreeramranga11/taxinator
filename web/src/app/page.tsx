"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles, Workflow, FileCheck2, Quote, Send } from "lucide-react";

export default function HomePage() {
  const features = [
    { title: "Normalize & validate", desc: "Turn messy cost-basis feeds into clean, vendor-ready payloads.", icon: ShieldCheck },
    { title: "Tammy AI", desc: "Paste or upload anything—Tammy drafts the translation instantly.", icon: Sparkles },
    { title: "Manual control", desc: "Create jobs, ingest data, transform, reconcile, and export yourself.", icon: Workflow },
  ];

  const testimonials = [
    { quote: "Tammy let us ship vendor payloads in minutes instead of hours.", author: "Priya S., Ops Lead" },
    { quote: "The manual pipeline keeps our audits tight—no surprises at export.", author: "Jon K., Tax Ops" },
    { quote: "Green-lighted our vendor handoffs without brittle spreadsheets.", author: "Alex R., Finance" },
  ];

  const painPoints = [
    "Fragmented provider formats and schema drift",
    "Last-minute validation failures before export",
    "Reconciliation gaps between cost basis and PII",
    "Slow turnaround for vendor-specific payloads",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 text-slate-900">
      <header className="sticky top-0 z-20 backdrop-blur bg-white/80 border-b border-emerald-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-500 text-white grid place-items-center font-bold">T</div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Taxinator</p>
              <p className="text-sm text-slate-600">Middleware for tax reporting</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/manual" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">
              Manual
            </Link>
            <Link
              href="/tammy"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-emerald-700"
            >
              Use Tammy
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl bg-white p-8 shadow-lg border border-emerald-100">
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-700">Purpose</p>
            <h1 className="mt-2 text-4xl font-bold leading-tight text-slate-900">
              Translate cost-basis chaos into vendor-ready confidence.
            </h1>
            <p className="mt-4 text-lg text-slate-700">
              Taxinator normalizes upstream data, validates against downstream requirements, and lets you deliver clean
              payloads—either with Tammy (AI) or via manual control.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/tammy"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-emerald-700"
              >
                Use Tammy
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/manual"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 px-5 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                Manual flow
              </Link>
            </div>
          </div>
          <div className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-100/70 to-teal-100/70 p-6 shadow-md">
            <p className="text-sm font-semibold text-emerald-800">Pain points solved</p>
            <ul className="mt-3 space-y-2 text-slate-800">
              {painPoints.map((p) => (
                <li key={p} className="flex items-start gap-2">
                  <FileCheck2 className="mt-1 h-4 w-4 text-emerald-700" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid gap-2 rounded-2xl bg-white/80 p-4 shadow-sm">
              <p className="text-sm font-semibold text-emerald-800">Rationale</p>
              <p className="text-sm text-slate-700">
                One hub for ingestion, validation, reconciliation, and vendor-specific exports—so ops, finance, and tax
                teams stay aligned and on-time.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">{f.title}</h3>
              <p className="text-sm text-slate-700">{f.desc}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-emerald-100 bg-white p-8 shadow-md">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-emerald-700">Testimonials</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Teams shipping faster with Tammy</h2>
              <p className="text-sm text-slate-700">
                Real voices (okay, fake ones) from operators who ditched spreadsheets and manual transforms.
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/tammy"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
              >
                Use Tammy <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/manual"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                Manual flow
              </Link>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {testimonials.map((t) => (
              <div key={t.author} className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm">
                <Quote className="h-5 w-5 text-emerald-600" />
                <p className="mt-3 text-sm text-slate-800">{t.quote}</p>
                <p className="mt-2 text-xs font-semibold text-emerald-700">{t.author}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 rounded-3xl border border-emerald-100 bg-white p-6 shadow-md md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-[0.2em] text-emerald-700">Get started</p>
            <h3 className="text-2xl font-bold text-slate-900">Pick your path</h3>
            <p className="text-sm text-slate-700">
              Tammy when you want AI speed. Manual when you want complete control. Switch anytime.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 md:justify-end">
            <Link
              href="/tammy"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-emerald-700"
            >
              Use Tammy
              <Send className="h-4 w-4" />
            </Link>
            <Link
              href="/manual"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-200 px-5 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              Manual flow
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

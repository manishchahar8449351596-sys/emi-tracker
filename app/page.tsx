"use client";

import React, { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

const DEFAULT_SHOP_SLUG = "jai-mata-di-point-akola";
const ACTIVE_SHOP_LOCK_KEY = "emi_tracker_locked_shop_slug_v1";
const ADMIN_PHONE = "8449351596";
const MONTHLY_PRICE = 299;
const TRIAL_DAYS = 7;

interface EmiRecord {
  id: string;
  shopSlug: string;
  customerName: string;
  fatherName: string;
  mobile: string;
  address: string;
  totalAmount: number;
  monthlyEmi: number;
  totalMonths: number;
  paidMonths: number;
  dueDay: number;
  createdAt: string;
  lastAutoVoiceMonth?: string;
}

interface ShopSubscription {
  shopSlug: string;
  shopName: string;
  planName: string;
  planPrice: number;
  expiresAt: string;
  isActive: boolean;
}

function sanitizeShopSlug(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatShopTitle(slug: string): string {
  if (slug === DEFAULT_SHOP_SLUG) {
    return "Jai Mata Di Point Akola";
  }
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function resolveShopSlug(): string {
  if (typeof window === "undefined") return DEFAULT_SHOP_SLUG;

  const params = new URLSearchParams(window.location.search);
  const fromQuery = sanitizeShopSlug(params.get("shop"));
  if (fromQuery) {
    try {
      localStorage.setItem(ACTIVE_SHOP_LOCK_KEY, fromQuery);
    } catch {
      // ignore storage error
    }
    return fromQuery;
  }

  try {
    const locked = sanitizeShopSlug(localStorage.getItem(ACTIVE_SHOP_LOCK_KEY));
    if (locked) return locked;
  } catch {
    // ignore storage error
  }

  return DEFAULT_SHOP_SLUG;
}

function getStorageKey(shopSlug: string): string {
  return `emi_tracker_records_v1_${shopSlug}`;
}

function mapRowToRecord(row: Record<string, unknown>, fallbackShop: string): EmiRecord {
  return {
    id: String(row.id ?? ""),
    shopSlug: sanitizeShopSlug(String(row.shop_slug ?? "")) || fallbackShop,
    customerName: String(row.customer_name ?? ""),
    fatherName: String(row.father_name ?? ""),
    mobile: String(row.mobile ?? ""),
    address: String(row.address ?? ""),
    totalAmount: Number(row.total_amount ?? 0),
    monthlyEmi: Number(row.monthly_emi ?? 0),
    totalMonths: Number(row.total_months ?? 12),
    paidMonths: Number(row.paid_months ?? 0),
    dueDay: Number(row.due_day ?? 15),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    lastAutoVoiceMonth: row.last_auto_voice_month
      ? String(row.last_auto_voice_month)
      : undefined,
  };
}

function mapRecordToRow(item: EmiRecord) {
  return {
    id: item.id,
    shop_slug: item.shopSlug,
    customer_name: item.customerName,
    father_name: item.fatherName,
    mobile: item.mobile,
    address: item.address,
    total_amount: item.totalAmount,
    monthly_emi: item.monthlyEmi,
    total_months: item.totalMonths,
    paid_months: item.paidMonths,
    due_day: item.dueDay,
    last_auto_voice_month: item.lastAutoVoiceMonth ?? null,
    created_at: item.createdAt,
  };
}

function mapShopRow(row: Record<string, unknown>, fallbackSlug: string): ShopSubscription {
  return {
    shopSlug: sanitizeShopSlug(String(row.shop_slug ?? "")) || fallbackSlug,
    shopName: String(row.shop_name ?? formatShopTitle(fallbackSlug)),
    planName: String(row.plan_name ?? "Trial 7 Days"),
    planPrice: Number(row.plan_price ?? MONTHLY_PRICE),
    expiresAt: String(row.expires_at ?? new Date().toISOString()),
    isActive: row.is_active !== false,
  };
}

function getReminderDay(dueDay: number): number {
  const safeDay = Math.min(28, Math.max(1, Number(dueDay) || 15));
  return safeDay > 2 ? safeDay - 2 : 28;
}

function buildVoiceLine(item: EmiRecord, brandName: string): string {
  const paidAmt = Math.min(item.totalAmount, item.paidMonths * item.monthlyEmi);
  const bacha = Math.max(0, item.totalAmount - paidAmt);
  return (
    `Namaste ${item.customerName} ji, ${brandName} se reminder hai. ` +
    `Aapki mahine ki kist ${item.monthlyEmi} rupaye har ${item.dueDay} tarikh ko due hai ` +
    `aur bacha hua udhaar ${bacha} rupaye hai.`
  );
}

function speakHindi(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "hi-IN";
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch {
    // ignore speech error
  }
}

export default function Page() {
  const [shopSlug, setShopSlug] = useState<string>(DEFAULT_SHOP_SLUG);
  const [subscription, setSubscription] = useState<ShopSubscription | null>(null);
  const [subLoading, setSubLoading] = useState<boolean>(true);
  const [records, setRecords] = useState<EmiRecord[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>(
    "Ready — Supabase sync & Free Hindi AI Voice active hai."
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkingAuto, setCheckingAuto] = useState<boolean>(false);
  const recordsRef = useRef<EmiRecord[]>([]);
  const shopSlugRef = useRef<string>(DEFAULT_SHOP_SLUG);

  const [customerName, setCustomerName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [monthlyEmi, setMonthlyEmi] = useState("");
  const [totalMonths, setTotalMonths] = useState("12");
  const [paidMonths, setPaidMonths] = useState("0");
  const [dueDay, setDueDay] = useState("15");

  const brandName = subscription?.shopName || formatShopTitle(shopSlug);

  const nowMs = Date.now();
  const expiryMs = subscription ? new Date(subscription.expiresAt).getTime() : nowMs + 86400000;
  const daysLeft = Math.max(0, Math.ceil((expiryMs - nowMs) / (1000 * 60 * 60 * 24)));
  const isSubscriptionBlocked =
    !subLoading &&
    subscription !== null &&
    (!subscription.isActive || expiryMs <= nowMs);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    shopSlugRef.current = shopSlug;
  }, [shopSlug]);

  function saveRecords(next: EmiRecord[], targetShop = shopSlugRef.current) {
    recordsRef.current = next;
    setRecords(next);
    try {
      localStorage.setItem(getStorageKey(targetShop), JSON.stringify(next));
    } catch {
      // ignore storage write error
    }
  }

  async function ensureShopSubscription(resolvedShop: string): Promise<ShopSubscription | null> {
    const { data: existing, error: fetchErr } = await supabase
      .from("shops")
      .select("*")
      .eq("shop_slug", resolvedShop)
      .maybeSingle();

    if (!fetchErr && existing) {
      return mapShopRow(existing as Record<string, unknown>, resolvedShop);
    }

    const trialExpiry = new Date(
      Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const newShopPayload = {
      shop_slug: resolvedShop,
      shop_name: formatShopTitle(resolvedShop),
      plan_name: `Trial ${TRIAL_DAYS} Days`,
      plan_price: MONTHLY_PRICE,
      expires_at: trialExpiry,
      is_active: true,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("shops")
      .insert(newShopPayload)
      .select("*")
      .single();

    if (!insertErr && inserted) {
      return mapShopRow(inserted as Record<string, unknown>, resolvedShop);
    }

    return null;
  }

  async function runBackgroundAutoCheck(
    currentList: EmiRecord[],
    announceEmpty = false,
    activeShop = shopSlugRef.current
  ) {
    const now = new Date();
    const todayDate = now.getDate();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const activeBrand = formatShopTitle(activeShop);

    const dueSoon = currentList.filter((r) => {
      const paidAmt = Math.min(r.totalAmount, r.paidMonths * r.monthlyEmi);
      const hasDue = r.totalAmount - paidAmt > 0 || r.paidMonths < r.totalMonths;
      return hasDue && getReminderDay(r.dueDay) === todayDate && r.lastAutoVoiceMonth !== monthKey;
    });

    if (dueSoon.length > 0) {
      const updated = currentList.map((r) =>
        dueSoon.some((d) => d.id === r.id) ? { ...r, lastAutoVoiceMonth: monthKey } : r
      );
      saveRecords(updated, activeShop);

      for (const d of dueSoon) {
        await supabase
          .from("customers")
          .update({ last_auto_voice_month: monthKey })
          .eq("id", d.id)
          .eq("shop_slug", activeShop);
      }

      const combinedScript = dueSoon
        .map((d) => buildVoiceLine(d, activeBrand))
        .join(" ");
      speakHindi(combinedScript);

      const names = dueSoon.map((d) => d.customerName).join(", ");
      setStatusMsg(
        `[${activeBrand}] Auto 2-Day Reminder chala (${todayDate} tarikh): ${names} ke liye Hindi voice alert trigger ho gaya.`
      );
    } else if (announceEmpty) {
      setStatusMsg(
        `[${activeBrand}] Auto check complete (${todayDate} tarikh): Aaj kisi customer ka 2-day reminder pending nahi hai.`
      );
    }

    try {
      await fetch("/api/voice-reminder/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SYNC_RECORDS",
          shopSlug: activeShop,
          shopName: activeBrand,
          records: currentList.map((r) => ({
            id: r.id,
            shopSlug: activeShop,
            customerName: r.customerName,
            fatherName: r.fatherName,
            mobile: r.mobile,
            address: r.address,
            loanName: "Udhaar / EMI",
            monthlyEmi: r.monthlyEmi,
            totalMonths: r.totalMonths,
            paidMonths: r.paidMonths,
            dueDay: r.dueDay,
            udharAmount: Math.max(
              0,
              r.totalAmount - Math.min(r.totalAmount, r.paidMonths * r.monthlyEmi)
            ),
            lastAutoSentMonth: r.lastAutoVoiceMonth,
          })),
        }),
      });
    } catch {
      // ignore background sync error
    }
  }

  useEffect(() => {
    const resolvedShop = resolveShopSlug();
    shopSlugRef.current = resolvedShop;
    setShopSlug(resolvedShop);
    setRecords([]);
    recordsRef.current = [];
    setSubLoading(true);

    let localList: EmiRecord[] = [];
    try {
      const raw = localStorage.getItem(getStorageKey(resolvedShop));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const filteredLocal = parsed.filter(
            (item: EmiRecord) => (item.shopSlug || DEFAULT_SHOP_SLUG) === resolvedShop
          );
          localList = filteredLocal;
          setRecords(filteredLocal);
          recordsRef.current = filteredLocal;
        }
      }
    } catch {
      // ignore storage read error
    }

    void (async () => {
      const sub = await ensureShopSubscription(resolvedShop);
      setSubscription(sub);
      setSubLoading(false);

      const blocked =
        sub !== null &&
        (!sub.isActive || new Date(sub.expiresAt).getTime() <= Date.now());
      if (blocked) {
        return;
      }

      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("shop_slug", resolvedShop)
        .order("created_at", { ascending: false });

      if (!error && data) {
        const dbRecords = data.map((row: Record<string, unknown>) =>
          mapRowToRecord(row, resolvedShop)
        );
        saveRecords(dbRecords, resolvedShop);
        await runBackgroundAutoCheck(dbRecords, false, resolvedShop);
      } else {
        await runBackgroundAutoCheck(localList, false, resolvedShop);
      }
    })();

    const timer = window.setInterval(() => {
      void runBackgroundAutoCheck(recordsRef.current, false, shopSlugRef.current);
    }, 30 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  async function handleAddRecord(e: React.FormEvent) {
    e.preventDefault();
    if (isSubscriptionBlocked) return;

    const activeShop = shopSlugRef.current;
    const activeBrand = formatShopTitle(activeShop);
    const cleanName = customerName.trim();
    const cleanMobile = mobile.trim();
    const amt = Number(totalAmount) || 0;
    const emi = Number(monthlyEmi) || 0;
    const months = Math.max(1, Number(totalMonths) || 1);
    const paid = Math.min(months, Math.max(0, Number(paidMonths) || 0));
    const day = Math.min(28, Math.max(1, Number(dueDay) || 15));

    if (!cleanName || !cleanMobile) {
      setStatusMsg("Customer Name aur Mobile Number daalna zaroori hai.");
      return;
    }

    const computedTotal = amt > 0 ? amt : emi * months;
    const computedEmi = emi > 0 ? emi : Math.round(computedTotal / months);

    const newItem: EmiRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      shopSlug: activeShop,
      customerName: cleanName,
      fatherName: fatherName.trim(),
      mobile: cleanMobile,
      address: address.trim(),
      totalAmount: computedTotal,
      monthlyEmi: computedEmi,
      totalMonths: months,
      paidMonths: paid,
      dueDay: day,
      createdAt: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("customers")
      .insert(mapRecordToRow(newItem));

    if (error) {
      setStatusMsg(`Supabase save error: ${error.message}`);
      return;
    }

    const updated = [newItem, ...recordsRef.current];
    saveRecords(updated, activeShop);

    setCustomerName("");
    setFatherName("");
    setMobile("");
    setAddress("");
    setTotalAmount("");
    setMonthlyEmi("");
    setTotalMonths("12");
    setPaidMonths("0");
    setDueDay("15");

    setStatusMsg(
      `${cleanName} ka record [${activeBrand}] ke liye Supabase mein save ho gaya | Due Date: Har ${day} tarikh | Auto Reminder: ${getReminderDay(
        day
      )} tarikh.`
    );
    await runBackgroundAutoCheck(updated, false, activeShop);
  }

  async function handleMarkPaid(id: string) {
    if (isSubscriptionBlocked) return;
    const activeShop = shopSlugRef.current;
    const target = recordsRef.current.find((item) => item.id === id);
    if (!target) return;

    const nextPaid = Math.min(target.totalMonths, target.paidMonths + 1);
    const { error } = await supabase
      .from("customers")
      .update({ paid_months: nextPaid })
      .eq("id", id)
      .eq("shop_slug", activeShop);

    if (error) {
      setStatusMsg(`Supabase update error: ${error.message}`);
      return;
    }

    const updated = recordsRef.current.map((item) =>
      item.id === id ? { ...item, paidMonths: nextPaid } : item
    );
    saveRecords(updated, activeShop);
    setStatusMsg("1 EMI Paid Supabase mein update kar di gayi hai.");
  }

  async function handleDelete(id: string) {
    if (isSubscriptionBlocked) return;
    const activeShop = shopSlugRef.current;
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", id)
      .eq("shop_slug", activeShop);

    if (error) {
      setStatusMsg(`Supabase delete error: ${error.message}`);
      return;
    }

    const updated = recordsRef.current.filter((item) => item.id !== id);
    saveRecords(updated, activeShop);
    setStatusMsg("Record Supabase se delete kar diya gaya hai.");
  }

  async function handleSendReminder(item: EmiRecord) {
    if (isSubscriptionBlocked) return;
    setBusyId(item.id);
    const script = buildVoiceLine(item, brandName);
    speakHindi(script);

    try {
      const res = await fetch("/api/voice-reminder/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "TRIGGER_NOW",
          shopSlug: shopSlug,
          shopName: brandName,
          record: {
            id: item.id,
            shopSlug: shopSlug,
            customerName: item.customerName,
            fatherName: item.fatherName,
            mobile: item.mobile,
            address: item.address,
            loanName: "Udhaar / EMI",
            monthlyEmi: item.monthlyEmi,
            totalMonths: item.totalMonths,
            paidMonths: item.paidMonths,
            dueDay: item.dueDay,
            udharAmount: Math.max(
              0,
              item.totalAmount - Math.min(item.totalAmount, item.paidMonths * item.monthlyEmi)
            ),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      setStatusMsg(
        `${item.customerName}: Hindi Voice chala diya gaya | ${data?.whatsappStatus || "Free mode ready"}`
      );
      if (data?.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      setStatusMsg(`${item.customerName}: Free Hindi Voice chala diya gaya hai.`);
    }

    setBusyId(null);
  }

  async function handleAutoCheck() {
    if (isSubscriptionBlocked) return;
    setCheckingAuto(true);
    await runBackgroundAutoCheck(recordsRef.current, true, shopSlugRef.current);
    setCheckingAuto(false);
  }

  if (isSubscriptionBlocked && subscription) {
    const whatsappRenewText = encodeURIComponent(
      `Namaste! Mujhe apni dukaan "${brandName}" (${shopSlug}) ka EMI Tracker subscription ₹${MONTHLY_PRICE}/month renew karwana hai.`
    );
    const whatsappRenewUrl = `https://wa.me/91${ADMIN_PHONE}?text=${whatsappRenewText}`;

    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-slate-900 border border-rose-700/70 rounded-2xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="inline-block px-3 py-1 rounded-full bg-rose-950 border border-rose-700 text-rose-300 text-xs font-semibold">
            Subscription Expired / Plan Inactive
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            {brandName}
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Aapka <span className="font-semibold text-white">{subscription.planName}</span> samapt ho gaya hai.
            Apne sabhi customers ka data aur auto reminder dobara chalu karne ke liye{" "}
            <span className="text-emerald-400 font-bold">₹{MONTHLY_PRICE} / Month</span> ka plan renew karein.
          </p>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-left text-xs text-slate-300 space-y-1.5">
            <div>
              <span className="text-slate-400">Shop ID:</span>{" "}
              <span className="font-mono text-sky-300">{shopSlug}</span>
            </div>
            <div>
              <span className="text-slate-400">Monthly Plan:</span>{" "}
              <span className="text-emerald-400 font-semibold">₹{MONTHLY_PRICE} / 30 Days</span>
            </div>
            <div>
              <span className="text-slate-400">Support / Activation Number:</span>{" "}
              <span className="text-white font-semibold">+91 {ADMIN_PHONE}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <a
              href={whatsappRenewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm text-center"
            >
              WhatsApp Par Renew Karein (₹{MONTHLY_PRICE})
            </a>
            <a
              href={`tel:+91${ADMIN_PHONE}`}
              className="flex-1 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm text-center"
            >
              Call Karein: {ADMIN_PHONE}
            </a>
          </div>
        </div>
      </main>
    );
  }

  const totalUdhaarAll = records.reduce((acc, r) => acc + r.totalAmount, 0);
  const totalPaidAll = records.reduce(
    (acc, r) => acc + Math.min(r.totalAmount, r.paidMonths * r.monthlyEmi),
    0
  );
  const totalBachaAll = Math.max(0, totalUdhaarAll - totalPaidAll);

  const renewMessage = encodeURIComponent(
    `Namaste! Mujhe apni dukaan "${brandName}" (${shopSlug}) ke liye ₹${MONTHLY_PRICE}/month subscription lena hai.`
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">
                {brandName}
              </h1>
              {!subLoading && subscription && (
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    daysLeft <= 2
                      ? "bg-amber-950/80 border-amber-600 text-amber-300"
                      : "bg-emerald-950/80 border-emerald-700 text-emerald-300"
                  }`}
                >
                  {subscription.planName} • {daysLeft} din baaki
                </span>
              )}
            </div>
            <p className="text-sm text-slate-300 mt-1">
              Udhaar + EMI Hisaab, Due Date &amp; 2 Din Pehle Auto Reminder Dashboard
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/91${ADMIN_PHONE}?text=${renewMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm"
            >
              Renew ₹{MONTHLY_PRICE}/Mo
            </a>
            <button
              type="button"
              onClick={() =>
                speakHindi(`Namaste, ${brandName} ki free Hindi AI voice active hai.`)
              }
              className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm cursor-pointer"
            >
              Test Hindi Voice
            </button>
            <button
              type="button"
              onClick={handleAutoCheck}
              disabled={checkingAuto}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm cursor-pointer"
            >
              {checkingAuto ? "Checking..." : "Run 2-Day Auto Check Now"}
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">
              Kul Udhaar / Loan
            </div>
            <div className="text-2xl font-bold text-white mt-1">
              ₹{totalUdhaarAll.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">
              Kul Jama / Paid
            </div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">
              ₹{totalPaidAll.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">
              Bacha Hua Udhaar
            </div>
            <div className="text-2xl font-bold text-amber-400 mt-1">
              ₹{totalBachaAll.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">
              Total Customers
            </div>
            <div className="text-2xl font-bold text-sky-400 mt-1">
              {records.length}
            </div>
          </div>
        </section>

        <div className="bg-emerald-950/60 border border-emerald-700/60 text-emerald-200 rounded-xl px-4 py-3 text-sm">
          {statusMsg}
        </div>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-lg font-bold text-white mb-4">
            Naya Customer / Udhaar / EMI Entry
          </h2>

          <form
            onSubmit={handleAddRecord}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                1. Customer Name *
              </label>
              <input
                type="text"
                placeholder="Jaise: Ramesh Kumar"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                2. Father Name
              </label>
              <input
                type="text"
                placeholder="Pita ka naam"
                value={fatherName}
                onChange={(e) => setFatherName(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                3. Mobile Number (WhatsApp / Call) *
              </label>
              <input
                type="tel"
                placeholder="10 digit mobile number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                4. Kul Udhaar / Loan Paise (₹)
              </label>
              <input
                type="number"
                min="0"
                placeholder="Kul paise (₹) jaise: 50000"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                5. Har Mahine Ki Kist / EMI (₹)
              </label>
              <input
                type="number"
                min="0"
                placeholder="Monthly kist (₹) jaise: 5000"
                value={monthlyEmi}
                onChange={(e) => setMonthlyEmi(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                6. Kul Mahine (Total Months)
              </label>
              <input
                type="number"
                min="1"
                max="240"
                placeholder="Kul mahine jaise: 12"
                value={totalMonths}
                onChange={(e) => setTotalMonths(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                7. Kitne Mahine Paid Ho Chuke (Paid Months)
              </label>
              <input
                type="number"
                min="0"
                max="240"
                placeholder="Paid mahine jaise: 2"
                value={paidMonths}
                onChange={(e) => setPaidMonths(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                8. Har Mahine Ki Due Date (1 se 28 Tarikh)
              </label>
              <input
                type="number"
                min="1"
                max="28"
                placeholder="Due tarikh jaise: 15"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                9. Address / Gaon / Ward
              </label>
              <input
                type="text"
                placeholder="Pata / Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3 pt-1">
              <button
                type="submit"
                className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm cursor-pointer"
              >
                Save Record (Auto Schedule)
              </button>
            </div>
          </form>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-lg font-bold text-white mb-4">
            Saved Records ({records.length})
          </h2>

          {records.length === 0 ? (
            <p className="text-sm text-slate-400">
              Abhi koi record save nahi hai. Upar form bhar kar Save Record par click karein.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-300 bg-slate-950/70">
                    <th className="py-3 px-3">Customer</th>
                    <th className="py-3 px-3">Mobile</th>
                    <th className="py-3 px-3">Kul Udhaar</th>
                    <th className="py-3 px-3">Monthly EMI</th>
                    <th className="py-3 px-3">Paid Mahine</th>
                    <th className="py-3 px-3">Bacha Udhaar</th>
                    <th className="py-3 px-3">Due Date</th>
                    <th className="py-3 px-3">Auto Reminder</th>
                    <th className="py-3 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((item) => {
                    const paidAmt = Math.min(
                      item.totalAmount,
                      item.paidMonths * item.monthlyEmi
                    );
                    const remainingAmt = Math.max(0, item.totalAmount - paidAmt);
                    const remDay = getReminderDay(item.dueDay);

                    return (
                      <tr
                        key={item.id}
                        className="border-b border-slate-800/80 hover:bg-slate-800/40"
                      >
                        <td className="py-3 px-3 font-semibold text-white">
                          <div>{item.customerName}</div>
                          {item.fatherName && (
                            <div className="text-xs text-slate-400 font-normal">
                              S/o {item.fatherName}
                            </div>
                          )}
                          {item.address && (
                            <div className="text-xs text-slate-400 font-normal">
                              {item.address}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-200">{item.mobile}</td>
                        <td className="py-3 px-3 text-slate-200">
                          ₹{item.totalAmount.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-sky-300 font-medium">
                          ₹{item.monthlyEmi.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-emerald-300 font-semibold">
                          {item.paidMonths} / {item.totalMonths}
                        </td>
                        <td className="py-3 px-3 text-amber-300 font-bold">
                          ₹{remainingAmt.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-white font-medium">
                          Har {item.dueDay} tarikh
                        </td>
                        <td className="py-3 px-3 text-purple-300">
                          {remDay} tarikh (2 din pehle)
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => handleSendReminder(item)}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                            >
                              {busyId === item.id
                                ? "Sending..."
                                : "Send WhatsApp + AI Call"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarkPaid(item.id)}
                              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                            >
                              Mark Paid (+1M)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id)}
                              className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
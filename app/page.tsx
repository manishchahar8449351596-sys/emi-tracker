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
  customPaidAmount?: number;
  todayCollectedAmount?: number;
  todayCollectedDateKey?: string;
  isTrashed?: boolean;
}

interface ShopSubscription {
  shopSlug: string;
  shopName: string;
  planName: string;
  planPrice: number;
  expiresAt: string;
  isActive: boolean;
}

type DueAlertStatus = "DUE_TODAY" | "OVERDUE" | "UPCOMING" | "CLEARED";
type FolderTab = "ALL" | "DUE_ONLY" | "TRASH";

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

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function computePaidAmount(item: EmiRecord): number {
  const fromMonths =
    Math.max(0, Number(item.paidMonths) || 0) * (Number(item.monthlyEmi) || 0);
  const extraCustom = Math.max(0, Number(item.customPaidAmount) || 0);
  return Math.min(Number(item.totalAmount) || 0, fromMonths + extraCustom);
}

function mapRowToRecord(
  row: Record<string, unknown>,
  fallbackShop: string,
  dateKey: string
): EmiRecord {
  const rawAddress = String(row.address ?? "");
  let customPaid = 0;
  let trashed = false;
  let workingAddress = rawAddress;

  const trashMarker = "||TRASHED:1";
  const trashIdx = workingAddress.indexOf(trashMarker);
  if (trashIdx !== -1) {
    trashed = true;
    workingAddress = (
      workingAddress.slice(0, trashIdx) +
      " " +
      workingAddress.slice(trashIdx + trashMarker.length)
    ).trim();
  }

  const customMarker = "||CUSTOM_PAID:";
  const idx = workingAddress.indexOf(customMarker);
  if (idx !== -1) {
    const beforeCustom = workingAddress.slice(0, idx).trim();
    const afterCustom = workingAddress.slice(idx + customMarker.length).trim();
    const numericPart = afterCustom.split(/\s+/)[0] || "";
    const parsedExtra = Number(numericPart);
    if (Number.isFinite(parsedExtra) && parsedExtra > 0) {
      customPaid = parsedExtra;
    }
    workingAddress = beforeCustom;
  }

  return {
    id: String(row.id ?? ""),
    shopSlug: sanitizeShopSlug(String(row.shop_slug ?? "")) || fallbackShop,
    customerName: String(row.customer_name ?? ""),
    fatherName: String(row.father_name ?? ""),
    mobile: String(row.mobile ?? ""),
    address: workingAddress.trim(),
    totalAmount: Number(row.total_amount ?? 0),
    monthlyEmi: Number(row.monthly_emi ?? 0),
    totalMonths: Number(row.total_months ?? 12),
    paidMonths: Number(row.paid_months ?? 0),
    dueDay: Number(row.due_day ?? 15),
    createdAt: String(row.created_at ?? ""),
    lastAutoVoiceMonth: row.last_auto_voice_month
      ? String(row.last_auto_voice_month)
      : undefined,
    customPaidAmount: customPaid,
    todayCollectedAmount: 0,
    todayCollectedDateKey: dateKey,
    isTrashed: trashed,
  };
}

function mapRecordToRow(item: EmiRecord) {
  const extra = Math.max(0, Number(item.customPaidAmount) || 0);
  const parts: string[] = [item.address.trim()];
  if (extra > 0) {
    parts.push(`||CUSTOM_PAID:${extra}`);
  }
  if (item.isTrashed) {
    parts.push("||TRASHED:1");
  }
  const packedAddress = parts.filter(Boolean).join(" ").trim();

  return {
    id: item.id,
    shop_slug: item.shopSlug,
    customer_name: item.customerName,
    father_name: item.fatherName,
    mobile: item.mobile,
    address: packedAddress,
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
    expiresAt: String(row.expires_at ?? ""),
    isActive: row.is_active !== false,
  };
}

function getReminderDay(dueDay: number): number {
  const safeDay = Math.min(28, Math.max(1, Number(dueDay) || 15));
  return safeDay > 2 ? safeDay - 2 : 28;
}

function getDueAlertStatus(item: EmiRecord, todayDay: number): DueAlertStatus {
  const paidAmt = computePaidAmount(item);
  const remainingAmt = Math.max(0, item.totalAmount - paidAmt);
  const hasDue = remainingAmt > 0 || item.paidMonths < item.totalMonths;

  if (!hasDue) return "CLEARED";

  const safeDueDay = Math.min(28, Math.max(1, Number(item.dueDay) || 15));
  if (todayDay === safeDueDay) return "DUE_TODAY";
  if (todayDay > safeDueDay) return "OVERDUE";
  return "UPCOMING";
}

function buildVoiceLine(item: EmiRecord, brandName: string): string {
  const paidAmt = computePaidAmount(item);
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

function normalizePhoneForWa(rawMobile: string): string {
  const digits = rawMobile.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10 && digits.startsWith("91")) return digits;
  return digits || "919999999999";
}

export default function Page() {
  const [shopSlug, setShopSlug] = useState<string>(DEFAULT_SHOP_SLUG);
  const [subscription, setSubscription] = useState<ShopSubscription | null>(null);
  const [subLoading, setSubLoading] = useState<boolean>(true);
  const [isSubscriptionBlocked, setIsSubscriptionBlocked] = useState<boolean>(false);
  const [daysLeft, setDaysLeft] = useState<number>(TRIAL_DAYS);
  const [todayDay, setTodayDay] = useState<number>(1);
  const [activeDateKey, setActiveDateKey] = useState<string>("");
  const [records, setRecords] = useState<EmiRecord[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>(
    "Ready — Supabase sync, Trash Backup & Free Hindi AI Voice active hai."
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkingAuto, setCheckingAuto] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeFolder, setActiveFolder] = useState<FolderTab>("ALL");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [addUdhaarAmounts, setAddUdhaarAmounts] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMobile, setEditMobile] = useState<string>("");
  const [editAddress, setEditAddress] = useState<string>("");
  const [editDueDay, setEditDueDay] = useState<string>("15");
  const [queueIndex, setQueueIndex] = useState<number>(0);

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

  function evaluateSubscription(sub: ShopSubscription | null, nowTimestamp: number) {
    if (!sub) {
      setIsSubscriptionBlocked(false);
      setDaysLeft(TRIAL_DAYS);
      return false;
    }
    const expTime = new Date(sub.expiresAt).getTime();
    const validExpiry = Number.isFinite(expTime) ? expTime : nowTimestamp + 86400000;
    const remainingDays = Math.max(
      0,
      Math.ceil((validExpiry - nowTimestamp) / (1000 * 60 * 60 * 24))
    );
    const blocked = !sub.isActive || validExpiry <= nowTimestamp;
    setDaysLeft(remainingDays);
    setIsSubscriptionBlocked(blocked);
    return blocked;
  }

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

  function addTodayCollection(
    item: EmiRecord,
    amountAdded: number,
    dateKey: string
  ): EmiRecord {
    const prevToday =
      item.todayCollectedDateKey === dateKey
        ? Number(item.todayCollectedAmount) || 0
        : 0;
    return {
      ...item,
      todayCollectedDateKey: dateKey,
      todayCollectedAmount: prevToday + Math.max(0, amountAdded),
    };
  }

  async function ensureShopSubscription(
    resolvedShop: string,
    nowTimestamp: number
  ): Promise<ShopSubscription | null> {
    const { data: existing, error: fetchErr } = await supabase
      .from("shops")
      .select("*")
      .eq("shop_slug", resolvedShop)
      .maybeSingle();

    if (!fetchErr && existing) {
      return mapShopRow(existing as Record<string, unknown>, resolvedShop);
    }

    const trialExpiry = new Date(
      nowTimestamp + TRIAL_DAYS * 24 * 60 * 60 * 1000
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
    const currentDay = now.getDate();
    const currentDateKey = formatDateKey(now);
    setTodayDay(currentDay);
    setActiveDateKey(currentDateKey);

    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const activeBrand = formatShopTitle(activeShop);
    const activeOnly = currentList.filter((r) => !r.isTrashed);

    const dueSoon = activeOnly.filter((r) => {
      const paidAmt = computePaidAmount(r);
      const hasDue = r.totalAmount - paidAmt > 0 || r.paidMonths < r.totalMonths;
      return (
        hasDue &&
        getReminderDay(r.dueDay) === currentDay &&
        r.lastAutoVoiceMonth !== monthKey
      );
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
        `[${activeBrand}] Auto 2-Day Reminder chala (${currentDay} tarikh): ${names} ke liye Hindi voice alert trigger ho gaya.`
      );
    } else if (announceEmpty) {
      setStatusMsg(
        `[${activeBrand}] Auto check complete (${currentDay} tarikh): Aaj kisi customer ka 2-day reminder pending nahi hai.`
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
          records: activeOnly.map((r) => ({
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
            udharAmount: Math.max(0, r.totalAmount - computePaidAmount(r)),
            lastAutoSentMonth: r.lastAutoVoiceMonth,
          })),
        }),
      });
    } catch {
      // ignore background sync error
    }
  }

  useEffect(() => {
    const initialNow = new Date();
    const initialDateKey = formatDateKey(initialNow);
    setTodayDay(initialNow.getDate());
    setActiveDateKey(initialDateKey);

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
          const filteredLocal = parsed
            .filter(
              (item: EmiRecord) => (item.shopSlug || DEFAULT_SHOP_SLUG) === resolvedShop
            )
            .map((item: EmiRecord) => ({
              ...item,
              todayCollectedAmount:
                item.todayCollectedDateKey === initialDateKey
                  ? Number(item.todayCollectedAmount) || 0
                  : 0,
              todayCollectedDateKey: initialDateKey,
            }));
          localList = filteredLocal;
          setRecords(filteredLocal);
          recordsRef.current = filteredLocal;
        }
      }
    } catch {
      // ignore storage read error
    }

    void (async () => {
      const startTime = new Date().getTime();
      const sub = await ensureShopSubscription(resolvedShop, startTime);
      setSubscription(sub);
      const blocked = evaluateSubscription(sub, new Date().getTime());
      setSubLoading(false);

      if (blocked) {
        return;
      }

      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("shop_slug", resolvedShop)
        .order("created_at", { ascending: false });

      if (!error && data) {
        const dbRecords = data.map((row: Record<string, unknown>) => {
          const mapped = mapRowToRecord(row, resolvedShop, initialDateKey);
          const matchingLocal = localList.find((l) => l.id === mapped.id);
          if (matchingLocal && matchingLocal.todayCollectedDateKey === initialDateKey) {
            return {
              ...mapped,
              todayCollectedAmount: Number(matchingLocal.todayCollectedAmount) || 0,
              todayCollectedDateKey: initialDateKey,
            };
          }
          return mapped;
        });
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

    const nowStamp = new Date();
    const dateKey = formatDateKey(nowStamp);
    setTodayDay(nowStamp.getDate());
    setActiveDateKey(dateKey);

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
      id: `${nowStamp.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
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
      createdAt: nowStamp.toISOString(),
      customPaidAmount: 0,
      todayCollectedAmount: 0,
      todayCollectedDateKey: dateKey,
      isTrashed: false,
    };

    const { error } = await supabase.from("customers").insert(mapRecordToRow(newItem));

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
    const nowStamp = new Date();
    const dateKey = formatDateKey(nowStamp);
    setTodayDay(nowStamp.getDate());
    setActiveDateKey(dateKey);

    const activeShop = shopSlugRef.current;
    const target = recordsRef.current.find((item) => item.id === id);
    if (!target) return;

    const nextPaid = Math.min(target.totalMonths, target.paidMonths + 1);
    const addedEmi =
      nextPaid > target.paidMonths ? Math.max(0, Number(target.monthlyEmi) || 0) : 0;

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
      item.id === id
        ? addTodayCollection({ ...item, paidMonths: nextPaid }, addedEmi, dateKey)
        : item
    );
    saveRecords(updated, activeShop);
    setStatusMsg(
      `${target.customerName} ki 1 EMI (₹${addedEmi.toLocaleString(
        "en-IN"
      )}) Paid update kar di gayi hai.`
    );
  }

  async function handleCustomJama(item: EmiRecord) {
    if (isSubscriptionBlocked) return;
    const nowStamp = new Date();
    const dateKey = formatDateKey(nowStamp);
    setTodayDay(nowStamp.getDate());
    setActiveDateKey(dateKey);

    const rawVal = customAmounts[item.id] ?? "";
    const jamaAmt = Number(rawVal);
    if (!Number.isFinite(jamaAmt) || jamaAmt <= 0) {
      setStatusMsg("Jama karne ke liye sahi amount (₹) likhein.");
      return;
    }

    const currentPaid = computePaidAmount(item);
    const maxPossibleAdd = Math.max(0, item.totalAmount - currentPaid);
    if (maxPossibleAdd <= 0) {
      setStatusMsg(`${item.customerName} ka poora udhaar pehle hi clear hai.`);
      return;
    }

    const appliedAmt = Math.min(jamaAmt, maxPossibleAdd);
    const nextCustomPaid = (item.customPaidAmount || 0) + appliedAmt;
    const updatedItem: EmiRecord = addTodayCollection(
      {
        ...item,
        customPaidAmount: nextCustomPaid,
      },
      appliedAmt,
      dateKey
    );

    const rowPayload = mapRecordToRow(updatedItem);
    const { error } = await supabase
      .from("customers")
      .update({ address: rowPayload.address })
      .eq("id", item.id)
      .eq("shop_slug", shopSlugRef.current);

    if (error) {
      setStatusMsg(`Jama update error: ${error.message}`);
      return;
    }

    const updatedList = recordsRef.current.map((r) =>
      r.id === item.id ? updatedItem : r
    );
    saveRecords(updatedList, shopSlugRef.current);
    setCustomAmounts((prev) => ({ ...prev, [item.id]: "" }));

    const newPaidTotal = computePaidAmount(updatedItem);
    const newBacha = Math.max(0, updatedItem.totalAmount - newPaidTotal);

    setStatusMsg(
      `${item.customerName} ne ₹${appliedAmt.toLocaleString(
        "en-IN"
      )} jama kiye | Bacha Udhaar: ₹${newBacha.toLocaleString("en-IN")}.`
    );

    const waPhone = normalizePhoneForWa(item.mobile);
    const receiptText = encodeURIComponent(
      `Namaste ${item.customerName} ji, ${brandName} se payment receipt:\n` +
        `Aaj Jama Kiya: ₹${appliedAmt.toLocaleString("en-IN")}\n` +
        `Kul Jama: ₹${newPaidTotal.toLocaleString("en-IN")}\n` +
        `Bacha Hua Udhaar: ₹${newBacha.toLocaleString("en-IN")}`
    );
    window.open(`https://wa.me/${waPhone}?text=${receiptText}`, "_blank", "noopener,noreferrer");
  }

  async function handleAddMoreUdhaar(item: EmiRecord) {
    if (isSubscriptionBlocked) return;
    const rawExtra = addUdhaarAmounts[item.id] ?? "";
    const extraAmt = Number(rawExtra);
    if (!Number.isFinite(extraAmt) || extraAmt <= 0) {
      setStatusMsg("Naya udhaar jodne ke liye sahi amount (₹) likhein.");
      return;
    }

    const nextTotal = Math.max(0, Number(item.totalAmount) || 0) + extraAmt;
    const { error } = await supabase
      .from("customers")
      .update({ total_amount: nextTotal })
      .eq("id", item.id)
      .eq("shop_slug", shopSlugRef.current);

    if (error) {
      setStatusMsg(`Udhaar add error: ${error.message}`);
      return;
    }

    const updatedList = recordsRef.current.map((r) =>
      r.id === item.id ? { ...r, totalAmount: nextTotal } : r
    );
    saveRecords(updatedList, shopSlugRef.current);
    setAddUdhaarAmounts((prev) => ({ ...prev, [item.id]: "" }));

    const newBacha = Math.max(
      0,
      nextTotal - computePaidAmount({ ...item, totalAmount: nextTotal })
    );
    setStatusMsg(
      `${item.customerName} ke khate mein +₹${extraAmt.toLocaleString(
        "en-IN"
      )} naya udhaar joda gaya | Naya Bacha Udhaar: ₹${newBacha.toLocaleString("en-IN")}.`
    );
  }

  function startEditCustomer(item: EmiRecord) {
    setEditingId(item.id);
    setEditMobile(item.mobile);
    setEditAddress(item.address);
    setEditDueDay(String(item.dueDay || 15));
  }

  async function handleSaveEditCustomer(item: EmiRecord) {
    if (isSubscriptionBlocked) return;
    const cleanMob = editMobile.trim();
    const cleanAddr = editAddress.trim();
    const cleanDay = Math.min(28, Math.max(1, Number(editDueDay) || 15));

    if (!cleanMob) {
      setStatusMsg("Mobile number khali nahi ho sakta.");
      return;
    }

    const updatedItem: EmiRecord = {
      ...item,
      mobile: cleanMob,
      address: cleanAddr,
      dueDay: cleanDay,
    };

    const rowPayload = mapRecordToRow(updatedItem);
    const { error } = await supabase
      .from("customers")
      .update({
        mobile: rowPayload.mobile,
        address: rowPayload.address,
        due_day: rowPayload.due_day,
      })
      .eq("id", item.id)
      .eq("shop_slug", shopSlugRef.current);

    if (error) {
      setStatusMsg(`Edit update error: ${error.message}`);
      return;
    }

    const updatedList = recordsRef.current.map((r) =>
      r.id === item.id ? updatedItem : r
    );
    saveRecords(updatedList, shopSlugRef.current);
    setEditingId(null);
    setStatusMsg(`${item.customerName} ki details update kar di gayi hain.`);
  }

  function handleShareKhataStatement(item: EmiRecord) {
    const paidAmt = computePaidAmount(item);
    const bachaAmt = Math.max(0, item.totalAmount - paidAmt);
    const waPhone = normalizePhoneForWa(item.mobile);
    const khataText = encodeURIComponent(
      `Namaste ${item.customerName} ji, *${brandName}* se aapka Khata Statement:\n` +
        `• Kul Udhaar / Loan: ₹${item.totalAmount.toLocaleString("en-IN")}\n` +
        `• Kul Jama / Paid: ₹${paidAmt.toLocaleString("en-IN")}\n` +
        `• Bacha Hua Udhaar: ₹${bachaAmt.toLocaleString("en-IN")}\n` +
        `• Monthly EMI: ₹${item.monthlyEmi.toLocaleString("en-IN")} (Har ${item.dueDay} tarikh)`
    );
    window.open(`https://wa.me/${waPhone}?text=${khataText}`, "_blank", "noopener,noreferrer");
    setStatusMsg(`${item.customerName} ka Khata Statement WhatsApp par taiyar kiya gaya.`);
  }

  async function handleMoveToTrash(item: EmiRecord) {
    if (isSubscriptionBlocked) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Kya aap sach mein "${item.customerName}" (${item.mobile}) ko Trash Bin mein bhejna chahte hain?\n(Baad mein Trash Bin se wapas Restore kiya ja sakta hai.)`
      );
      if (!ok) return;
    }

    const activeShop = shopSlugRef.current;
    const trashedItem: EmiRecord = { ...item, isTrashed: true };
    const rowPayload = mapRecordToRow(trashedItem);

    const { error } = await supabase
      .from("customers")
      .update({ address: rowPayload.address })
      .eq("id", item.id)
      .eq("shop_slug", activeShop);

    if (error) {
      setStatusMsg(`Trash move error: ${error.message}`);
      return;
    }

    const updated = recordsRef.current.map((r) =>
      r.id === item.id ? trashedItem : r
    );
    saveRecords(updated, activeShop);
    if (editingId === item.id) {
      setEditingId(null);
    }
    setStatusMsg(
      `"${item.customerName}" ko Trash Bin mein bhej diya gaya hai — zaroorat padne par Trash folder se Restore kar sakte hain.`
    );
  }

  async function handleRestoreFromTrash(item: EmiRecord) {
    if (isSubscriptionBlocked) return;
    const activeShop = shopSlugRef.current;
    const restoredItem: EmiRecord = { ...item, isTrashed: false };
    const rowPayload = mapRecordToRow(restoredItem);

    const { error } = await supabase
      .from("customers")
      .update({ address: rowPayload.address })
      .eq("id", item.id)
      .eq("shop_slug", activeShop);

    if (error) {
      setStatusMsg(`Restore error: ${error.message}`);
      return;
    }

    const updated = recordsRef.current.map((r) =>
      r.id === item.id ? restoredItem : r
    );
    saveRecords(updated, activeShop);
    setStatusMsg(`"${item.customerName}" ko wapas Active list mein Restore kar diya gaya hai.`);
  }

  async function handlePermanentDelete(item: EmiRecord) {
    if (isSubscriptionBlocked) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `WARNING: Kya aap "${item.customerName}" ko hamesha ke liye (Permanently) delete karna chahte hain? Ise wapas nahi laya ja sakega.`
      );
      if (!ok) return;
    }

    const activeShop = shopSlugRef.current;
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", item.id)
      .eq("shop_slug", activeShop);

    if (error) {
      setStatusMsg(`Supabase delete error: ${error.message}`);
      return;
    }

    const updated = recordsRef.current.filter((r) => r.id !== item.id);
    saveRecords(updated, activeShop);
    if (editingId === item.id) {
      setEditingId(null);
    }
    setStatusMsg(`"${item.customerName}" ka record permanently delete kar diya gaya hai.`);
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
            udharAmount: Math.max(0, item.totalAmount - computePaidAmount(item)),
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

  function handleExportCsv() {
    const activeRecords = records.filter((r) => !r.isTrashed);
    const headers = [
      "Customer Name",
      "Father Name",
      "Mobile",
      "Address",
      "Kul Udhaar",
      "Monthly EMI",
      "Paid Months",
      "Total Months",
      "Kul Jama",
      "Bacha Udhaar",
      "Due Day",
      "Status",
    ];

    const rows = activeRecords.map((item) => {
      const paidAmt = computePaidAmount(item);
      const bachaAmt = Math.max(0, item.totalAmount - paidAmt);
      const st = getDueAlertStatus(item, todayDay);
      return [
        item.customerName,
        item.fatherName,
        item.mobile,
        item.address,
        String(item.totalAmount),
        String(item.monthlyEmi),
        String(item.paidMonths),
        String(item.totalMonths),
        String(paidAmt),
        String(bachaAmt),
        String(item.dueDay),
        st,
      ];
    });

    const csvContent = [headers, ...rows]
      .map((cols) =>
        cols
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${shopSlug}-emi-udhaar-hisab.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMsg(`${brandName} ka CSV hisab download ho gaya hai.`);
  }

  if (isSubscriptionBlocked && subscription) {
    const whatsappRenewText = encodeURIComponent(
      `Namaste! Mujhe apni dukaan "${brandName}" (${shopSlug}) ke liye ₹${MONTHLY_PRICE}/month subscription renew karwana hai.`
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

  const activeRecords = records.filter((r) => !r.isTrashed);
  const trashedRecords = records.filter((r) => Boolean(r.isTrashed));

  const totalUdhaarAll = activeRecords.reduce((acc, r) => acc + r.totalAmount, 0);
  const totalPaidAll = activeRecords.reduce((acc, r) => acc + computePaidAmount(r), 0);
  const totalBachaAll = Math.max(0, totalUdhaarAll - totalPaidAll);
  const aajKiJamaAll = activeRecords.reduce((acc, r) => {
    if (activeDateKey && r.todayCollectedDateKey === activeDateKey) {
      return acc + (Number(r.todayCollectedAmount) || 0);
    }
    return acc;
  }, 0);

  const dueOnlyRecords = activeRecords.filter((r) => {
    const st = getDueAlertStatus(r, todayDay);
    return st === "DUE_TODAY" || st === "OVERDUE";
  });
  const redAlertCount = dueOnlyRecords.length;

  const safeQueueIdx =
    dueOnlyRecords.length > 0 ? queueIndex % dueOnlyRecords.length : 0;
  const currentDueCustomer =
    dueOnlyRecords.length > 0 ? dueOnlyRecords[safeQueueIdx] : null;

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const baseList =
    activeFolder === "TRASH"
      ? trashedRecords
      : activeFolder === "DUE_ONLY"
      ? dueOnlyRecords
      : activeRecords;

  const visibleRecords = trimmedQuery
    ? baseList.filter((item) => {
        return (
          item.customerName.toLowerCase().includes(trimmedQuery) ||
          item.fatherName.toLowerCase().includes(trimmedQuery) ||
          item.mobile.toLowerCase().includes(trimmedQuery) ||
          item.address.toLowerCase().includes(trimmedQuery)
        );
      })
    : baseList;

  const renewMessage = encodeURIComponent(
    `Namaste! Mujhe apni dukaan "${brandName}" (${shopSlug}) ke liye ₹${MONTHLY_PRICE}/month subscription lena hai.`
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {!subLoading && subscription && daysLeft <= 3 && (
          <div className="bg-amber-950/80 border border-amber-500/80 text-amber-200 rounded-xl px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <strong>Plan Expiry Warning:</strong> Aapka{" "}
              <strong>{subscription.planName}</strong> sirf{" "}
              <strong>{daysLeft} din</strong> mein khatam hone wala hai. Bina rukawat chalane ke liye ₹{MONTHLY_PRICE}/month renew karein.
            </div>
            <a
              href={`https://wa.me/91${ADMIN_PHONE}?text=${renewMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs text-center shrink-0"
            >
              Abhi Renew Karein
            </a>
          </div>
        )}

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
              {redAlertCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveFolder("DUE_ONLY")}
                  className="px-3 py-1 rounded-full text-xs font-bold bg-rose-950 border border-rose-600 text-rose-300 animate-pulse cursor-pointer"
                >
                  RED ALERT: {redAlertCount} Due / Overdue
                </button>
              )}
            </div>
            <p className="text-sm text-slate-300 mt-1">
              Udhaar + EMI Hisaab, Due Date &amp; 2 Din Pehle Auto Reminder Dashboard
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm cursor-pointer"
            >
              Print Khata
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-600 text-white font-semibold text-sm cursor-pointer"
            >
              Export CSV
            </button>
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

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
              Aaj Ki Vasooli (Today)
            </div>
            <div className="text-2xl font-bold text-lime-400 mt-1">
              ₹{aajKiJamaAll.toLocaleString("en-IN")}
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
          <div
            onClick={() =>
              setActiveFolder((prev) => (prev === "DUE_ONLY" ? "ALL" : "DUE_ONLY"))
            }
            className="bg-slate-900 border border-slate-800 hover:border-rose-600 rounded-xl p-4 cursor-pointer"
          >
            <div className="text-xs uppercase tracking-wider text-slate-400">
              Red Alert Folder
            </div>
            <div
              className={`text-2xl font-bold mt-1 ${
                redAlertCount > 0 ? "text-rose-400" : "text-sky-400"
              }`}
            >
              {redAlertCount} / {activeRecords.length}
            </div>
          </div>
        </section>

        {currentDueCustomer && (
          <section className="bg-rose-950/40 border border-rose-700/70 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm">
              <span className="font-bold text-rose-300">
                Due List Quick Reminder ({safeQueueIdx + 1} / {dueOnlyRecords.length}):
              </span>{" "}
              <span className="font-semibold text-white">
                {currentDueCustomer.customerName}
              </span>{" "}
              <span className="text-slate-300">
                ({currentDueCustomer.mobile} • EMI ₹
                {currentDueCustomer.monthlyEmi.toLocaleString("en-IN")} • Due{" "}
                {currentDueCustomer.dueDay} tarikh)
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleSendReminder(currentDueCustomer);
                  setQueueIndex((prev) => prev + 1);
                }}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
              >
                Send Reminder &amp; Next Due ({safeQueueIdx + 1}/{dueOnlyRecords.length})
              </button>
              <button
                type="button"
                onClick={() => setQueueIndex((prev) => prev + 1)}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Skip Next
              </button>
            </div>
          </section>
        )}

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

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveFolder("ALL")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer ${
                  activeFolder === "ALL"
                    ? "bg-sky-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                All Customers ({activeRecords.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFolder("DUE_ONLY")}
                className={`px-4 py-2 rounded-xl text-sm font-bold cursor-pointer ${
                  activeFolder === "DUE_ONLY"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-950/70 border border-rose-700/70 text-rose-300 hover:bg-rose-900/70"
                }`}
              >
                Due Only Folder ({redAlertCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveFolder("TRASH")}
                className={`px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer ${
                  activeFolder === "TRASH"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 border border-slate-700 text-amber-300 hover:bg-slate-700"
                }`}
              >
                Trash / Recycle Bin ({trashedRecords.length})
              </button>
            </div>

            <div className="w-full lg:w-80">
              <input
                type="text"
                placeholder="Search naam, mobile, pata..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white"
              />
            </div>
          </div>

          <h2 className="text-lg font-bold text-white">
            {activeFolder === "TRASH"
              ? `Trash / Recycle Bin — Restore Ya Permanent Delete (${visibleRecords.length})`
              : activeFolder === "DUE_ONLY"
              ? `Due Only Folder — Due / Overdue Customers (${visibleRecords.length})`
              : `Saved Records (${visibleRecords.length})`}
          </h2>

          {visibleRecords.length === 0 ? (
            <p className="text-sm text-slate-400">
              {activeFolder === "TRASH"
                ? "Trash Bin khali hai. Galti se delete kiye gaye customers yahan dikhenge."
                : activeFolder === "DUE_ONLY"
                ? "Due Only folder mein abhi koi due/overdue customer nahi hai."
                : "Koi record nahi mila. Naya record jodein ya search badlein."}
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
                    <th className="py-3 px-3">Due Alert</th>
                    <th className="py-3 px-3">Auto Reminder</th>
                    <th className="py-3 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((item) => {
                    const paidAmt = computePaidAmount(item);
                    const remainingAmt = Math.max(0, item.totalAmount - paidAmt);
                    const remDay = getReminderDay(item.dueDay);
                    const alertStatus = getDueAlertStatus(item, todayDay);
                    const isRedAlert =
                      !item.isTrashed &&
                      (alertStatus === "DUE_TODAY" || alertStatus === "OVERDUE");
                    const isEditing = editingId === item.id;

                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-slate-800/80 ${
                          item.isTrashed
                            ? "bg-amber-950/20 hover:bg-amber-950/35"
                            : isRedAlert
                            ? "bg-rose-950/45 hover:bg-rose-950/65"
                            : "hover:bg-slate-800/40"
                        }`}
                      >
                        <td className="py-3 px-3 font-semibold text-white">
                          <div className="flex items-center gap-2">
                            {isRedAlert && (
                              <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                            )}
                            <span>{item.customerName}</span>
                          </div>
                          {item.fatherName && (
                            <div className="text-xs text-slate-400 font-normal">
                              S/o {item.fatherName}
                            </div>
                          )}
                          {isEditing ? (
                            <input
                              type="text"
                              value={editAddress}
                              onChange={(e) => setEditAddress(e.target.value)}
                              placeholder="Address"
                              className="mt-1 w-40 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white font-normal"
                            />
                          ) : (
                            item.address && (
                              <div className="text-xs text-slate-400 font-normal">
                                {item.address}
                              </div>
                            )
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-200">
                          {isEditing ? (
                            <input
                              type="tel"
                              value={editMobile}
                              onChange={(e) => setEditMobile(e.target.value)}
                              className="w-32 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white"
                            />
                          ) : (
                            item.mobile
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-200">
                          ₹{item.totalAmount.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-sky-300 font-medium">
                          ₹{item.monthlyEmi.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3 px-3 text-emerald-300 font-semibold">
                          {item.paidMonths} / {item.totalMonths}
                          {(item.customPaidAmount || 0) > 0 && (
                            <div className="text-[11px] text-emerald-400 font-normal">
                              +₹{(item.customPaidAmount || 0).toLocaleString("en-IN")} jama
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-amber-300 font-bold">
                          ₹{remainingAmt.toLocaleString("en-IN")}
                        </td>
                        <td
                          className={`py-3 px-3 font-semibold ${
                            isRedAlert ? "text-rose-300" : "text-white"
                          }`}
                        >
                          {isEditing ? (
                            <input
                              type="number"
                              min="1"
                              max="28"
                              value={editDueDay}
                              onChange={(e) => setEditDueDay(e.target.value)}
                              className="w-16 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white"
                            />
                          ) : (
                            `Har ${item.dueDay} tarikh`
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {item.isTrashed ? (
                            <span className="inline-block px-2.5 py-1 rounded-full bg-amber-950 border border-amber-700 text-amber-300 text-xs font-semibold">
                              In Trash Bin
                            </span>
                          ) : (
                            <>
                              {alertStatus === "DUE_TODAY" && (
                                <span className="inline-block px-2.5 py-1 rounded-full bg-rose-600 text-white text-xs font-bold">
                                  RED ALERT: Aaj Due
                                </span>
                              )}
                              {alertStatus === "OVERDUE" && (
                                <span className="inline-block px-2.5 py-1 rounded-full bg-red-700 text-white text-xs font-bold">
                                  RED ALERT: Overdue
                                </span>
                              )}
                              {alertStatus === "UPCOMING" && (
                                <span className="inline-block px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium">
                                  Due {item.dueDay} tarikh ko
                                </span>
                              )}
                              {alertStatus === "CLEARED" && (
                                <span className="inline-block px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-300 text-xs font-semibold">
                                  Paid / Clear
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="py-3 px-3 text-purple-300">
                          {remDay} tarikh (2 din pehle)
                        </td>
                        <td className="py-3 px-3">
                          {item.isTrashed ? (
                            <div className="flex flex-wrap gap-1.5 min-w-[200px]">
                              <button
                                type="button"
                                onClick={() => handleRestoreFromTrash(item)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                              >
                                Restore Wapas Laayein
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePermanentDelete(item)}
                                className="px-3 py-1.5 rounded-lg bg-rose-800 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
                              >
                                Delete Forever
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2 min-w-[230px]">
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  disabled={busyId === item.id}
                                  onClick={() => handleSendReminder(item)}
                                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                                >
                                  {busyId === item.id
                                    ? "Sending..."
                                    : "Send WhatsApp + AI Call"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMarkPaid(item.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Mark Paid (+1M)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleShareKhataStatement(item)}
                                  className="px-2.5 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Khata WA
                                </button>
                                {isEditing ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditCustomer(item)}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                                  >
                                    Save Edit
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => startEditCustomer(item)}
                                    className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleMoveToTrash(item)}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Delete
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min="1"
                                  placeholder="₹ Jama"
                                  value={customAmounts[item.id] ?? ""}
                                  onChange={(e) =>
                                    setCustomAmounts((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.value,
                                    }))
                                  }
                                  className="w-20 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCustomJama(item)}
                                  className="px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Jama + Receipt
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min="1"
                                  placeholder="+₹ Udhaar"
                                  value={addUdhaarAmounts[item.id] ?? ""}
                                  onChange={(e) =>
                                    setAddUdhaarAmounts((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.value,
                                    }))
                                  }
                                  className="w-20 rounded-lg bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleAddMoreUdhaar(item)}
                                  className="px-2 py-1 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold cursor-pointer"
                                >
                                  +Udhaar Jodein
                                </button>
                              </div>
                            </div>
                          )}
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
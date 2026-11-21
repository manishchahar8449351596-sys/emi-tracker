import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export interface EmiRecord {
  id: string;
  customerName: string;
  fatherName: string;
  mobile: string;
  address: string;
  loanName: string;
  monthlyEmi: number;
  totalMonths: number;
  paidMonths: number;
  dueDay: number;
  udharAmount: number;
  lastAutoSentMonth?: string;
}

export interface FreeReminderItem {
  id: string;
  customerName: string;
  mobile: string;
  dueDay: number;
  script: string;
  whatsappUrl: string;
}

const BRAND_NAME = "Jai Mata Di Point Akola";
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "jmdp_records.json");

function ensureStorage(): EmiRecord[] {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "[]", "utf-8");
    return [];
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStorage(records: EmiRecord[]) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function buildWhatsAppUrl(mobile: string, text: string): string {
  const to = normalizePhone(mobile);
  const encoded = encodeURIComponent(text);
  return to ? `https://wa.me/${to}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

function buildHindiScript(item: EmiRecord): string {
  const remMonths = Math.max(0, item.totalMonths - item.paidMonths);
  const totalDue = remMonths * item.monthlyEmi + item.udharAmount;
  return (
    `Namaste ${item.customerName} ji, yeh message ${BRAND_NAME} ki taraf se hai. ` +
    `Aapki ${item.loanName} ki mahine ki EMI ${item.monthlyEmi} rupaye har mahine ki ` +
    `${item.dueDay} tarikh ko due hai.` +
    `${item.udharAmount > 0 ? ` Aapka baki udhar ${item.udharAmount} rupaye hai.` : ""} ` +
    `Kul bacha hua hisab ${totalDue} rupaye hai. Kripya samay par jama karayein. Dhanyawad.`
  );
}

async function sendRealWhatsApp(item: EmiRecord, text: string) {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = normalizePhone(item.mobile);
  const whatsappUrl = buildWhatsAppUrl(item.mobile, text);

  if (!token || !phoneId) {
    return {
      sent: false,
      freeMode: true,
      whatsappUrl,
      detail: "Free mode ready (WhatsApp link prepared, no API charge)",
    };
  }
  if (!to || to.length < 10) {
    return { sent: false, freeMode: false, whatsappUrl, detail: "Customer mobile number invalid hai" };
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return {
      sent: false,
      freeMode: true,
      whatsappUrl,
      detail: data?.error?.message || "WhatsApp API error",
    };
  }
  return { sent: true, freeMode: false, whatsappUrl, detail: `WhatsApp sent to +${to}` };
}

async function makeRealAiCall(item: EmiRecord, script: string) {
  const to = normalizePhone(item.mobile);
  if (!to || to.length < 10) {
    return { called: false, freeMode: false, detail: "Customer mobile number invalid hai" };
  }
  const e164Phone = `+${to}`;

  const vapiKey = process.env.VAPI_API_KEY;
  const vapiAssistantId = process.env.VAPI_ASSISTANT_ID;
  const vapiPhoneId = process.env.VAPI_PHONE_NUMBER_ID;

  if (vapiKey && vapiAssistantId && vapiPhoneId) {
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vapiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: vapiAssistantId,
        phoneNumberId: vapiPhoneId,
        customer: {
          number: e164Phone,
          name: item.customerName,
        },
        assistantOverrides: {
          firstMessage: script,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { called: false, freeMode: true, detail: data?.message || "Vapi AI Call error" };
    }
    return { called: true, freeMode: false, detail: `Vapi AI Call initiated to ${e164Phone}` };
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER;

  if (twilioSid && twilioToken && twilioFrom) {
    const twiml = `<Response><Say language="hi-IN">${script}</Say></Response>`;
    const params = new URLSearchParams();
    params.append("To", e164Phone);
    params.append("From", twilioFrom);
    params.append("Twiml", twiml);

    const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return { called: false, freeMode: true, detail: data?.message || "Twilio Call error" };
    }
    return { called: true, freeMode: false, detail: `Twilio Voice Call initiated to ${e164Phone}` };
  }

  return {
    called: false,
    freeMode: true,
    detail: "Free Hindi AI Voice ready in browser (no API charge)",
  };
}

function isTwoDaysBeforeDue(dueDay: number): boolean {
  const target = new Date();
  target.setDate(target.getDate() + 2);
  return target.getDate() === dueDay;
}

async function runTwoDayDueCheck() {
  const records = ensureStorage();
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const logs: string[] = [];
  const dueReminders: FreeReminderItem[] = [];
  let updated = false;

  for (const item of records) {
    if (item.paidMonths >= item.totalMonths && item.udharAmount <= 0) continue;
    if (!isTwoDaysBeforeDue(item.dueDay)) continue;
    if (item.lastAutoSentMonth === monthKey) continue;

    const script = buildHindiScript(item);
    const wa = await sendRealWhatsApp(item, script);
    const call = await makeRealAiCall(item, script);

    dueReminders.push({
      id: item.id,
      customerName: item.customerName,
      mobile: item.mobile,
      dueDay: item.dueDay,
      script,
      whatsappUrl: wa.whatsappUrl,
    });

    if (wa.sent || call.called || wa.freeMode || call.freeMode) {
      item.lastAutoSentMonth = monthKey;
      updated = true;
    }
    logs.push(`${item.customerName}: WA(${wa.detail}) | Voice(${call.detail})`);
  }

  if (updated) {
    saveStorage(records);
  }
  return { logs, dueReminders };
}

const globalForScheduler = globalThis as unknown as { jmdpSchedulerStarted?: boolean };
if (!globalForScheduler.jmdpSchedulerStarted) {
  globalForScheduler.jmdpSchedulerStarted = true;
  setInterval(() => {
    void runTwoDayDueCheck();
  }, 60 * 60 * 1000);
}

export async function GET() {
  const records = ensureStorage();
  return NextResponse.json({ ok: true, brand: BRAND_NAME, records });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body?.action as string;

    if (action === "SYNC_RECORDS") {
      const incoming = Array.isArray(body?.records) ? (body.records as EmiRecord[]) : [];
      saveStorage(incoming);
      const { logs: autoLogs, dueReminders } = await runTwoDayDueCheck();
      return NextResponse.json({
        ok: true,
        brand: BRAND_NAME,
        savedCount: incoming.length,
        autoLogs,
        dueReminders,
      });
    }

    if (action === "RUN_AUTO_CHECK") {
      const { logs: autoLogs, dueReminders } = await runTwoDayDueCheck();
      return NextResponse.json({
        ok: true,
        brand: BRAND_NAME,
        autoLogs,
        dueReminders,
        message:
          autoLogs.length > 0
            ? autoLogs.join(" || ")
            : "Aaj kisi customer ki due date 2 din baad nahi hai.",
      });
    }

    if (action === "TRIGGER_NOW") {
      const item = body?.record as EmiRecord;
      if (!item || !item.customerName) {
        return NextResponse.json({ ok: false, error: "Record missing" }, { status: 400 });
      }
      const script = buildHindiScript(item);
      const wa = await sendRealWhatsApp(item, script);
      const call = await makeRealAiCall(item, script);

      return NextResponse.json({
        ok: true,
        brand: BRAND_NAME,
        whatsappStatus: wa.detail,
        callStatus: call.detail,
        whatsappUrl: wa.whatsappUrl,
        voiceScript: script,
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
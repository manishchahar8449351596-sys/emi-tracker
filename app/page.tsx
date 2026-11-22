"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type ReminderLog = {
  id: string;
  customerId: string;
  customerName: string;
  channel: "AI_VOICE_CALL" | "WHATSAPP";
  attemptNumber: number;
  durationSeconds: number;
  billedAmountINR: number;
  status: "COMPLETED" | "CUT_EARLY" | "SCHEDULED";
  timestamp: string;
  scriptPreview: string;
};

type CustomerRecord = {
  id: string;
  name: string;
  mobile: string;
  address: string;
  itemName: string;
  principalAmount: number;
  downPayment: number;
  totalMonths: number;
  paidMonths: number;
  customPaidAmount: number;
  dueDay: number;
  createdAt: string;
  // KYC & Signature
  panPhoto: string;
  aadhaarFrontPhoto: string;
  aadhaarBackPhoto: string;
  selfiePhoto: string;
  signatureDataUrl: string;
  // Calling & Reminder Config
  retryCountTarget: number; // 5 to 8 calls
  callsAttemptedThisCycle: number;
  lastCallDate?: string;
  nextCallSlot?: string;
  voiceActive: boolean;
};

const PENALTY_AMOUNT = 365;
const RATE_PER_MINUTE_INR = 2; // ₹2/min shopkeeper rate
const CURRENT_DAY_OF_MONTH = 22; // 22 November 2026

function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function getTodayISO(): string {
  return "2026-11-22";
}

function calculateRemaining(c: CustomerRecord): {
  loanAmount: number;
  monthlyEmi: number;
  paidViaMonths: number;
  totalPaid: number;
  remainingBalance: number;
  isSettled: boolean;
} {
  const loanAmount = Math.max(0, c.principalAmount - c.downPayment);
  const monthlyEmi = c.totalMonths > 0 ? Math.round(loanAmount / c.totalMonths) : loanAmount;
  const paidViaMonths = Math.min(loanAmount, c.paidMonths * monthlyEmi);
  const totalPaid = Math.min(loanAmount, paidViaMonths + c.customPaidAmount);
  const remainingBalance = Math.max(0, loanAmount - totalPaid);
  const isSettled = remainingBalance <= 0 || c.paidMonths >= c.totalMonths;

  return {
    loanAmount,
    monthlyEmi,
    paidViaMonths,
    totalPaid,
    remainingBalance,
    isSettled,
  };
}

function buildHindiVoiceScript(shopName: string, c: CustomerRecord): string {
  const { monthlyEmi, remainingBalance } = calculateRemaining(c);
  const dueAmount = Math.min(monthlyEmi, remainingBalance);
  return `Namaste ${c.name} ji, ${shopName} se yaad dilaya ja raha hai ki aapki ${c.itemName} ki mahine ki kist ${dueAmount} rupaye, har mahine ki ${c.dueDay} tarikh ko due hai. Kripya samay par kist jama karein, anyatha samay par kist na bharne par ${PENALTY_AMOUNT} rupaye penalty lag jayegi. Dhanyavaad.`;
}

function buildWhatsAppReminderText(shopName: string, c: CustomerRecord): string {
  const { monthlyEmi, remainingBalance } = calculateRemaining(c);
  const dueAmount = Math.min(monthlyEmi, remainingBalance);
  return (
    `*${shopName} - EMI Reminder*\n` +
    `Namaste *${c.name}* ji,\n` +
    `Aapke *${c.itemName}* ki monthly EMI *₹${dueAmount}* (Due Date: har mahine ki *${c.dueDay} tarikh*) pending/upcoming hai.\n` +
    `Bacha hua total udhaar: *₹${remainingBalance}*\n` +
    `⚠️ *Zaroori Soochna:* Samay par kist jama na karne par *₹${PENALTY_AMOUNT} late penalty* lag jayegi.\n` +
    `Kripya dukaan par aakar ya call karke apni kist update karwayein. Dhanyavaad!`
  );
}

export default function EmiManagerAllInOnePage() {
  const [shopName, setShopName] = useState<string>("Jai Mata Di Point");
  const [shopPhone, setShopPhone] = useState<string>("9876543210");
  const [shopAddress, setShopAddress] = useState<string>("Main Market, Agra");

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [onlyDueFilter, setOnlyDueFilter] = useState<boolean>(false);
  const [todayCollection, setTodayCollection] = useState<number>(0);

  // Add Customer Form States
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [itemName, setItemName] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [downPayment, setDownPayment] = useState("0");
  const [totalMonths, setTotalMonths] = useState("6");
  const [dueDay, setDueDay] = useState("5");
  const [retryCountTarget, setRetryCountTarget] = useState<number>(6); // Default 6 (between 5 and 8)

  // KYC Photos
  const [panPhoto, setPanPhoto] = useState<string>("");
  const [aadhaarFrontPhoto, setAadhaarFrontPhoto] = useState<string>("");
  const [aadhaarBackPhoto, setAadhaarBackPhoto] = useState<string>("");
  const [selfiePhoto, setSelfiePhoto] = useState<string>("");

  // Digital Signature Canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>("");

  // Partial payment inputs per customer
  const [partialInputs, setPartialInputs] = useState<Record<string, string>>({});

  // Agreement Modal / Preview
  const [selectedAgreementCustomer, setSelectedAgreementCustomer] =
    useState<CustomerRecord | null>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const savedCustomers = localStorage.getItem("emi_app_customers_v2");
      const savedLogs = localStorage.getItem("emi_app_voice_logs_v2");
      const savedShop = localStorage.getItem("emi_app_shop_v2");
      if (savedCustomers) setCustomers(JSON.parse(savedCustomers));
      if (savedLogs) setLogs(JSON.parse(savedLogs));
      if (savedShop) {
        const parsed = JSON.parse(savedShop);
        if (parsed.shopName) setShopName(parsed.shopName);
        if (parsed.shopPhone) setShopPhone(parsed.shopPhone);
        if (parsed.shopAddress) setShopAddress(parsed.shopAddress);
      }
    } catch {
      // ignore storage parse errors
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("emi_app_customers_v2", JSON.stringify(customers));
    } catch {
      // ignore quota errors
    }
  }, [customers]);

  useEffect(() => {
    try {
      localStorage.setItem("emi_app_voice_logs_v2", JSON.stringify(logs));
    } catch {
      // ignore
    }
  }, [logs]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "emi_app_shop_v2",
        JSON.stringify({ shopName, shopPhone, shopAddress })
      );
    } catch {
      // ignore
    }
  }, [shopName, shopPhone, shopAddress]);

  // Initialize Signature Pad
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
  }, []);

  const getPointerPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startSignature = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPointerPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const drawSignature = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPointerPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setSignatureDataUrl(canvas.toDataURL("image/png"));
  };

  const endSignature = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      setSignatureDataUrl(canvas.toDataURL("image/png"));
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setSignatureDataUrl("");
  };

  // Compress image to keep localStorage & PDF fast
  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 700;
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setter(canvas.toDataURL("image/jpeg", 0.75));
        }
      };
      if (typeof reader.result === "string") {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMobile = mobile.replace(/\D/g, "");
    const principal = Number(principalAmount);
    const down = Number(downPayment) || 0;
    const months = Math.max(1, Number(totalMonths) || 1);
    const day = Math.min(28, Math.max(1, Number(dueDay) || 5));

    if (!name.trim() || cleanMobile.length < 10 || !itemName.trim() || principal <= 0) {
      alert("Kripya customer ka naam, 10-digit mobile number, item ka naam aur sahi amount bharein.");
      return;
    }

    if (!panPhoto || !aadhaarFrontPhoto || !aadhaarBackPhoto || !selfiePhoto || !signatureDataUrl) {
      alert(
        "Agreement PDF ke liye PAN Photo, Aadhaar Front, Aadhaar Back, Selfie aur Digital Signature sabhi zaroori hain."
      );
      return;
    }

    const newCustomer: CustomerRecord = {
      id: `CUST-${Date.now()}`,
      name: name.trim(),
      mobile: cleanMobile,
      address: address.trim() || "Address Not Provided",
      itemName: itemName.trim(),
      principalAmount: principal,
      downPayment: down,
      totalMonths: months,
      paidMonths: 0,
      customPaidAmount: 0,
      dueDay: day,
      createdAt: getTodayISO(),
      panPhoto,
      aadhaarFrontPhoto,
      aadhaarBackPhoto,
      selfiePhoto,
      signatureDataUrl,
      retryCountTarget: Math.min(8, Math.max(5, retryCountTarget)),
      callsAttemptedThisCycle: 0,
      nextCallSlot: "10:00 AM / 01:00 PM / 04:00 PM / 07:00 PM + Next Day Retry",
      voiceActive: true,
    };

    setCustomers((prev) => [newCustomer, ...prev]);

    // Reset form
    setName("");
    setMobile("");
    setAddress("");
    setItemName("");
    setPrincipalAmount("");
    setDownPayment("0");
    setTotalMonths("6");
    setDueDay("5");
    setPanPhoto("");
    setAadhaarFrontPhoto("");
    setAadhaarBackPhoto("");
    setSelfiePhoto("");
    clearSignature();
  };

  // Mark Paid (+1M) - Cash / Call-confirm flow
  const handleMarkPaidOneMonth = (customerId: string) => {
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== customerId) return c;
        const { monthlyEmi, remainingBalance, isSettled } = calculateRemaining(c);
        if (isSettled) return c;

        const paidNow = Math.min(monthlyEmi, remainingBalance);
        setTodayCollection((t) => t + paidNow);

        const nextPaidMonths = Math.min(c.totalMonths, c.paidMonths + 1);
        const updated: CustomerRecord = {
          ...c,
          paidMonths: nextPaidMonths,
          callsAttemptedThisCycle: 0,
          lastCallDate: undefined,
        };
        const afterCalc = calculateRemaining(updated);
        if (afterCalc.isSettled) {
          updated.voiceActive = false;
        }
        return updated;
      })
    );
  };

  // Partial Jama + Receipt
  const handlePartialJama = (customerId: string) => {
    const raw = partialInputs[customerId];
    const amt = Number(raw);
    if (!amt || amt <= 0) {
      alert("Sahi Jama amount daalein.");
      return;
    }

    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== customerId) return c;
        const { remainingBalance } = calculateRemaining(c);
        const applied = Math.min(amt, remainingBalance);
        setTodayCollection((t) => t + applied);

        const updated: CustomerRecord = {
          ...c,
          customPaidAmount: c.customPaidAmount + applied,
        };
        if (calculateRemaining(updated).isSettled) {
          updated.voiceActive = false;
        }
        return updated;
      })
    );

    setPartialInputs((prev) => ({ ...prev, [customerId]: "" }));
  };

  // Trigger AI Voice Call (20-30s script + Per-Second Billing + Browser Speech Preview + API Hook)
  const triggerAiVoiceCall = async (c: CustomerRecord, simulatedSeconds = 24) => {
    const { isSettled } = calculateRemaining(c);
    if (isSettled) {
      alert("Is customer ka poora hisaab clear ho chuka hai!");
      return;
    }

    if (c.callsAttemptedThisCycle >= c.retryCountTarget) {
      alert(
        `Is cycle ke maximum ${c.retryCountTarget} retry calls poore ho chuke hain.`
      );
      return;
    }

    const script = buildHindiVoiceScript(shopName, c);
    const clampedSeconds = Math.min(30, Math.max(5, simulatedSeconds));
    const billedAmountINR = Number(
      ((clampedSeconds / 60) * RATE_PER_MINUTE_INR).toFixed(2)
    );
    const attemptNo = c.callsAttemptedThisCycle + 1;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(script);
      utterance.lang = "hi-IN";
      utterance.rate = 1.02;
      window.speechSynthesis.speak(utterance);
    }

    try {
      await fetch("/api/voice-reminder/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: c.id,
          customerName: c.name,
          mobile: c.mobile,
          script,
          maxDurationSeconds: 30,
          billingMode: "PER_SECOND",
          ratePerMinuteINR: RATE_PER_MINUTE_INR,
          attemptNumber: attemptNo,
          retryCountTarget: c.retryCountTarget,
          penaltyAmountINR: PENALTY_AMOUNT,
        }),
      });
    } catch {
      // Fallback gracefully in local/preview mode
    }

    setCustomers((prev) =>
      prev.map((item) =>
        item.id === c.id
          ? {
              ...item,
              callsAttemptedThisCycle: attemptNo,
              lastCallDate: "22/11/2026",
            }
          : item
      )
    );

    const newLog: ReminderLog = {
      id: `LOG-${Date.now()}`,
      customerId: c.id,
      customerName: c.name,
      channel: "AI_VOICE_CALL",
      attemptNumber: attemptNo,
      durationSeconds: clampedSeconds,
      billedAmountINR,
      status: clampedSeconds < 22 ? "CUT_EARLY" : "COMPLETED",
      timestamp: "22/11/2026",
      scriptPreview: script,
    };

    setLogs((prev) => [newLog, ...prev]);
  };

  // Trigger WhatsApp Reminder (without payment QR code)
  const triggerWhatsAppReminder = (c: CustomerRecord) => {
    const text = buildWhatsAppReminderText(shopName, c);
    const phone = c.mobile.startsWith("91") ? c.mobile : `91${c.mobile}`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

    const newLog: ReminderLog = {
      id: `WA-${Date.now()}`,
      customerId: c.id,
      customerName: c.name,
      channel: "WHATSAPP",
      attemptNumber: c.callsAttemptedThisCycle + 1,
      durationSeconds: 0,
      billedAmountINR: 0,
      status: "COMPLETED",
      timestamp: "22/11/2026",
      scriptPreview: text,
    };
    setLogs((prev) => [newLog, ...prev]);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Download / Print Signed Loan Agreement PDF
  const handleDownloadSignedAgreementPdf = (c: CustomerRecord) => {
    const { loanAmount, monthlyEmi, remainingBalance } = calculateRemaining(c);
    const printWindow = window.open("", "_blank", "width=900,height=1100");
    if (!printWindow) {
      alert("Popup blocked! Kripya browser mein popups allow karein taaki PDF download/print ho sake.");
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Loan Agreement - ${c.name}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; padding: 24px; line-height: 1.5; }
          .header { text-align: center; border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 18px; }
          .header h1 { margin: 0; font-size: 22px; text-transform: uppercase; }
          .header p { margin: 4px 0 0; font-size: 13px; color: #374151; }
          .section-title { background: #f3f4f6; padding: 6px 10px; font-weight: bold; border-left: 4px solid #111827; margin: 16px 0 10px; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
          td, th { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
          .kyc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
          .kyc-box { border: 1px solid #9ca3af; padding: 8px; text-align: center; border-radius: 6px; }
          .kyc-box img { max-width: 100%; max-height: 160px; object-fit: contain; display: block; margin: 6px auto 0; }
          .terms { font-size: 12px; background: #fffbeb; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; }
          .terms li { margin-bottom: 6px; }
          .sig-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 24px; border-top: 1px dashed #9ca3af; padding-top: 16px; }
          .sig-box { width: 45%; text-align: center; }
          .sig-box img { max-height: 80px; border: 1px solid #d1d5db; padding: 4px; background: #fff; }
          @media print {
            body { padding: 10px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${shopName} — Digital Loan / EMI Agreement</h1>
          <p>${shopAddress} | Contact: ${shopPhone} | Agreement ID: ${c.id} | Date: ${c.createdAt}</p>
        </div>

        <div class="section-title">1. Customer & Loan Details</div>
        <table>
          <tr>
            <th>Customer Name</th><td>${c.name}</td>
            <th>Mobile Number</th><td>${c.mobile}</td>
          </tr>
          <tr>
            <th>Address</th><td colspan="3">${c.address}</td>
          </tr>
          <tr>
            <th>Item / Product</th><td>${c.itemName}</td>
            <th>Total Price</th><td>₹${c.principalAmount}</td>
          </tr>
          <tr>
            <th>Down Payment</th><td>₹${c.downPayment}</td>
            <th>Financed Loan Amount</th><td>₹${loanAmount}</td>
          </tr>
          <tr>
            <th>Total Tenure</th><td>${c.totalMonths} Months</td>
            <th>Monthly EMI</th><td>₹${monthlyEmi} (Due every ${c.dueDay}th)</td>
          </tr>
          <tr>
            <th>Current Remaining</th><td colspan="3"><strong>₹${remainingBalance}</strong></td>
          </tr>
        </table>

        <div class="section-title">2. Verified KYC Documents (PAN, Aadhaar Front & Back, Live Selfie)</div>
        <div class="kyc-grid">
          <div class="kyc-box">
            <strong>PAN Card Photo</strong>
            <img src="${c.panPhoto}" alt="PAN Card" />
          </div>
          <div class="kyc-box">
            <strong>Customer Live Selfie</strong>
            <img src="${c.selfiePhoto}" alt="Customer Selfie" />
          </div>
          <div class="kyc-box">
            <strong>Aadhaar Card (Front)</strong>
            <img src="${c.aadhaarFrontPhoto}" alt="Aadhaar Front" />
          </div>
          <div class="kyc-box">
            <strong>Aadhaar Card (Back)</strong>
            <img src="${c.aadhaarBackPhoto}" alt="Aadhaar Back" />
          </div>
        </div>

        <div class="section-title">3. Loan Terms & Conditions</div>
        <div class="terms">
          <ol>
            <li>Customer ne apni marzi se <strong>${shopName}</strong> se <strong>${c.itemName}</strong> kharida hai aur har mahine ki <strong>${c.dueDay} tarikh</strong> tak <strong>₹${monthlyEmi}</strong> ki kist jama karne ka wada kiya hai.</li>
            <li><strong>Late Payment Penalty:</strong> Agar customer samay par (due date tak) apni monthly kist jama nahi karta hai, to us par <strong>₹${PENALTY_AMOUNT} (Three Hundred Sixty-Five Rupees)</strong> late penalty lagu hogi.</li>
            <li>Due date ke aas-paas aur kist pending rehne par customer ke registered mobile number par automated AI Voice Call (5 se 8 reminder calls) aur WhatsApp reminder bheje ja sakte hain.</li>
            <li>Poori rakam jama hone tak samaan par dukaan ka malikana haq/lien surakshit rahega.</li>
            <li>Upar diye gaye sabhi KYC dastawez (PAN, Aadhaar Front & Back, Selfie) aur digital hastakshar customer ki sahmati se liye gaye hain.</li>
          </ol>
        </div>

        <div class="sig-row">
          <div class="sig-box">
            <img src="${c.signatureDataUrl}" alt="Customer Signature" />
            <p><strong>Customer Digital Signature</strong><br/>(${c.name})</p>
          </div>
          <div class="sig-box">
            <div style="height: 80px; display:flex; align-items:center; justify-content:center; border:1px solid #d1d5db;">
              <strong>Authorized Signatory — ${shopName}</strong>
            </div>
            <p><strong>Dukandar Stamp / Signature</strong></p>
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const filteredCustomers = useMemo(() => {
    const todayDate = CURRENT_DAY_OF_MONTH;

    return customers.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.mobile.includes(searchQuery) ||
        c.itemName.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (onlyDueFilter) {
        const { isSettled } = calculateRemaining(c);
        return !isSettled && todayDate >= c.dueDay - 2;
      }
      return true;
    });
  }, [customers, searchQuery, onlyDueFilter]);

  const stats = useMemo(() => {
    let totalUdhaar = 0;
    let totalCollected = 0;
    let totalVoiceSeconds = 0;
    let totalVoiceBilled = 0;

    customers.forEach((c) => {
      const calc = calculateRemaining(c);
      totalUdhaar += calc.remainingBalance;
      totalCollected += calc.totalPaid + c.downPayment;
    });

    logs.forEach((l) => {
      if (l.channel === "AI_VOICE_CALL") {
        totalVoiceSeconds += l.durationSeconds;
        totalVoiceBilled += l.billedAmountINR;
      }
    });

    return {
      totalUdhaar,
      totalCollected,
      totalVoiceSeconds,
      totalVoiceBilled: Number(totalVoiceBilled.toFixed(2)),
    };
  }, [customers, logs]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Shop Header */}
        <header className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-emerald-400">
              {shopName} — Smart EMI, KYC & AI Voice Reminder Suite
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              KYC + Signed PDF Agreement • 20–30s Hindi AI Voice (₹2/min Per-Second Billing) • ₹{PENALTY_AMOUNT} Late Penalty Alert • 1-Click Mark Paid (+1M) • Date: 22 Nov 2026
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Shop Name"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={shopPhone}
              onChange={(e) => setShopPhone(e.target.value)}
              placeholder="Shop Phone"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={shopAddress}
              onChange={(e) => setShopAddress(e.target.value)}
              placeholder="Shop Address"
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </header>

        {/* Summary Metrics */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400">Bacha Hua Udhaar</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">
              {formatINR(stats.totalUdhaar)}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400">Kul Jama Vasooli</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              {formatINR(stats.totalCollected)}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400">Aaj Ki Vasooli (Cash / Call)</p>
            <p className="text-2xl font-bold text-cyan-400 mt-1">
              {formatINR(todayCollection)}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400">
              AI Voice Usage (@ ₹{RATE_PER_MINUTE_INR}/min Per-Sec)
            </p>
            <p className="text-2xl font-bold text-purple-400 mt-1">
              {stats.totalVoiceSeconds}s ({formatINR(stats.totalVoiceBilled)})
            </p>
          </div>
        </section>

        {/* New Customer + Full KYC + Digital Signature Form */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            1. Naya Customer + Full KYC (PAN, Aadhaar Front & Back, Selfie, Digital Signature)
          </h2>

          <form onSubmit={handleAddCustomer} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder="Customer Naam *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                required
              />
              <input
                type="tel"
                placeholder="Mobile Number (10 digits) *"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                required
              />
              <input
                type="text"
                placeholder="Item / Mobile / Product *"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                required
              />
              <input
                type="text"
                placeholder="Customer Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Total Price (₹) *</label>
                <input
                  type="number"
                  value={principalAmount}
                  onChange={(e) => setPrincipalAmount(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Down Payment (₹)</label>
                <input
                  type="number"
                  value={downPayment}
                  onChange={(e) => setDownPayment(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Total Months</label>
                <input
                  type="number"
                  min={1}
                  max={36}
                  value={totalMonths}
                  onChange={(e) => setTotalMonths(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">EMI Due Day (1-28)</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Calls Per Cycle (5–8)
                </label>
                <select
                  value={retryCountTarget}
                  onChange={(e) => setRetryCountTarget(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
                >
                  <option value={5}>5 Calls / Cycle</option>
                  <option value={6}>6 Calls / Cycle</option>
                  <option value={7}>7 Calls / Cycle</option>
                  <option value={8}>8 Calls / Cycle</option>
                </select>
              </div>
            </div>

            {/* 4 KYC Uploads: PAN, Aadhaar Front (Camera/Gallery), Aadhaar Back (Camera/Gallery), Selfie */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* PAN Card */}
              <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium text-emerald-300">1. PAN Card Photo *</p>
                <div className="flex gap-2">
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    📷 Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handleImageUpload(e, setPanPhoto)}
                      className="hidden"
                    />
                  </label>
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    🖼️ Gallery
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, setPanPhoto)}
                      className="hidden"
                    />
                  </label>
                </div>
                {panPhoto && (
                  <img
                    src={panPhoto}
                    alt="PAN Preview"
                    className="h-24 w-full object-cover rounded-lg border border-slate-600"
                  />
                )}
              </div>

              {/* Aadhaar Front */}
              <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium text-emerald-300">2. Aadhaar Front Photo *</p>
                <div className="flex gap-2">
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    📷 Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handleImageUpload(e, setAadhaarFrontPhoto)}
                      className="hidden"
                    />
                  </label>
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    🖼️ Gallery
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, setAadhaarFrontPhoto)}
                      className="hidden"
                    />
                  </label>
                </div>
                {aadhaarFrontPhoto && (
                  <img
                    src={aadhaarFrontPhoto}
                    alt="Aadhaar Front Preview"
                    className="h-24 w-full object-cover rounded-lg border border-slate-600"
                  />
                )}
              </div>

              {/* Aadhaar Back */}
              <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium text-emerald-300">3. Aadhaar Back Photo *</p>
                <div className="flex gap-2">
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    📷 Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handleImageUpload(e, setAadhaarBackPhoto)}
                      className="hidden"
                    />
                  </label>
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    🖼️ Gallery
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, setAadhaarBackPhoto)}
                      className="hidden"
                    />
                  </label>
                </div>
                {aadhaarBackPhoto && (
                  <img
                    src={aadhaarBackPhoto}
                    alt="Aadhaar Back Preview"
                    className="h-24 w-full object-cover rounded-lg border border-slate-600"
                  />
                )}
              </div>

              {/* Customer Selfie */}
              <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium text-emerald-300">4. Customer Selfie *</p>
                <div className="flex gap-2">
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    🤳 Front Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      onChange={(e) => handleImageUpload(e, setSelfiePhoto)}
                      className="hidden"
                    />
                  </label>
                  <label className="flex-1 text-center bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded-lg cursor-pointer">
                    🖼️ Gallery
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, setSelfiePhoto)}
                      className="hidden"
                    />
                  </label>
                </div>
                {selfiePhoto && (
                  <img
                    src={selfiePhoto}
                    alt="Selfie Preview"
                    className="h-24 w-full object-cover rounded-lg border border-slate-600"
                  />
                )}
              </div>
            </div>

            {/* Digital Signature Pad */}
            <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-emerald-300">
                  5. Customer Digital Signature (Screen Par Sign Karein) *
                </p>
                <button
                  type="button"
                  onClick={clearSignature}
                  className="text-xs bg-rose-600/20 text-rose-300 border border-rose-500/40 px-3 py-1 rounded-lg hover:bg-rose-600/30"
                >
                  Clear Signature
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={650}
                height={150}
                onMouseDown={startSignature}
                onMouseMove={drawSignature}
                onMouseUp={endSignature}
                onMouseLeave={endSignature}
                onTouchStart={startSignature}
                onTouchMove={drawSignature}
                onTouchEnd={endSignature}
                className="w-full h-36 bg-white rounded-lg border-2 border-dashed border-slate-500 touch-none cursor-crosshair"
              />
            </div>

            <button
              type="submit"
              className="w-full md:w-auto bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-3 rounded-xl transition"
            >
              + Save Customer & Generate Signed Agreement Ready
            </button>
          </form>
        </section>

        {/* Customer Ledger + 1-Click Mark Paid (+1M) + AI Call + WhatsApp + PDF */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">
              2. Customer EMI Ledger, Cash Update (+1M) & Reminders
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search naam, mobile, item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => setOnlyDueFilter((v) => !v)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border ${
                  onlyDueFilter
                    ? "bg-amber-500 text-slate-950 border-amber-400"
                    : "bg-slate-800 text-slate-300 border-slate-700"
                }`}
              >
                {onlyDueFilter ? "Showing Due Only" : "Filter: Due Only"}
              </button>
            </div>
          </div>

          {filteredCustomers.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              Abhi koi customer record nahi hai. Upar form se naya customer + KYC add karein.
            </p>
          ) : (
            <div className="space-y-4">
              {filteredCustomers.map((c) => {
                const calc = calculateRemaining(c);
                return (
                  <div
                    key={c.id}
                    className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-white">{c.name}</h3>
                          <span className="text-xs bg-slate-700 px-2 py-0.5 rounded">
                            {c.mobile}
                          </span>
                          <span className="text-xs bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded">
                            {c.itemName}
                          </span>
                          {calc.isSettled ? (
                            <span className="text-xs bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded">
                              SETTLED (Calls Stopped)
                            </span>
                          ) : (
                            <span className="text-xs bg-amber-950 text-amber-300 border border-amber-700 px-2 py-0.5 rounded">
                              Due: {c.dueDay}th | Penalty: ₹{PENALTY_AMOUNT}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          Monthly EMI: <strong className="text-slate-200">{formatINR(calc.monthlyEmi)}</strong> •{" "}
                          Paid Months: <strong className="text-emerald-300">{c.paidMonths}/{c.totalMonths}</strong> •{" "}
                          Bacha Udhaar: <strong className="text-amber-300">{formatINR(calc.remainingBalance)}</strong> •{" "}
                          Calls This Cycle: <strong className="text-purple-300">{c.callsAttemptedThisCycle}/{c.retryCountTarget}</strong>
                        </p>
                      </div>

                      {/* Primary Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 1-Click Mark Paid (+1M) */}
                        <button
                          type="button"
                          disabled={calc.isSettled}
                          onClick={() => handleMarkPaidOneMonth(c.id)}
                          className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-semibold text-xs px-3 py-2 rounded-lg"
                        >
                          ✅ Mark Paid (+1M)
                        </button>

                        {/* Partial Jama */}
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            placeholder="₹ Jama"
                            value={partialInputs[c.id] || ""}
                            onChange={(e) =>
                              setPartialInputs((prev) => ({
                                ...prev,
                                [c.id]: e.target.value,
                              }))
                            }
                            className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            disabled={calc.isSettled}
                            onClick={() => handlePartialJama(c.id)}
                            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs px-2.5 py-2 rounded-lg"
                          >
                            Jama
                          </button>
                        </div>

                        {/* AI Voice Call (25s full or 18s early cut test) */}
                        <button
                          type="button"
                          disabled={calc.isSettled}
                          onClick={() => triggerAiVoiceCall(c, 25)}
                          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs px-3 py-2 rounded-lg"
                        >
                          📞 AI Call (25s)
                        </button>

                        <button
                          type="button"
                          disabled={calc.isSettled}
                          onClick={() => triggerAiVoiceCall(c, 18)}
                          title="Agar customer 18 sec mein call kaat de to sirf 18 sec ka charge lagega"
                          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs px-3 py-2 rounded-lg"
                        >
                          ✂️ Cut @18s Test
                        </button>

                        {/* WhatsApp Reminder (No QR) */}
                        <button
                          type="button"
                          disabled={calc.isSettled}
                          onClick={() => triggerWhatsAppReminder(c)}
                          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-xs px-3 py-2 rounded-lg"
                        >
                          💬 WhatsApp Alert
                        </button>

                        {/* Agreement Preview + PDF Download */}
                        <button
                          type="button"
                          onClick={() => setSelectedAgreementCustomer(c)}
                          className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-3 py-2 rounded-lg"
                        >
                          👁️ View KYC
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadSignedAgreementPdf(c)}
                          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs px-3 py-2 rounded-lg"
                        >
                          📄 Download Agreement PDF
                        </button>
                      </div>
                    </div>

                    {/* Voice Script Preview */}
                    <div className="text-xs bg-slate-900/90 border border-slate-700/80 rounded-lg p-2.5 text-slate-300">
                      <span className="text-purple-300 font-semibold">AI Voice Script (20–30s): </span>
                      {buildHindiVoiceScript(shopName, c)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Per-Second Voice Billing & Reminder Logs */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-lg font-semibold text-white">
            3. AI Voice Call & WhatsApp Log (Actual Seconds Billing @ ₹{RATE_PER_MINUTE_INR}/min)
          </h2>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-400">
              Abhi koi call ya message log nahi hai. Upar kisi customer par AI Call ya WhatsApp Alert dabayein.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Channel</th>
                    <th className="py-2 pr-3">Attempt</th>
                    <th className="py-2 pr-3">Duration</th>
                    <th className="py-2 pr-3">Charge (₹2/min)</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b border-slate-800/60">
                      <td className="py-2 pr-3 text-slate-400">{l.timestamp}</td>
                      <td className="py-2 pr-3 font-medium">{l.customerName}</td>
                      <td className="py-2 pr-3">{l.channel}</td>
                      <td className="py-2 pr-3">#{l.attemptNumber}</td>
                      <td className="py-2 pr-3">
                        {l.channel === "AI_VOICE_CALL" ? `${l.durationSeconds} sec` : "-"}
                      </td>
                      <td className="py-2 pr-3 text-emerald-300">
                        {l.channel === "AI_VOICE_CALL" ? formatINR(l.billedAmountINR) : "₹0.00"}
                      </td>
                      <td className="py-2">{l.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* KYC & Agreement Quick Modal */}
        {selectedAgreementCustomer && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">
                  KYC & Signature — {selectedAgreementCustomer.name}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedAgreementCustomer(null)}
                  className="bg-slate-800 px-3 py-1 rounded-lg text-sm"
                >
                  ✕ Close
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-800 p-2 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">PAN Card</p>
                  <img
                    src={selectedAgreementCustomer.panPhoto}
                    alt="PAN"
                    className="w-full h-40 object-contain bg-black rounded"
                  />
                </div>
                <div className="bg-slate-800 p-2 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">Customer Selfie</p>
                  <img
                    src={selectedAgreementCustomer.selfiePhoto}
                    alt="Selfie"
                    className="w-full h-40 object-contain bg-black rounded"
                  />
                </div>
                <div className="bg-slate-800 p-2 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">Aadhaar Front</p>
                  <img
                    src={selectedAgreementCustomer.aadhaarFrontPhoto}
                    alt="Aadhaar Front"
                    className="w-full h-40 object-contain bg-black rounded"
                  />
                </div>
                <div className="bg-slate-800 p-2 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">Aadhaar Back</p>
                  <img
                    src={selectedAgreementCustomer.aadhaarBackPhoto}
                    alt="Aadhaar Back"
                    className="w-full h-40 object-contain bg-black rounded"
                  />
                </div>
              </div>

              <div className="bg-slate-800 p-3 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">Digital Signature</p>
                <img
                  src={selectedAgreementCustomer.signatureDataUrl}
                  alt="Signature"
                  className="h-24 bg-white p-2 rounded"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadSignedAgreementPdf(selectedAgreementCustomer)}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm"
                >
                  📄 Download / Print Signed Agreement PDF
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
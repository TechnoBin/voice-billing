"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { parseCSV } from "@/lib/csv";
import { normalizeText, parseQuantity } from "@/lib/voice";
import type { Bill, CartItem, Product } from "@/lib/types";

const starter: Product[] = [
  { id: "p1", name: "Dairy Milk", price: 10, aliases: ["dairy milk", "silk", "deyri", "dairymilk"], category: "Chocolate" },
  { id: "p2", name: "KitKat", price: 10, aliases: ["kit kat", "kitkat"], category: "Chocolate" },
  { id: "p3", name: "Bourbon", price: 10, aliases: ["bourbon biscuit", "burbon"], category: "Biscuit" },
  { id: "p4", name: "Oreo", price: 5, aliases: ["oreo biscuit", "oriyo", "orio"], category: "Biscuit" },
  { id: "p5", name: "Parle-G", price: 5, aliases: ["parle g", "parle ji", "parleg"], category: "Biscuit" },
  { id: "p6", name: "Milk", price: 30, aliases: ["packet milk", "doodh", "dudh"], category: "Dairy" },
];

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Web Audio API Chimes (Pure output tones — does not grab the hardware mic)
function playSoundCue(type: "success" | "error" | "action") {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === "success") {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start(ctx.currentTime + 0.08);
      osc1.stop(ctx.currentTime + 0.25);
      osc2.stop(ctx.currentTime + 0.25);
    } else if (type === "error") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === "action") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch {
    // Ignore audio context lock
  }
}

export default function BillingApp() {
  const [products, setProducts] = useState<Product[]>(starter);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [history, setHistory] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  const [message, setMessage] = useState("Demo mode is ready. Add Supabase settings to sync across devices.");
  const [cloud, setCloud] = useState(false);
  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState("0");
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastProcessedTranscript = useRef<string>("");
  const isSpeakingAssistant = useRef<boolean>(false);
  const lastAddedItem = useRef<{ id: string; name: string; timestamp: number; wasDefaultQty: boolean } | null>(null);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.product.price * i.quantity, 0), [cart]);
  const discountValue = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const total = Math.max(0, subtotal - discountValue);

  // Safe Text-to-Speech that pauses recognition on Android to prevent mic conflicts
  function speakAssistant(text: string, onComplete?: () => void) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-IN";
      utterance.rate = 1.0;

      utterance.onstart = () => {
        isSpeakingAssistant.current = true;
        if (recognition.current) {
          try { recognition.current.stop(); } catch {}
        }
      };

      utterance.onend = () => {
        isSpeakingAssistant.current = false;
        if (onComplete) onComplete();
        // Automatically resume listening after TTS prompt finishes
        if (listeningRef.current && recognition.current) {
          try {
            recognition.current.start();
          } catch {}
        }
      };

      utterance.onerror = () => {
        isSpeakingAssistant.current = false;
        if (listeningRef.current && recognition.current) {
          try {
            recognition.current.start();
          } catch {}
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      isSpeakingAssistant.current = false;
    }
  }
}


  useEffect(() => {
    try {
      const p = localStorage.getItem("kirana_products_v1");
      if (p) setProducts(JSON.parse(p));
      const h = localStorage.getItem("kirana_history_v1");
      if (h) setHistory(JSON.parse(h));
      const c = localStorage.getItem("kirana_customer_v1");
      if (c) setCustomer(c);
    } catch {}

    const sb = getSupabase();
    setCloud(!!sb);
    if (sb) {
      sb.from("products")
        .select("id,name,price,aliases,category")
        .order("name")
        .then(({ data, error }) => {
          if (data?.length) {
            setProducts(data.map((p: any) => ({ ...p, price: Number(p.price), aliases: p.aliases ?? [] })));
            setMessage("Connected to your cloud product catalogue.");
          } else if (error) {
            setMessage("Cloud connection needs setup. Demo data is available locally.");
          }
        });

      sb.from("bills")
        .select("id,created_at,total,bill_items(name_snapshot,unit_price,quantity)")
        .order("created_at", { ascending: false })
        .limit(20)
        .then(({ data, error }) => {
          if (data?.length) {
            setHistory(
              data.map((b: any) => ({
                id: b.id,
                createdAt: b.created_at,
                total: Number(b.total),
                status: "saved",
                items: (b.bill_items ?? []).map((i: any) => ({
                  name: i.name_snapshot,
                  price: Number(i.unit_price),
                  quantity: Number(i.quantity),
                })),
              }))
            );
          } else if (error) {
            setMessage("Cloud history could not load. Check Supabase tables and policies.");
          }
        });
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("kirana_products_v1", JSON.stringify(products)); } catch {}
  }, [products]);

  useEffect(() => {
    try { localStorage.setItem("kirana_history_v1", JSON.stringify(history)); } catch {}
  }, [history]);

  useEffect(() => {
    try { localStorage.setItem("kirana_customer_v1", customer); } catch {}
  }, [customer]);

  function findProduct(name: string) {
    const n = normalizeText(name);
    return products.find(p => normalizeText(p.name) === n || p.aliases.some(a => normalizeText(a) === n));
  }

  // Fixes "Oreo 5" becoming 6 by overriding quantity if item was added seconds ago
  function smartAddToCart(product: Product, quantity = 1, explicitQuantityProvided = false) {
    const now = Date.now();
    const isRecentItem =
      lastAddedItem.current &&
      lastAddedItem.current.id === product.id &&
      now - lastAddedItem.current.timestamp < 4000;

    setCart(prev => {
      const existingIdx = prev.findIndex(i => i.product.id === product.id);

      if (existingIdx > -1) {
        if (isRecentItem && lastAddedItem.current?.wasDefaultQty && explicitQuantityProvided) {
          return prev.map((item, idx) => (idx === existingIdx ? { ...item, quantity } : item));
        }
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: explicitQuantityProvided ? quantity : item.quantity + quantity } : item
        );
      }

      return [...prev, { product, quantity }];
    });

    lastAddedItem.current = {
      id: product.id,
      name: product.name,
      timestamp: now,
      wasDefaultQty: !explicitQuantityProvided && quantity === 1,
    };
  }

  function cleanSpokenInput(text: string): string {
    const numberWords: Record<string, string> = {
      one: "1", two: "2", three: "3", four: "4", five: "5",
      six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
      half: "0.5", ek: "1", do: "2", teen: "3", chaar: "4", char: "4",
      paanch: "5", panch: "5", chhah: "6", che: "6", saat: "7",
      aath: "8", nau: "9", das: "10", aadha: "0.5"
    };

    let cleaned = text.toLowerCase();
    cleaned = cleaned.replace(/\b(packets?|pkts?|pieces?|pcs?|kg|kilo|grams?|gm|liters?|ltr|boxes?)\b/gi, "").trim();

    return cleaned
      .split(/\s+/)
      .map(word => numberWords[word] || word)
      .join(" ");
  }

  function toRoman(str: string): string {
    const devanagariMap: Record<string, string> = {
      "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
      "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऋ": "ri",
      "\u093E": "a", "\u093F": "i", "\u0940": "i", "\u0941": "u", "\u0942": "u",
      "\u0947": "e", "\u0948": "ai", "\u094B": "o", "\u094C": "au",
      "\u0901": "n", "\u0902": "n", "\u0903": "h", "\u094D": "", "\u093C": "",
      "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
      "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "nya",
      "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
      "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
      "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m",
      "य": "y", "र": "r", "ल": "l", "व": "v",
      "श": "sh", "ष": "sh", "स": "s", "ह": "h",
      "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
      "५": "5", "६": "6", "७": "7", "८": "8", "९": "9"
    };

    return str
      .split("")
      .map(c => devanagariMap[c] || c)
      .join("");
  }

  function processVoiceStream(rawTranscript: string) {
    if (!rawTranscript || rawTranscript === lastProcessedTranscript.current || isSpeakingAssistant.current) return;
    lastProcessedTranscript.current = rawTranscript;

    const clean = rawTranscript.toLowerCase().trim();

    // Command: Finalize
    if (/finalize\s*bill|final\s*bill|finish\s*bill|complete\s*bill/i.test(clean)) {
      if (recognition.current) recognition.current.stop();
      setListening(false);
      playSoundCue("action");
      speakAssistant("Should I finalize the bill now?");
      setShowFinalizeModal(true);
      setMessage("Voice assistant paused. Review and confirm to finalize bill.");
      return;
    }

    // Command: Undo
    if (/undo|cancel\s*that|remove\s*last|take\s*back/i.test(clean)) {
      if (lastAddedItem.current) {
        const itemToRemove = lastAddedItem.current;
        setCart(prev => prev.filter(i => i.product.id !== itemToRemove.id));
        playSoundCue("action");
        speakAssistant(`Undid ${itemToRemove.name}`);
        setMessage(`Undid last added item: ${itemToRemove.name}`);
        lastAddedItem.current = null;
      }
      return;
    }

    // Command: Clear
    if (/clear\s*bill|clear\s*all|reset\s*bill|empty\s*cart/i.test(clean)) {
      setCart([]);
      setDiscount("0");
      playSoundCue("action");
      speakAssistant("Bill cleared.");
      setMessage("Bill cleared via voice command.");
      return;
    }

    // Command: Change Qty
    const changeQtyMatch = clean.match(/(?:change|make|set)(?:\s+it|\s+qty|\s+quantity)?\s+(?:to\s+)?(\d+)/i);
    if (changeQtyMatch && changeQtyMatch[1] && lastAddedItem.current) {
      const newQty = parseInt(changeQtyMatch[1], 10);
      if (newQty > 0) {
        const targetId = lastAddedItem.current.id;
        setCart(prev => prev.map(i => (i.product.id === targetId ? { ...i, quantity: newQty } : i)));
        playSoundCue("success");
        speakAssistant(`Updated quantity to ${newQty}`);
        setMessage(`Updated ${lastAddedItem.current.name} quantity to ${newQty}`);
      }
      return;
    }

    // Command: Remove Product
    const removeMatch = clean.match(/(?:remove|delete|drop)\s+([a-z0-9\s]+)/i);
    if (removeMatch && removeMatch[1]) {
      const targetName = removeMatch[1].trim();
      const productToRemove = findProduct(targetName);
      if (productToRemove) {
        setCart(prev => prev.filter(item => item.product.id !== productToRemove.id));
        playSoundCue("action");
        speakAssistant(`Removed ${productToRemove.name}`);
        setMessage(`Removed ${productToRemove.name} from bill.`);
      }
      return;
    }

    // Multi-Item Extraction
    let itemText = clean.replace(/ok\s*add\s*product|add\s*products?|add\s*items?/gi, "").trim();
    const pairRegex = /([a-z\s\-]+?)\s+(\d+(?:\.\d+)?)(?=\s+[a-z]|$)/gi;
    let match: RegExpExecArray | null;
    const itemsAdded: string[] = [];

    while ((match = pairRegex.exec(itemText)) !== null) {
      const rawName = match[1].replace(/^(and|then|also)\s+/i, "").trim();
      const qty = parseFloat(match[2]);

      if (rawName && qty > 0) {
        const product = findProduct(rawName);
        if (product) {
          smartAddToCart(product, qty, true);
          itemsAdded.push(`${qty} × ${product.name}`);
        }
      }
    }

    if (itemsAdded.length > 0) {
      playSoundCue("success");
      const feedbackMsg = `Added ${itemsAdded.join(", ")}`;
      setMessage(feedbackMsg);
      speakAssistant(feedbackMsg);
    } else {
      const { name, quantity } = parseQuantity(clean);
      if (name) {
        const product = findProduct(name);
        if (product) {
          smartAddToCart(product, quantity, false);
          playSoundCue("success");
          setMessage(`Added ${quantity} × ${product.name}`);
        } else {
          playSoundCue("error");
          setMessage(`Could not find "${name}". Add it to catalogue or say exact name.`);
        }
      }
    }
  }

  function startVoice() {
  const Ctor = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!Ctor) {
    setMessage("Voice input is not supported by this browser. Try Chrome on Android.");
    return;
  }

  // Toggle OFF if already active
  if (listeningRef.current) {
    listeningRef.current = false;
    setListening(false);
    if (recognition.current) {
      try { recognition.current.stop(); } catch {}
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    playSoundCue("action");
    setMessage("Microphone stopped.");
    return;
  }

  // Toggle ON
  listeningRef.current = true;
  setListening(true);

  const rec = new Ctor();
  rec.lang = "en-IN";
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (event: any) => {
    if (isSpeakingAssistant.current) return;

    let finalText = "", interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += phrase;
      else interim += phrase;
    }

    const processedFinal = toRoman(finalText);
    const processedInterim = toRoman(interim);
    const currentSpeech = processedFinal || processedInterim;

    setVoiceText(currentSpeech);

    if (processedFinal) {
      const cleanedText = cleanSpokenInput(processedFinal);
      processVoiceStream(cleanedText);
    }
  };

  rec.onerror = (e: any) => {
    setMessage(`Voice input issue: ${e.error || "please try again"}.`);
    listeningRef.current = false;
    setListening(false);
  };

  rec.onend = () => {
    // If assistant is currently speaking, wait for utterance.onend to restart
    if (isSpeakingAssistant.current) return;

    if (listeningRef.current) {
      try {
        rec.start();
      } catch {
        listeningRef.current = false;
        setListening(false);
      }
    } else {
      setListening(false);
    }
  };

  recognition.current = rec;

  try {
    rec.start();
    playSoundCue("action");
    speakAssistant("Voice assistant active.");
    setMessage("Listening continuously... Say 'Dairy Milk 5', 'Undo', or 'Finalize bill'.");
  } catch {
    listeningRef.current = false;
    setListening(false);
    setMessage("Could not start microphone. Check browser permissions.");
  }
}


  async function saveBill() {
    if (!cart.length) {
      setMessage("Add at least one product before saving the bill.");
      return;
    }
    setBusy(true);
    const bill: Bill = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      items: cart.map(i => ({ name: i.product.name, price: i.product.price, quantity: i.quantity })),
      total,
      status: "saved",
    };
    const sb = getSupabase();
    if (sb) {
      const { data: billRow, error } = await sb
        .from("bills")
        .insert({ customer_name: customer.trim() || null, subtotal, discount: discountValue, total, status: "saved" })
        .select("id,created_at")
        .single();

      if (error || !billRow) {
        setMessage(`Cloud save failed: ${error?.message || "unknown error"}. Retry after checking connection.`);
        setBusy(false);
        return;
      }

      const rows = cart.map(i => ({
        bill_id: billRow.id,
        product_id: i.product.id,
        name_snapshot: i.product.name,
        unit_price: i.product.price,
        quantity: i.quantity,
        line_total: i.product.price * i.quantity,
      }));

      const { error: itemError } = await sb.from("bill_items").insert(rows);
      if (itemError) {
        setMessage(`Bill created but item save failed. Repair bill ${billRow.id}.`);
        setBusy(false);
        return;
      }
      bill.id = billRow.id;
      bill.createdAt = billRow.created_at;
    }

    setHistory(prev => [bill, ...prev]);
    setCart([]);
    setDiscount("0");
    setShowFinalizeModal(false);
    playSoundCue("success");
    speakAssistant("Bill finalized and saved successfully.");
    setMessage(cloud ? "Bill saved to the cloud." : "Bill saved on this device only.");
    setBusy(false);
  }

  async function addProduct() {
    const name = productName.trim(),
      price = Number(productPrice);
    if (!name || productPrice.trim() === "" || !Number.isFinite(price) || price < 0) {
      setMessage("Enter a product name and a valid price (zero or more).");
      return;
    }
    const existing = findProduct(name);
    if (existing) {
      const sb = getSupabase();
      if (sb) {
        const { error } = await sb.from("products").update({ price }).eq("id", existing.id);
        if (error) {
          setMessage(`Cloud update failed: ${error.message}`);
          return;
        }
      }
      setProducts(prev => prev.map(p => (p.id === existing.id ? { ...p, price } : p)));
      setMessage(`${name} price updated.`);
    } else {
      const p: Product = { id: makeId(), name, price, aliases: [] };
      const sb = getSupabase();
      if (sb) {
        const { data, error } = await sb
          .from("products")
          .insert({ name, price, aliases: [] })
          .select("id,name,price,aliases,category")
          .single();
        if (error) {
          setMessage(`Cloud save failed: ${error.message}`);
          return;
        }
        if (data) p.id = data.id;
      }
      setProducts(prev => [...prev, p]);
      setMessage(`${name} added to catalogue.`);
    }
    setProductName("");
    setProductPrice("");
    setShowAdd(false);
  }

  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const parsed = parseCSV(await file.text());
      if (!parsed.length) {
        setMessage("No valid rows found. Use CSV columns: name,price,aliases.");
        return;
      }
      let added = 0, updated = 0;
      for (const row of parsed) {
        const old = products.find(p => normalizeText(p.name) === normalizeText(row.name));
        if (old) {
          setProducts(prev =>
            prev.map(p =>
              p.id === old.id ? { ...p, price: row.price, aliases: row.aliases.length ? row.aliases : p.aliases } : p
            )
          );
          updated++;
        } else {
          const p: Product = { id: makeId(), name: row.name, price: row.price, aliases: row.aliases };
          const sb = getSupabase();
          if (sb) {
            const { data, error } = await sb
              .from("products")
              .upsert({ name: p.name, price: p.price, aliases: p.aliases }, { onConflict: "name" })
              .select("id,name,price,aliases,category")
              .single();
            if (error) {
              setMessage(`Import stopped at ${row.name}: ${error.message}.`);
              return;
            }
            if (data) p.id = data.id;
          }
          setProducts(prev => [...prev, p]);
          added++;
        }
      }
      setMessage(`Import complete: ${added} added, ${updated} updated.`);
    } catch {
      setMessage("Could not read file. Export spreadsheet as CSV UTF-8 and retry.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const filtered = products.filter(
    p => normalizeText(p.name).includes(normalizeText(query)) || p.aliases.some(a => normalizeText(a).includes(normalizeText(query)))
  );

  return (
    <main className="app-shell">
      <style>{`
        @keyframes pulseBar {
          0%, 100% { height: 4px; }
          50% { height: 14px; }
        }
        .mic-bar {
          width: 3px;
          background: #e11d48;
          border-radius: 2px;
          animation: pulseBar 0.8s infinite ease-in-out;
        }
        .mic-bar:nth-child(2) { animation-delay: 0.15s; }
        .mic-bar:nth-child(3) { animation-delay: 0.3s; }
        .mic-bar:nth-child(4) { animation-delay: 0.45s; }
      `}</style>

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <div>Kirana<span style={{ color: "#9d7935" }}>.</span>Bill</div>
            <div className="eyebrow" style={{ letterSpacing: 1, fontSize: 9, marginTop: 3 }}>
              VOICE BILLING DESK
            </div>
          </div>
        </div>
        <span className="pill">{cloud ? "● Cloud configured" : "● Device demo mode"}</span>
      </header>

      <section className="hero">
        <div>
          <div className="eyebrow">YOUR COUNTER, SIMPLIFIED</div>
          <h1>Billing made<br />easy to say.</h1>
          <p>Speak products continuously. Say "Oreo 5", "Undo", or "Finalize bill".</p>
        </div>
        <button className="btn" onClick={() => setShowAdd(true)}>＋ Add product</button>
      </section>

      {message && (
        <div className={`notice ${message.includes("saved") || message.includes("Added") || message.includes("complete") || message.includes("updated") ? "success" : ""}`} role="status">
          {message}
        </div>
      )}

      <div className="grid-main">
        <section className="panel">
          <div className="panel-head">
            <h2>Build a bill</h2>
            <span className="pill">{cart.reduce((s, i) => s + i.quantity, 0)} items</span>
          </div>

          <div className="voice-box">
            <div className="voice-row" style={{ display: "flex", itemsCenter: "center", gap: "12px" }}>
              <button
                aria-label={listening ? "Stop voice billing" : "Start voice billing"}
                className={`mic ${listening ? "listening" : ""}`}
                onClick={startVoice}
              >
                {listening ? "■" : "🎙"}
              </button>

              <div className="voice-copy" style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <strong>{listening ? "Listening continuously..." : "Tap to start voice assistant"}</strong>
                  {/* Pure CSS Wave Animation (No hardware mic lock on Android) */}
                  {listening && (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "14px" }}>
                      <span className="mic-bar" />
                      <span className="mic-bar" />
                      <span className="mic-bar" />
                      <span className="mic-bar" />
                    </div>
                  )}
                </div>
                <small>Try: “Oreo 5”, “2 Milk”, “Undo”, or “Finalize bill”</small>
              </div>
            </div>

            <div className="transcript">{voiceText || "Your recognized speech will appear here."}</div>
            <div className="small-note">
              Hands-free continuous recognition optimized for mobile Chrome.
            </div>
          </div>

          <div className="panel-head">
            <h2>Quick add</h2>
            <span className="eyebrow">{products.length} products</span>
          </div>
          <input
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search products… e.g. Oreo"
            aria-label="Search products"
          />
          <div className="product-list">
            {filtered.slice(0, 20).map(p => (
              <div className="product-row" key={p.id}>
                <div className="product-emoji">{p.category === "Dairy" ? "🥛" : p.category === "Chocolate" ? "🍫" : "🛒"}</div>
                <div className="product-info">
                  <strong>{p.name}</strong>
                  <small>{money(p.price)} each{p.aliases.length ? ` · ${p.aliases.join(", ")}` : ""}</small>
                </div>
                <button className="btn soft" onClick={() => smartAddToCart(p, 1, false)}>＋ Add</button>
              </div>
            ))}
            {!filtered.length && <div className="empty">No products match your search. Add it to catalogue first.</div>}
          </div>

          <div className="section-gap" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setShowAdd(true)}>＋ Manual product</button>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? "Importing…" : "⇧ Import CSV"}
            </button>
            <input className="hidden-file" ref={fileRef} type="file" accept=".csv,text/csv" onChange={e => importFile(e.target.files?.[0])} />
          </div>
          <p className="small-note">CSV format: <b>name, price, aliases</b> — one product per row.</p>
        </section>

        <section>
          <div className="panel">
            <div className="panel-head">
              <h2>Current bill</h2>
              <button className="btn danger" onClick={() => { setCart([]); setDiscount("0"); }}>Clear</button>
            </div>
            {cart.length ? (
              <div className="product-list">
                {cart.map(i => (
                  <div className="product-row" key={i.product.id}>
                    <div className="product-info">
                      <strong>{i.product.name}</strong>
                      <small>{money(i.product.price)} × {i.quantity}</small>
                    </div>
                    <div className="qty">
                      <button
                        aria-label={`Decrease ${i.product.name}`}
                        onClick={() =>
                          setCart(prev =>
                            prev.map(x => (x.product.id === i.product.id ? { ...x, quantity: x.quantity - 1 } : x)).filter(x => x.quantity > 0)
                          )
                        }
                      >
                        −
                      </button>
                      <span>{i.quantity}</span>
                      <button
                        aria-label={`Increase ${i.product.name}`}
                        onClick={() =>
                          setCart(prev =>
                            prev.map(x => (x.product.id === i.product.id ? { ...x, quantity: Math.min(999, x.quantity + 1) } : x))
                          )
                        }
                      >
                        ＋
                      </button>
                    </div>
                    <div className="line-total">{money(i.product.price * i.quantity)}</div>
                    <button
                      className="btn danger"
                      aria-label={`Remove ${i.product.name}`}
                      onClick={() => setCart(prev => prev.filter(x => x.product.id !== i.product.id))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div style={{ fontSize: 26, marginBottom: 8 }}>🧾</div>
                Your bill is empty.<br />Use voice billing or add a product.
              </div>
            )}

            <div className="field">
              <label htmlFor="customer">Customer name (optional)</label>
              <input id="customer" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Walk-in customer" />
            </div>
            <div className="field">
              <label htmlFor="discount">Discount (₹)</label>
              <input id="discount" type="number" min="0" max={subtotal} value={discount} onChange={e => setDiscount(e.target.value)} />
            </div>

            <div className="total-card">
              <div className="total-line"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              <div className="total-line"><span>Discount</span><span>− {money(discountValue)}</span></div>
              <div className="total-line final"><span>Total</span><span>{money(total)}</span></div>
            </div>

            <div className="bill-actions">
              <button className="btn" onClick={() => window.print()} disabled={!cart.length}>
                Print / Save PDF
              </button>
              <button className="btn primary" onClick={() => setShowFinalizeModal(true)} disabled={!cart.length || busy}>
                Finalize bill
              </button>
            </div>
            <p className="small-note">Check the bill carefully before saving or printing.</p>
          </div>

          <div className="panel history-panel section-gap">
            <div className="panel-head">
              <h2>Recent bills</h2>
              <span className="pill">{history.length} saved</span>
            </div>
            {history.length ? (
              <div className="history-list">
                {history.slice(0, 10).map(b => (
                  <div className="history-row" key={b.id}>
                    <div>
                      <strong>
                        {b.items.length} line item{b.items.length === 1 ? "" : "s"}
                        {customer ? ` · ${customer}` : ""}
                      </strong>
                      <small>
                        {new Date(b.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                        {b.items.map(i => `${i.name} ×${i.quantity}`).join(", ")}
                      </small>
                    </div>
                    <div className="history-right">
                      <strong>{money(b.total)}</strong>
                      <small><span className="status saved">Saved</span></small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">Saved bills on this device will appear here.</div>
            )}
          </div>
        </section>
      </div>

      <footer className="footer">Kirana.Bill · Built for a simpler shop counter</footer>

      {showAdd && (
        <div className="modal-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <h2 id="add-title">Add or update product</h2>
            <p>Enter the exact product name and its selling price per unit.</p>
            <div className="field">
              <label htmlFor="pname">Product name</label>
              <input id="pname" autoFocus value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Oreo" />
            </div>
            <div className="field">
              <label htmlFor="pprice">Price per unit (₹)</label>
              <input id="pprice" type="number" min="0" step="0.01" value={productPrice} onChange={e => setProductPrice(e.target.value)} placeholder="e.g. 5" />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn primary" onClick={addProduct}>Save product</button>
            </div>
          </div>
        </div>
      )}

      {showFinalizeModal && (
        <div className="modal-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setShowFinalizeModal(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="finalize-title">
            <h2 id="finalize-title">Finalize Bill?</h2>
            <p style={{ marginTop: 6, marginBottom: 16, color: "#555" }}>
              Total is <strong>{money(total)}</strong> across <strong>{cart.reduce((s, i) => s + i.quantity, 0)} items</strong>.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={() => setShowFinalizeModal(false)}>Keep editing</button>
              <button className="btn primary" onClick={saveBill} disabled={busy}>
                {busy ? "Saving…" : "Yes, Save & Finalize"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

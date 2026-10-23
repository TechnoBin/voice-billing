"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { parseCSV } from "@/lib/csv";
import { normalizeText, parseQuantity } from "@/lib/voice";
import type { Bill, CartItem, Product } from "@/lib/types";

const starter: Product[] = [
  { id: "p1", name: "Dairy Milk", price: 10, aliases: ["dairy milk", "silk"], category: "Chocolate" },
  { id: "p2", name: "KitKat", price: 10, aliases: ["kit kat"], category: "Chocolate" },
  { id: "p3", name: "Bourbon", price: 10, aliases: ["bourbon biscuit"], category: "Biscuit" },
  { id: "p4", name: "Oreo", price: 5, aliases: ["oreo biscuit"], category: "Biscuit" },
  { id: "p5", name: "Parle-G", price: 5, aliases: ["parle g", "parle ji"], category: "Biscuit" },
  { id: "p6", name: "Milk", price: 30, aliases: ["packet milk"], category: "Dairy" },
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

// Safe Speech Synthesis for Browser Environments
function speakAssistant(text: string) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-IN";
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore if speech synthesis is disabled on client browser
    }
  }
}

export default function BillingApp() {
  const [products, setProducts] = useState<Product[]>(starter);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [history, setHistory] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [listening, setListening] = useState(false);
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

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.product.price * i.quantity, 0), [cart]);
  const discountValue = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const total = Math.max(0, subtotal - discountValue);

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

  function addToCart(product: Product, quantity = 1) {
    setCart(prev => {
      const found = prev.find(i => i.product.id === product.id);
      return found
        ? prev.map(i => (i.product.id === product.id ? { ...i, quantity: Math.min(999, i.quantity + quantity) } : i))
        : [...prev, { product, quantity }];
    });
  }

  function normalizeNumbers(text: string): string {
    const numberWords: Record<string, string> = {
      one: "1", two: "2", three: "3", four: "4", five: "5",
      six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
      half: "0.5", ek: "1", do: "2", teen: "3", chaar: "4", char: "4",
      paanch: "5", panch: "5", chhah: "6", che: "6", saat: "7",
      aath: "8", nau: "9", das: "10", aadha: "0.5"
    };

    return text
      .toLowerCase()
      .split(/\s+/)
      .map(word => numberWords[word] || word)
      .join(" ");
  }

  function toRoman(str: string): string {
    const devanagariMap: Record<string, string> = {
      अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ए: "e", ऐ: "ai", ओ: "o", औ: "au",
      ा: "a", ि: "i", ी: "i", ु: "u", ू: "u", े: "e", ै: "ai", ो: "o", ौ: "au", ं: "n", ्: "",
      क: "k", ख: "kh", ग: "g", घ: "gh", च: "ch", छ: "chh", ज: "j", झ: "jh",
      ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n",
      प: "p", फ: "f", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "v",
      श: "sh", ष: "sh", स: "s", ह: "h", ०: "0", १: "1", २: "2", ३: "3", ४: "4", ५: "5", ६: "6", ७: "7", ८: "8", ९: "9"
    };
    return str.split("").map(c => devanagariMap[c] || c).join("");
  }

  // Pure function for stream parsing to avoid React hook dependency issues
  function processVoiceStream(rawTranscript: string) {
    if (!rawTranscript || rawTranscript === lastProcessedTranscript.current) return;
    lastProcessedTranscript.current = rawTranscript;

    const clean = rawTranscript.toLowerCase().trim();

    // Command 1: Finalize Bill
    if (/finalize\s*bill|final\s*bill|finish\s*bill|complete\s*bill/i.test(clean)) {
      if (recognition.current) recognition.current.stop();
      setListening(false);
      speakAssistant("Should I finalize the bill now?");
      setShowFinalizeModal(true);
      setMessage("Voice assistant paused. Review and confirm to finalize bill.");
      return;
    }

    // Command 2: Clear Bill
    if (/clear\s*bill|clear\s*all|reset\s*bill|empty\s*cart/i.test(clean)) {
      setCart([]);
      setDiscount("0");
      speakAssistant("Bill cleared.");
      setMessage("Bill cleared via voice command.");
      return;
    }

    // Command 3: Remove Product
    const removeMatch = clean.match(/(?:remove|delete|drop)\s+([a-z0-9\s]+)/i);
    if (removeMatch && removeMatch[1]) {
      const targetName = removeMatch[1].trim();
      const productToRemove = findProduct(targetName);
      if (productToRemove) {
        setCart(prev => prev.filter(item => item.product.id !== productToRemove.id));
        speakAssistant(`Removed ${productToRemove.name} from bill.`);
        setMessage(`Removed ${productToRemove.name} from bill.`);
      }
      return;
    }

    // Multi-Item Phrase Parser
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
          addToCart(product, qty);
          itemsAdded.push(`${qty} × ${product.name}`);
        }
      }
    }

    if (itemsAdded.length > 0) {
      const feedbackMsg = `Added ${itemsAdded.join(", ")} to the bill.`;
      setMessage(feedbackMsg);
      speakAssistant(feedbackMsg);
    } else {
      const { name, quantity } = parseQuantity(clean);
      if (name) {
        const product = findProduct(name);
        if (product) {
          addToCart(product, quantity);
          setMessage(`Added ${quantity} × ${product.name} to this bill.`);
        }
      }
    }
  }

  function startVoice() {
    const Ctor = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!Ctor) {
      setMessage("Voice input is not supported by this browser. Try Chrome on Android, or use product search.");
      return;
    }
    if (listening) {
      if (recognition.current) recognition.current.stop();
      setListening(false);
      speakAssistant("Microphone stopped.");
      return;
    }

    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event: any) => {
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
        const normalized = normalizeNumbers(processedFinal);
        processVoiceStream(normalized);
      }
    };

    rec.onerror = (e: any) => {
      setMessage(`Voice input issue: ${e.error || "please try again"}.`);
      setListening(false);
    };

    rec.onend = () => setListening(false);

    recognition.current = rec;

    try {
      rec.start();
      setListening(true);
      speakAssistant("Voice assistant active. Say ok add product then name items.");
      setMessage("Listening… say “ok add product Dairy Milk 5 KitKat 6” or say “Finalize bill”.");
    } catch {
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
          <p>Speak products continuously. List items back to back, then say "Finalize bill".</p>
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
            <div className="voice-row">
              <button
                aria-label={listening ? "Stop voice billing" : "Start voice billing"}
                className={`mic ${listening ? "listening" : ""}`}
                onClick={startVoice}
              >
                {listening ? "■" : "🎙"}
              </button>
              <div className="voice-copy">
                <strong>{listening ? "Listening continuously…" : "Tap to start voice assistant"}</strong>
                <small>Try: “ok add product Dairy Milk 5 KitKat 6” or “Finalize bill”</small>
              </div>
            </div>
            <div className="transcript">{voiceText || "Your recognized speech will appear here."}</div>
            <div className="small-note">
              Voice recognition supports continuous multi-item streaming & voice actions (Remove, Clear, Finalize).
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
                <button className="btn soft" onClick={() => addToCart(p)}>＋ Add</button>
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
